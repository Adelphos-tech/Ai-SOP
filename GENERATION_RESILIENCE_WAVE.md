# Generation Resilience Wave — automatic recovery design

## What changed

### 1. Stage SLA ≠ failure (`openai-transport.ts`)

`waitForBackgroundStage` previously cancelled the provider response the
moment the local stage SLA fired — destroying the ability to resume it.

Now:

- `elapsed > sla` while provider status is `in_progress`/`queued`
  → keep polling the SAME response for a recovery extension
  (`OPENAI_STAGE_RECOVERY_MS`, default 240s).
- Still in-flight past `sla + recovery` → throw
  `StageTimeoutError(recoverable=true)` **without cancelling** —
  the response stays alive and is resumable.
- Terminal provider status at the boundary → cancel + throw
  (unchanged).
- Total generation budget (`MAX_GENERATION_DURATION_MS`) → cancel +
  `GenerationTimeLimitError` (unchanged hard ceiling).

### 2. RECOVERING run state (`generation-lifecycle.ts`)

- New `RECOVERING` status, included in `ACTIVE_RUN_STATUSES`,
  cancellable, completable.
- `markRunRecovering(runId)` — CAS `RUNNING → RECOVERING` bounded by
  `recovery_count < MAX_RUN_RECOVERIES (3)` column.
- On a recoverable stage timeout the pipeline result carries
  `recoverable: true`; `generation-service` marks the run RECOVERING,
  leaves `generation_status=GENERATING` (lock held, double-click blocked).
- Heartbeat stops → status-endpoint poll / startup scan triggers
  `maybeRecoverRun` → resumes the SAME run via `TECHNICAL_STAGE_RETRY`
  → `findReusableProviderResponse` returns the still-`in_progress`
  response → polls it. **Zero duplicate paid calls.**

### 3. Contract-deviation in-run retry (`stage-execution.ts`)

- `CONTENT_JSON_INVALID`, `CONTENT_SCHEMA_INVALID`,
  `AI_STAGE_SCHEMA_INVALID` now `technical=true` — resumable.
- `RETRYABLE_CONTRACT_CODES` — on these failures (plus existing
  `FINALIZER_METADATA_INCOMPLETE`), the call is journaled TECHNICAL and
  the run stays RUNNING while the in-run retry budget remains
  (`stageCalls < maxTechnicalRetries`). Budget exhausted → run fails
  TECHNICAL (still resumable — `failedStageCalls ≤ maxTechnicalRetries`
  satisfies the resume gate).
- `onContentInvalid(responseId)` hook — the pipeline marks the bad
  completed provider response `content_invalid` in
  `generation_stage_responses` so fingerprint reuse never replays it.

### 4. Same-stage auto-retry (`run-application-pipeline.ts`)

`execStage` retries once on `RETRYABLE_CONTRACT_CODES` (except
`FINALIZER_METADATA_INCOMPLETE` — the dedicated corrective-feedback
loop owns it). Earlier stages untouched — checkpoints.

### 5. Error normalization (`generation-errors.ts`)

`classifyGenerationError(raw)` → `{code, class, userMessage,
recoverable, resumable}` — single mapping table. Status endpoint returns
`failureCode`/`failureMessage`(friendly)/`recoverable`; generate
endpoint returns `code` + friendly `error`. Raw internal strings never
reach the UI.

### 6. Lifecycle UX

- `COMPLETED_WITH_WARNINGS` surfaced by status endpoint when a
  completed run persisted warnings (`warnings_json` column).
- Progress card shows the RECOVERING copy ("Generation is taking longer
  than expected. D-Vivid is recovering automatically — your completed
  steps are saved.").
- FAILED card shows "{n} of 6 steps completed" + "Retry Generation".

## Failure classification table

| Error | Before | Now | Auto-retry | Resume | Fallback | User msg |
|---|---|---|---|---|---|---|
| STAGE_TIMEOUT (in-flight) | cancel+FAILED | RECOVERING, no cancel | auto-resume | same provider response | — | provider delay |
| STAGE_TIMEOUT (terminal) | cancel+FAILED | cancel+FAILED, resumable | retry resumes stage | checkpoint | — | provider delay |
| GENERATION_TIME_LIMIT | FAILED | FAILED | manual | checkpoint | — | time limit |
| PROVIDER 5xx/rate-limit terminal | 1 retry | same | yes (1× fresh resp) | checkpoint | — | provider delay |
| PROVIDER_POLL_FAILED | 1 same-response retry | same | yes | checkpoint | — | provider delay |
| PROVIDER_EMPTY_OUTPUT | 1 fresh-response retry | same | yes | — | — | provider delay |
| PROVIDER_INVALID_REQUEST | FAILED | FAILED | no | — | — | config error |
| PROVIDER_INCOMPLETE max_output_tokens | FAILED | FAILED | no | checkpoint | — | truncated |
| PROVIDER_CONTENT_FILTER | FAILED | FAILED | no | — | — | review info |
| PROVIDER_CANCELLED | CANCELLED | CANCELLED | — | checkpoint | — | cancelled |
| CONTENT_JSON_INVALID | FAILED_CONTENT (unresumable) | extract→in-run retry→TECHNICAL fail | yes (1× same stage) | yes | — | recovery required |
| CONTENT_SCHEMA_INVALID | FAILED_CONTENT | same-stage retry | yes | yes | — | recovery required |
| AI_STAGE_SCHEMA_INVALID | FAILED_CONTENT (except finalizer-meta) | same-stage retry | yes | yes | — | recovery required |
| FINALIZER_METADATA_INCOMPLETE | corrective retry ×2 → calibrated fallback | unchanged | yes | yes | calibrated text | warning |
| FACT_REVIEWER_OUTPUT_INVALID | FAILED | FAILED resumable | retry resumes stage 6 | yes | — | recovery required |
| STAGE_ORDER_VIOLATION | raw error | normalized GENERATION_INTERNAL_ERROR | — | checkpoint | — | internal |
| CHECKPOINT_INTEGRITY/STALE/RETRY_LIMIT | raw | normalized internal | — | — | — | internal |
| MISSING_REQUIRED_STUDENT_INFORMATION | FAILED | GENERATION_INPUT_INCOMPLETE | — | — | — | fix fields |
| GENERATION_BLOCKED | 422 | unchanged | — | — | — | fix fields |
| GENERATION_ALREADY_IN_PROGRESS | 409 | unchanged (+RECOVERING holds lock) | — | — | — | running |
| OpenAI key missing | 503 | unchanged | — | — | — | config |
| Circuit open | 503 | unchanged | — | — | — | try later |
| Cancel | CANCELLED + provider cancel | unchanged | — | checkpoint | — | cancelled |
| FINALIZER guard/provenance | warning + calibrated fallback | unchanged | — | — | calibrated text | warning |
| Language calibrator bad output | writer-text fallback | unchanged | — | — | writer text | warning |
| Post-final checks / topics / page / fact advisories | warnings | unchanged | — | — | — | warnings |

## Fact safety

- Fact Reviewer cannot be skipped or faked — `finish(true)` requires all
  six checkpoints; a stage-6 failure leaves the run FAILED/RECOVERING,
  never COMPLETED.
- `COMPLETED_WITH_WARNINGS` is only reachable AFTER successful stage-6
  checkpoint — warnings are advisory only.
