# GENERATION EVIDENCE MATRIX
Audit-only deliverable. No code changes, no DB mutations, no paid calls.

## 1. Where generation evidence lives

| Store | Writes | Failure durability |
|---|---|---|
| `generation_runs` | status, current_stage, failure_message, recovery_count, provider_* cols, stage_fingerprint, warnings_json, attempt_seq | Core state — writes are awaited EXCEPT provider/usage writes which are best-effort |
| `generation_stage_responses` | stage, fingerprint, provider_response_id, status, model, tokens, usage_status, provider_error_code, incomplete_reason | ALL writes wrapped in `catch { /* best-effort */ }` |
| `document_versions` | version id/number, model, cost_usd, hashes | Success-path only; nothing on failure |
| PM2 console (JSON.stringify events) | ~20 structured events | Unbounded file, no rotation configured |
| `logs/openai-usage.jsonl` | per-stage usage/cost rows | No correlation keys; failure rows are zero-token stubs |
| `logs/attempts/<genId>/` | checkpoint-*, artifact-*, raw-*.txt, accounting.json, run-state.json | File-based; contains full content — see PII audit |

## 2. Field × survival matrix (generation failures)

| FIELD | DB | LOG | VERDICT |
|---|---|---|---|
| Failure code | `failure_message` stores RAW string only; no `error_code` column | `generation_pipeline_error.errorCode` (normalized) | PARTIAL — DB has raw text, log has stable code; neither joins cleanly |
| Failure reason | `failure_message` (raw, may embed 80-char model snippet) | `error:` field on pipeline/recovering events | BOTH |
| Failed stage | **`current_stage` is SET NULL by `failRun()`** — lost in DB | embedded in `error` string (`STAGE_TIMEOUT:factReviewer`) | LOG-only; DB clears it |
| Provider response ID | `provider_response_id` — IF `persistResponse` write survived | never emitted in any event | DB-only (fragile) |
| Provider status | `provider_response_status` — best-effort `onStatus` write | none | DB-if-write-succeeds |
| Provider error | `provider_error_code`/`provider_error_message`/`provider_incomplete_reason` — best-effort (the swallowed-`ER_BAD_FIELD_ERROR` incident) | none | DB-if-write-succeeds — PROVEN LOSABLE |
| Input/output/reasoning/cached tokens | `provider_*_tokens` on run + `generation_stage_responses` token cols — best-effort | usage JSONL | BOTH when writes succeed; NEITHER when swallowed |
| Cost | `document_versions.cost_usd` on success only | usage JSONL `estimatedCostUsd` | LOG-only for failures; zero on failure rows |
| Duration | none | `durationMs` on service events; `duration` in JSONL | LOG-only |
| Retry count | none | none | **NEITHER** — the one provider-retry per stage is invisible |
| Recovery count | `recovery_count` column | not on recovery events | DB-only |
| Fallback used | none | none (generation); `fallbackUsed` exists for CV only | **NEITHER** |
| Warning count | `warnings_json` array | `*_VERBOSE`/utilization warns | DB-only for count |
| Checkpoint fingerprint | `stage_fingerprint` column | none | DB-only |

## 3. Correlation keys per event type

`generationId` in service events IS the run id. Required keys vs. actual:

| Event | runId | docId | appId | attemptSeq | stage | providerRespId | reqId | retry# | recovery# | reused* |
|---|---|---|---|---|---|---|---|---|---|
| generation_service_start/resume | yes | yes | no | **no** | no | no | yes | no | no | no |
| generation_pipeline_error | yes | yes | no | **no** | in `error` str | **no** | yes | no | no | no |
| generation_run_recovering | yes | yes | no | **no** | in `error` str | **no** | yes | no | no | no |
| generation_run_superseded | yes | yes | no | **no old/new seq** | no | no | yes | no | no | n/a |
| generation_recovery_start/failed | yes | yes | no | **no** | yes (start) | **no** | synth `recovery-*` | no | **no** | **no** |
| generation_run_create_failed | yes | yes | no | — | — | — | yes | — | — | — |
| stage_contract_retry | yes | no | no | no | yes | **no** | no | implied(1) | no | no |
| provider_cancel_failed | no | no | no | no | no | yes | no | — | — | — |
| usage JSONL rows | **no** | no | no | no | yes (pipelineStage) | **no** | no | no | no | no |
| HIGH/CRITICAL_OUTPUT_BUDGET_UTILIZATION | yes (as generationId) | no | no | no | yes | no | no | — | — | — |

**Missing essential keys — every event type lacks `attemptSeq`; none carry `providerResponseId` except `provider_cancel_failed`; no event carries `reusedCheckpoint`/`reusedProviderResponse`; usage ledger carries zero correlation keys (not even runId, despite `generationId` being passed into `stageUsageFromProvider` and dropped).**

## 4. Failure-evidence completeness per failure path

| Path | code | stage | reason | provStatus | provRespId | duration | retryable | recoverable |
|---|---|---|---|---|---|---|---|---|
| Provider terminal (failed/incomplete) | DB-if-persisted | current_stage(until NULL) | e.code persisted | best-effort | best-effort | stageEvents | e.retryable in code | recoverable flag |
| Stage timeout (provider in-flight) | STAGE_TIMEOUT:stage | yes | message | provider in flight — survives | survives if persisted | durationMs event | implied | run→RECOVERING |
| Network fail before create accepted | raw throw | — | e.message only | none | **none possible** | none | unknown | unknown |
| Provider 400 | PROVIDER_INVALID_REQUEST | stage | yes | failed persisted | n/a | — | no | no |
| Provider 429/5xx at create | raw e → PROVIDER_FAILED lastError | — | message | none | **lost** | none | retryable class only | — |
| Poll transient fail ×2 | PROVIDER_POLL_FAILED | — | message | best-effort | yes (if persisted) | — | attempt# not logged | — |
| CONTENT_JSON_INVALID | code in message | yes | +80-char content prefix | via updateStageResponseStatus best-effort | best-effort | — | contract retry once | — |
| Cancellation | GENERATION_CANCELLED | stage | reason | 'cancelled' if write ok | best-effort | durationMs | — | — |
| Schema missing | SCHEMA_MIGRATION_REQUIRED | — | missing[] logged | — | — | — | — | — |

## 5. Historical-incident diagnosability (logs/DB only, no source)

| Incident | Verdict | Why / missing evidence |
|---|---|---|
| factReviewer timeout | **PARTIAL** | `failure_message`/`generation_run_recovering` contain `STAGE_TIMEOUT:factReviewer`; stage + resumability identifiable. Missing: providerResponseId (was response still running?), poll status at timeout, heartbeat age — in events; DB may have it only if best-effort writes landed |
| CONTENT_JSON_INVALID | **PARTIAL** | message embeds stage + 80-char output prefix (ironically the best-preserved evidence); `stage_contract_retry` event shows code+stage. Missing: which attempt in the retry loop, responseId, whether retry succeeded |
| Stage-order violation | **PARTIAL** | raw `STAGE_ORDER_VIOLATION` in `failure_message` + `generation_pipeline_error` event; normalized to GENERATION_INTERNAL_ERROR for UI. Missing: expected vs actual stage in structured fields; which checkpoint fingerprint |
| Khushi CV empty parse | **YES (mostly)** | `cv_import_result`/`cv_parse_failure` carry fileHash context, mimeType, fileSize, strategy attempts chain, coverage, rawTextLength=0. Missing: duration, per-section counts, parser-internal diagnostics |
| DOCLING_UNREADABLE | **PARTIAL** | `cv_parse_failure` reason=DOCLING_UNREADABLE + diagnostics — stable code survives. Missing: which upstream call failed (service down vs file), duration, fallback chain outcome detail |

## 6. Core-state vs telemetry write classification

| Write | Class | On failure today |
|---|---|---|
| createRun / markRunRecovering / failRun / release* / CAS | **CORE STATE** | awaited — propagates (correct) |
| setProviderState / recordStageResponse | **CORE STATE** (drives resume-reuse) | **catch{} swallowed — P0** |
| updateProviderCheck / updateStageResponseStatus | CORE STATE (terminal diagnostics) | **catch{} swallowed — P0** |
| setProviderUsage / setStageResponseUsage | ACCOUNTING | catch{} swallowed |
| markStageStarted/Completed | OBSERVABILITY | catch{} (acceptable-ish, but still silent) |
| heartbeat | CORE STATE (drives recovery detection) | catch{} → premature RECOVERING possible |
| logUsage JSONL | ACCOUNTING | fs failure → console.error only |
| console events | OBSERVABILITY | cannot fail generation |

**Critical gap: three CORE-STATE writes (provider state, stage-response record, terminal diagnostics) are classified as "best-effort" — the provider_error_message incident proved this hides real failures. A telemetry failure never crashes generation (correct); but core-state persistence failure is indistinguishable from telemetry failure.**
