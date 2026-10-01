# OBSERVABILITY ROOT-CAUSE AUDIT
Audit-only: no code changes, no DB mutations, no paid calls.
Triggering incident: `provider_error_message` column missing →
`updateProviderCheck()` threw `ER_BAD_FIELD_ERROR` → best-effort catch
swallowed it → terminal provider diagnostics silently disappeared for 7
background transport tests. This audit generalizes that failure class.

## 1. Structured event inventory (by subsystem)

Logging = direct `console.log/error/warn` only. No logger abstraction,
no event emitter, no audit helper, no requestId middleware.

**Generation (21 events)** — generation-service.ts, generation-recovery.ts,
openai-transport.ts, run-application-pipeline.ts:
`generation_service_start`, `generation_service_resume`,
`generation_context_failed`, `generation_api_key_missing`,
`generation_blocked`, `generation_circuit_open`, `generation_resume_rejected`,
`generation_lock_conflict`, `generation_run_create_failed`,
`generation_cancelled`, `generation_run_recovering`,
`generation_pipeline_error`, `generation_service_success`,
`generation_run_superseded`, `generation_supersede_error`,
`generation_schema_migration_required`, `generation_recovery_start`,
`generation_recovery_failed`, `provider_cancel_failed`,
`stage_contract_retry`, `HIGH_OUTPUT_BUDGET_UTILIZATION`,
`CRITICAL_OUTPUT_BUDGET_UTILIZATION`, `REVIEWER_OUTPUT_VERBOSE`,
`FACT_REVIEW_OUTPUT_VERBOSE`, `LANGUAGE_OUTPUT_VERBOSE`,
`PLANNER JSON PARSE ERROR`/`PLANNER ERROR` (raw-text console.error).

**CV upload (4):** `cv_import_result`, `cv_parse_failure`,
`cv_parse_stale_meta_reparse`, `cv_upload_error`.
**CV apply (3):** `[cv-apply] IDENTITY_CONFLICT_OVERRIDE`,
`[cv-apply] REPLACE_CV_DERIVED`, raw `CV apply error:`.
**Lifecycle/deletion (3):** `[application-delete]`, `[student-delete]`,
`[document-delete]` warns (actor + ids; PII — see retention audit).
**Requirements (5):** `[resolver] Failed to fetch requirements`,
`[resolver] Failed to fetch AI policy`, `[discovery] Fetch failed`,
`[discovery] Page classification failed`, `[discovery] Requirements
extraction failed` — all failure-side only; **no success/provenance events**.
**Auth (0 structured):** `Login error:` raw only.
**Rate limiting (0 events):** all limiter rejections silent.
**Rendering (0 structured events):** render errors become `RENDER_ENGINE_ERROR`
feedback rows in-line; no event.
**Exports (0 events):** document-export.ts emits nothing.
**Database (indirect):** `generation_schema_migration_required` carries
`missing[]`; schema/blocked migration scripts print to stdout; DB errors
otherwise surface only inside raw `console.error` objects.
**Misc:** `Failed to log usage`, `Failed to save profile`,
`instrumentation: generation recovery init failed`, currency-exchange logs,
benchmark route logs.

## 2. Correlation-key audit (generation)

See GENERATION_EVIDENCE_MATRIX.md §3 for the full table. Summary:
- Present nearly everywhere: `requestId`, `generationId`(=runId), `documentId`.
- **Absent from ALL events:** `attemptSeq`, `applicationId`, `model`,
  `retryNumber`, `recoveryCount`, `reusedCheckpoint`, `reusedProviderResponse`.
- `providerResponseId` present only in `provider_cancel_failed`.
- `stage` present in recovery-start/contract-retry/utilization events;
  absent from service-level lifecycle events (embedded in `error` string).
- Usage ledger carries **zero** correlation keys — not even runId, though
  the caller passes `generationId` into `stageUsageFromProvider` and it is
  never written to the JSONL row.

## 3. Failure-evidence audit

Every generation failure path was checked for: stable code, category, stage,
safe reason, provider status, provider response id, duration, retryability,
recoverability. Result: `generation_pipeline_error` is the strongest event
(`errorCode` + `errorClass` + `error` raw + durationMs) — but it lacks
`stage`, `providerResponseId`, `attemptSeq`. **`generation_run_create_failed`
logs requestId/generationId/documentId but NOT the error message — create
failures are undiagnosable.** Usage-ledger failure rows are `success:false`
with all-zero tokens and no error field — the confirmed planner-gap exists
in every stage wrapper (plan-sop, write-draft, review-quality,
calibrate-language, finalize-sop, review-facts) plus the transport's
`USAGE_UNKNOWN` row.

## 4. Best-effort catch audit (~70 catch sites)

| Catch site | Classification |
|---|---|
| `persistResponse()` (setProviderState + recordStageResponse) pipeline:477-483 | **DANGEROUS STATE+EVIDENCE LOSS (P0)** — run loses provider_response_id; recovery cannot reuse → duplicate paid request, silent |
| dedup `findReusableProviderResponse` pipeline:464-474 | **DANGEROUS STATE LOSS (P0)** — lookup failure silently issues NEW paid request |
| terminal-failure block pipeline:560-576 (updateProviderCheck errorCode/incompleteReason, updateStageResponseStatus, usage reconcile) | **DANGEROUS EVIDENCE LOSS (P0)** — the exact provider_error_message incident class |
| `onStatus` updateProviderCheck+updateStageResponseStatus :522-526 | **DANGEROUS EVIDENCE LOSS (P0)** |
| setProviderUsage+setStageResponseUsage :530-535 | **DANGEROUS EVIDENCE LOSS (P1)** — cost evidence |
| heartbeat :755 | DANGEROUS STATE (P1) — silent heartbeat failure → premature RECOVERING |
| markStageStarted/Completed :768,:791 | evidence loss (P2) |
| updateStageResponseStatus("content_invalid") :676 | evidence loss (P2) |
| resume-check :460, provider-cancel ×3 (:563, cancel-route:99, supersede:563) | cancel-silence (P2): cannot distinguish "cancel attempted" vs "never attempted" |
| stage-execution catch{} finish/close/accounting :1573-75, onContentInvalid :585 | SAFE best-effort (cleanup) |
| logUsage fs catch | accounting loss → console.error (P1 by accumulation) |
| requirements-db.ts ×4, application-context-repo ×3 | EXPECTED FALLBACK (null→miss) — but creates "not-found vs error" ambiguity (P2) |
| search-provider/domain-verification/discovery-scoring ~13 catches | EXPECTED FALLBACK (crawl resilience) |
| pre-final-render/final-render catches | EXPECTED FALLBACK (degraded feedback: RENDER_ENGINE_ERROR/overflow defaults) — reason swallowed (P2) |
| releaseGenerationLock :729 (releaseOrphanedDocumentLock) | SAFE — run-owner authority check inside; DB failure just keeps lock |
| generation-schema assertPromise.catch | SAFE (memoization reset) |
| warnings_json parse catch | SAFE |
| consultant-session :100, db.ts :54, docling-client :27, generation-build-manifest :66, pipeline-checkpoint :260, component-action-planner :141 | SAFE/EXPECTED (parse/absence fallback) |

**Critical silent catches (dangerous): 8** (the P0/P1 rows).

## 5. Usage/cost ledger

`logUsage` appends to `logs/openai-usage.jsonl`; fields: timestamp, model,
pipelineStage, inputTokens, cachedInputTokens, outputTokens, totalTokens,
reasoningTokens, estimatedCostUsd, duration, success, {maxOutputTokens,
visibleOutputTokens, utilizationRatio, note}.

Recorded: model ✓ tokens ✓ cached ✓ cost ✓ duration ✓ success flag ✓
**Missing: provider, providerResponseId, runId/documentId/applicationId/
attemptSeq, requestId, errorCode/errorReason, retryNumber, recoveryCount,
reusedCheckpoint/reusedProviderResponse, chargedNew flag.**

**Critical answer — can accounting alone distinguish provider-poll vs
response-reuse vs NEW paid request? NO.** Polls are never logged; reuse
produces a `USAGE_UNKNOWN`/zero-cost row identical in shape to a failed
call; a new paid request shows token values — but you cannot prove the
request was NEW vs a reused completed response except by absence of cost.
`success:false` rows are ambiguous across: network-fail, 400, 429, 5xx,
timeout, content-invalid, usage-unavailable-on-completed-response.

## 6. Failed-call-before-usage cases

| Case | attempt evidence | responseId | retry behavior visible | cost certainty | recovery | user msg |
|---|---|---|---|---|---|---|
| network fail pre-accept | none (raw throw) | impossible | invisible | **uncertain — unknown whether provider accepted** | run fails | GENERATION_INTERNAL_ERROR |
| provider 400 | INVALID_REQUEST persisted best-effort | n/a | zero-retry implied | zero (no request accepted) | no | INTERNAL |
| provider 429/5xx at create | raw throw → PROVIDER_FAILED | **lost** | invisible | uncertain | fail/INTERNAL | provider-delay-ish |
| response created, local failure | run row has responseId IF persist survived | best-effort | n/a | in-flight; never reconciled | RECOVERING→resume reuses | provider delay |
| provider terminal failed/incomplete | code persisted best-effort | best-effort | 1 retry invisible | providerUsage reconciled if persist ok | no | per classifier |
| timeout while running | STAGE_TIMEOUT event | best-effort | resume reuses same response | unknown until poll | RECOVERING | provider delay (correct) |
| usage retrieval failed on completed | `USAGE_UNKNOWN` zero row | yes in StageUsage obj (not ledger) | n/a | **uncertain — response may have consumed tokens** | n/a | n/a |

**Do not infer zero cost from missing usage:** USAGE_UNKNOWN and network-fail
cases carry real cost uncertainty that current evidence cannot resolve.

## 7. Recovery observability

RUNNING→RECOVERING→RUNNING→COMPLETED: DB carries `recovery_count`,
`provider_response_id`, status transitions. Events:
`generation_run_recovering` (error string, no recoveryCount/stage/provRespId),
`generation_recovery_start` (runId, docId, stage — no attemptSeq/recovery#/
reusedResponse/new-paid-request flag), `generation_recovery_failed`
(message). **Gaps: no claim-acquired event, no ownership-verified event,
no checkpoint-reused vs fresh-execute signal, no new-paid-request signal,
recovery attempt number only in DB.** Full lifecycle is PARTIAL —
reconstructable only by joining PM2 events + generation_runs + stage_responses,
and only if best-effort writes landed.

## 8. Supersession observability

`generation_run_superseded` logs requestId/runId/documentId/durationMs —
**no old attemptSeq, no new attemptSeq, no superseding runId, no reason**
beyond the generic path. `generation_supersede_error` carries the error.
Verdict: a rejected resume IS logged, but the evidence cannot show *which*
run superseded it — attempt_seq is authoritative in DB yet invisible in logs.

## 9. Cancellation observability

`generation_cancelled` (requestId/runId/documentId/durationMs); DB has
`cancel_requested_at`/`cancelled_at`/`provider_response_status`.
Provider cancel attempt is inside catch{} (cancel route :99, service :563);
`provider_cancel_failed` exists on transport failure but carries no runId.
**Cannot distinguish "cancel requested→provider cancelled" vs "provider
already terminal" vs "cancel never attempted"** — the attempt itself is
unlogged; only failures surface.

## 10. Requirements observability

Persisted (brief JSON in logs/requirements): sourceId, sourceClass,
retrievedAt, verifiedAt, per-field provenance — good durable evidence.
Runtime events: only failures (`[resolver] Failed to fetch...`,
`[discovery] Fetch failed...`). **Silent ambiguity confirmed:** fetch-failed
→ null and not-found → null are indistinguishable downstream; no event
records which source-class (explicit/verified-official/default/legacy)
produced prompt/word-limit/topics/formatting. Faculty-alignment and
student-declared-requirements have zero events.

## 11. Lifecycle/deletion observability

Delete routes log warn with ids + consultant.id + affected entity identity —
actor + ids present; **missing:** requestId, precondition detail (which check
failed), affected-row count, provider-work-still-exists flag, structured
rejection events for GENERATION_IN_PROGRESS 409s (rejection is in response
only). 500 handlers return raw `error?.message`.

## 12. Export/render observability

**Zero structured events** for render start/end, export, format, profile,
input/output hash. Render failures degrade to `RENDER_ENGINE_ERROR` status
inside feedback objects; overflow measurement failure returns zeroed metrics
silently. Export path/location never logged; determinism evidence only in
attempt artifacts. RENDER_BUSY (503) unlogged.

## 13. Auth / rate-limit observability

Login: no success/failure events; single `console.error("Login error:", error)`
on exception. Session creation/expiry: `consultant-session.ts` catch → silent.
Rate limits (cv-upload 30/15min per IP, cvParseLimiter, renderLimiter,
exportLimiter, crawlLimiter): **all rejections emit zero events** —
no IP/request-correlated security trail anywhere.

## 14. Request/response correlation

No requestId middleware; `requestId` is generated inside generation-service
(`crypto`-based or `recovery-<run8>` synthetic). Async recovery gets a NEW
requestId — original request correlation lost, **but runId/documentId
stability is preserved** (the acceptable trade per spec). requestId is never
persisted in DB — joins across request boundaries impossible.

## 15. Telemetry vs core-state failure separation

- `logUsage`/`console` can never crash generation — correct design.
- **Failure of a "best-effort" DB write is indistinguishable from telemetry
  failure** — yet three of those writes (setProviderState, recordStageResponse,
  updateProviderCheck terminal diagnostics) are CORE STATE for resume-reuse
  and diagnostics. This conflation is the architectural root cause behind the
  provider_error_message incident: the catch could not know which swallowed
  writes were safe to lose.
- Core run lifecycle writes (create/fail/recover/CAS/release) correctly
  propagate — good boundary, except it's undermined by the best-effort ring.

## 16. Event-naming consistency

`error`/`reason`/`code`/`errorCode`/`failureMessage` used interchangeably;
JSON envelopes vs `[tag]` text warns vs raw objects. Canonical envelope
proposed in ERROR_TAXONOMY_AUDIT.md §4 (design only).

## 17. Findings register

**P0 (5):** persistResponse silent; dedup-lookup silent → duplicate paid
request; terminal-failure persistence block silent (provider_error_message
class); onStatus persistence silent; provider-usage persistence silent.

**P1 (16):** usage-ledger failure rows have no error code; usage ledger has
zero correlation keys; poll-vs-reuse-vs-new-paid-request indistinguishable;
create-failure event lacks error message; transport create-failures (network/
429/5xx) emit no evidence (cost uncertainty); supersession event lacks
attemptSeqs; recovery events lack attempt#/reuse flags; requestId never
persisted; rate-limit rejections silent; no auth security events; plan-sop
logs 200 chars of model output; cv-apply override logs name+email;
student-delete logs name+email; logs/attempts content artifacts unbounded;
PM2 logs unrotated; cv-apply mutation has no audit event.

**P2 (14):** failure_message is the only DB failure-code storage (raw text,
stage NULLed on fail); heartbeat silent; markStage* silent; content_invalid
status write silent; provider-cancel-attempt unlogged; provider-poll-retry
unlogged; requirements not-found-vs-failed ambiguity + no provenance events;
render/export zero events; delete 409s/rejections unlogged; CV per-strategy
duration + per-section counts missing; PROFILE_CHANGED/IDENTITY_CONFLICT
rejections unlogged; raw error objects logged at ~15 sites; mixed log
formats; recovery-scan failure unstructured.

**P3 (5):** non-structured `console.error` leftovers; generationId naming
collision (run-id vs attempt-id); metadata-only naming drift; attempt-dir
cleanup absent; warnings_json parse catch fine but undocumented.

## 18. Diagnosability & separation verdicts

See GENERATION_EVIDENCE_MATRIX.md §5 for the five-incident test:
1 PARTIAL (factReviewer timeout), 1 PARTIAL (CONTENT_JSON_INVALID),
1 PARTIAL (stage-order), 1 YES (Khushi empty parse — CV events are the
best-instrumented surface), 1 PARTIAL (DOCLING_UNREADABLE).

## 19. Top root causes

1. **Core-state writes classified as "best-effort telemetry"** — the single
   architectural defect behind the provider_error_message incident and most P0s.
2. **Usage ledger has no correlation schema** — billing evidence is an island.
3. **No providerResponseId/attemptSeq anywhere in events** — the two keys the
   ownership/ordering work made authoritative are invisible to observability.
4. **Reuse vs new-paid-request is unrecorded** — duplicate-cost risk is
   unmeasurable.
5. **Raw error passthrough to UI** (generate-application:138, 5 unsanitized
   500s) — taxonomy exists but isn't enforced at route edges.
6. **PII in actor-audit warns + content artifacts retained forever.**
7. **No rotation/retention anywhere** — investigation window is luck-based.
8. **Security events absent** (auth, rate-limit) — no abuse trail.
9. **Silent-rejection pattern** — 409s/413s/429s return codes but never log.
10. **`success:false` + zeros treated as sufficient failure evidence** —
    every stage failure is undiagnosable from accounting alone.
