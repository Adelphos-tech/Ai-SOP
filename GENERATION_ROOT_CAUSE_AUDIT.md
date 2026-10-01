# GENERATION ROOT-CAUSE AUDIT

Six-stage path trace: request → lock → run → contract → provider request →
response ID → polling → normalization → Zod → checkpoint → cursor →
fallback/skip → document version → UI status.

## 1. FACT REVIEWER TIMEOUT — EVIDENCE DECOMPOSITION

Historical record (from PRODUCTION_ERROR_AUDIT.md + run-state):

| Question | Evidence-backed answer |
|---|---|
| Was provider slow? | PARTIAL CONFIRMED — provider response still `in_progress` at local 300s boundary with 1,183 output tokens emitted |
| Was local SLA too short? | CONFIRMED as trigger — 300s SLA cancels while the provider is mid-generation (reasoning models: 300–540s observed range) |
| Was the prompt too verbose? | UNPROVEN — `FACT_REVIEW_OUTPUT_VERBOSE` correlates with the incident timeline but no token-level A/B exists; verbosity ≠ causality |
| Was output schema too large? | SUSPECTED contributor — claim-set serialization adds output tokens, but no baseline schema was A/B'd |
| Reasoning effort the main latency source? | LIKELY CONTRIBUTOR — 976/1,183 output tokens were reasoning at the cancel boundary; effort setting dominates tail latency |
| Was polling inefficient? | NO — bounded polls; jitter ≤700ms; negligible vs provider time |
| Was cancellation policy harmful? | CONFIRMED — cancel at SLA destroyed resumable paid work (GEN-001, now fixed) |
| Was total generation already excessive? | PARTIAL — prior stages consumed significant time, but per-stage budgets were independent; whole-run ceiling 1200s |

**Causal chain (confirmed):** reasoning-heavy stage × local SLA boundary ×
cancel-at-SLA policy → discarded paid work → FAILED. The *fix* (extension
window + no-cancel + RECOVERING resume) addresses the policy; it does not
reduce the underlying latency.

## 2. RECOVERING BEHAVIOR — AUDIT OF NEW PATHS

| Invariant | Status | Evidence |
|---|---|---|
| Same provider response ID reused | PASS | `findReusableProviderResponse` returns in-flight row → `getBackgroundStage(responseId)` not `startBackgroundStage` |
| Poll ≠ new provider call | PASS | only `startBackgroundStage` bills; `getBackgroundStage` is a free read; counter audit §3 |
| Stages 1–5 checkpointed on stage-6 fail | PASS | checkpoints[] preserved; resume replays zero calls |
| recovery_count bounded | PASS | markRunRecovering CAS: `recovery_count < 3` |
| RUNNING→RECOVERING CAS race-safe | PASS | `WHERE status='RUNNING'` conditional update |
| RECOVERING cannot launch parallel generation | PARTIAL | doc lock blocks new gens while lock held — but lock expires at generation_started_at+10min; a RECOVERING run past the lock window + new gen → two pipelines (GEN-004) |
| Status endpoint represents RECOVERING | PASS | normalizeGenerationError → `recovering` status |
| Cancel while recovering | PASS | requestCancelGeneration includes RECOVERING in CAS; transport-level cancel attempted on existing responseId |
| Stale heartbeat recovery safe | PASS | ORPHAN_GRACE_MS=15s + heartbeat 45s → only dead-process runs recover |
| Document stays locked | PASS (within lock window) — see GEN-004 for expiry edge |
| Final fact review still mandatory | PASS | finish(true) requires all 6 checkpoints; fallbacks mark warnings only |

## 3. COUNTER SEMANTICS — Polling vs Request Accounting

| Counter | Where | Counts | Paid? |
|---|---|---|---|
| `startBackgroundStage` invocations | transport.start | new provider request | YES |
| `getBackgroundStage` polls | waitForBackgroundStage loop | status read | NO (free API read) |
| `transportCalls` | stage-execution | one per *fresh* call | YES |
| `failedStageCalls` | stage-execution retry counter | same-stage provider requests | YES, bounded ≤3 |
| `recovery_count` | generation_runs | process-level run resumes | N/A |
| `usedCachedProviderResponse` | pipeline meta | fingerprint hit | NO |
| `reusedResponseId` | stage result | in-flight reuse | NO |

**No off-by-one found.** A resume of an in-flight response increments zero
paid counters. In-run contract retries DO increment `failedStageCalls`
(correct — each is a real provider call) and are capped so the
`failedStageCalls > maxTechnicalRetries` resume rejection remains reachable.

## 4. CHECKPOINT / NO-REPAY — reuse + invalidation matrix

Fingerprint: `contractHash | stage | modelConfigHash | evidenceHash |
promptVersionHash`. Reuse conditions:

- exact fingerprint match + response `completed` + not `content_invalid`
- in-flight response reuse: same fingerprint + status ∈ {queued,in_progress}

Intentional invalidation:

| Change | Invalidates? | Correct? |
|---|---|---|
| input/evidence content | YES (evidenceHash) | YES — factual basis changed |
| model/params | YES (modelConfigHash) | YES |
| prompt version | YES (promptVersionHash) | YES for correctness — but ANY edit re-bills all stages (GEN-008) |
| stage response marked content_invalid | YES | YES — don't replay bad output |
| fingerprint dedup during same attempt | n/a — dedup prevents double-start | YES |

**Harmless-change risk:** a whitespace-only prompt tweak re-bills everything.
Correctness-safe; cost-pessimistic. Acceptable for model-testing.

## 5. CONTENT_JSON_INVALID — historical analysis

All observed instances pre-date this wave. Categories:

| Class | Provider | Count (known) | Disposition |
|---|---|---|---|
| prose+JSON mixed | Gemini exp | multiple | experimental — not production class |
| truncated JSON | Gemini exp | several | same |
| markdown-fence wrapped | Gemini exp | 1-2 | tolerant parser already handles |
| provider incomplete: max_output_tokens | OpenAI prod | 2+ | now → GENERATION_PROVIDER_TRUNCATED + recoverable retry |
| OpenAI CONTENT_JSON_INVALID prod | OpenAI | 0 observed in prod records | — |

**Important separation:** no CONTENT_JSON_INVALID production failure was
observed on the OpenAI path in the retained records; the class was driven by
Gemini experiments + OpenAI truncation. Provider-specific summary:

- OpenAI: rare; driven by token exhaustion → now classified + recoverable
- Gemini (exp): frequent; fenced/prose output → parser salvage mostly worked

## 6. ZOD / CONTRACT FAILURES

Observed classes:

| Failure | Diagnosis |
|---|---|
| invalid_enum_value (tone keywords) | MODEL DEVIATION — schema is correct; enum list enforced. In-run retry now applies |
| missing fields | MODEL DEVIATION — required-field contracts explicit in prompts |
| CONTENT_SCHEMA_INVALID post-repair | correctly rejecting — retry bounded |
| FINALIZER_METADATA_INCOMPLETE | PROMPT CONTRACT MISMATCH (partial) — see PIPE-001; dedicated corrective loop handles it |

No instance of a *correctly-formed* model output being rejected by an
over-strict schema was found. Zod should NOT be weakened.

## 7. STAGE ORDER / CURSOR — transition table

| Path | cursor effect | order safety |
|---|---|---|
| execute() fresh | cursor++ on success | enforced: stage must equal stages[cursor] |
| execute() checkpoint hit | cursor++ w/o call | hash-verified before replay |
| skip() | cursor++ + checkpoint | only called for deterministic fallbacks |
| technical retry | cursor unchanged | stays on same stage |
| contract retry (in-run) | cursor unchanged | bounded, same stage |
| resume | replay checkpoints → cursor restores | STAGE_ORDER_VIOLATION guard preserved |
| cancel/recover | cursor persisted in checkpoints | resume re-derives |

`expectedStage != actualStage` remaining risk: NONE found in expected flows —
the throw on any desync (STAGE_ORDER_VIOLATION) is still active.

## 8. FAILURE STATE CONSISTENCY — DB vs document vs UI

| Scenario | State agreement |
|---|---|
| run FAILED + doc GENERATING | prevented — failRun sets doc FAILED in same error path |
| run RECOVERING + UI FAILED | prevented — endpoint normalizes to `recovering` status |
| doc COMPLETED + missing stage-6 checkpoint | impossible — finish(true) requires all 6 |
| delete during RECOVERING | **GEN-003 GAP** — cascade doesn't check RECOVERING |
| run COMPLETED + doc GENERATING | edge: crash between completeRun and updateDocumentStatus — both are sequential in service; narrow window, recoverable by doc-status reconcile (exists) |

## 9. WARNING SYSTEM

| Property | State |
|---|---|
| persisted | YES — generation_runs.warnings_json (on complete only — GEN-009) |
| returned by endpoint | YES — warnings[] in status payload |
| UI visible | YES — GenerationProgressCard + document page |
| survives recovery | YES — run-row persisted, not attempt-scoped |
| technical vs content mixing | PARTIAL — warnings carry classed codes; UI treats all as informational; content-warning classification is implicit not explicit |

## 10. DATA-MISSING GATES

| Gate | Trigger | Pre/Post provider | Paid cost | Warning-only? |
|---|---|---|---|---|
| MISSING_REQUIRED_STUDENT_INFORMATION | required profile facts absent | PRE | none | NO — facts are load-bearing for provenance |
| REQUIRED_TOPIC_COVERAGE_UNKNOWN | mandatory topics can't be mapped | PRE | none | NO — would guarantee invalid output |

Both gates are pre-provider — no wasted spend. Correctly hard-fail: silent
generation without required facts would violate provenance. **No policy
change recommended.**

## 11. COST AUDIT (evidence-bearing records)

| Run | Stages done | New calls | Reused | Failure | Cost |
|---|---|---|---|---|---|
| doc-0b9aa577 attempt-2 | all 6 | 7 (planner×2) | 0 | success | $0.40 |
| doc-3b6f7b50 attempt-1 | 5/6 | 5 | 0 | finalizer provenance | ~$0.25 billed, usable checkpoints retained |
| planner fails (7 rec.) | 0 | 7 | 0 | validation | minimal (0 tokens reported) |

Highest-cost class: **late-stage failure after 5 paid stages** — the
checkpoint architecture correctly preserves them for reuse.

## 12. PERFORMANCE — per-stage (22 planner, 7 writer, 4+ each other)

From openai-usage ledger (local, OpenAI path only):

| Stage | min | median | p75 | max |
|---|---|---|---|---|
| planner | 10s | 23s | ~60s | 96s |
| writer | 180s | 227s | 293s | 297s |
| qualityReviewer | ~120s | ~160s | — | — |
| languageCalibrator | ~60s | ~90s | — | — |
| finalizer | ~60s | ~90s | — | — |
| factReviewer | — | ~300s+ | — | >300s (cancelled historically) |

**Dominant stage: writer + factReviewer** (reasoning-heavy). Polling overhead
is negligible (<1%); nearly all latency is provider-side processing.
