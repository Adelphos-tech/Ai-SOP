# ERROR TAXONOMY AUDIT
Central classifier: `src/lib/application/generation-errors.ts` (`classifyGenerationError`,
9 regex rules → stable client code + class + userMessage + recoverable/resumable).

## 1. Coverage vs actual error codes found in source

### Correctly classified (rule matches)

| Raw code | Rule | Client code | Class |
|---|---|---|---|
| STAGE_TIMEOUT:* | `^STAGE_TIMEOUT` | GENERATION_PROVIDER_DELAY | TRANSIENT_PROVIDER (resumable) |
| GENERATION_TIME_LIMIT | `^GENERATION_TIME_LIMIT` | GENERATION_TIME_LIMIT | TECHNICAL_RECOVERABLE |
| PROVIDER_FAILED / PROVIDER_POLL_FAILED / PROVIDER_EMPTY_OUTPUT / PROVIDER_SERVER_ERROR / PROVIDER_RATE_LIMIT | `^PROVIDER_(FAILED\|POLL_FAILED\|...)` | GENERATION_PROVIDER_DELAY | TRANSIENT_PROVIDER |
| PROVIDER_MAX_OUTPUT_TOKENS / PROVIDER_INCOMPLETE / "Provider incomplete:*" | rule | GENERATION_PROVIDER_TRUNCATED | TECHNICAL_RECOVERABLE |
| PROVIDER_CONTENT_FILTER | rule | GENERATION_CONTENT_FILTERED | USER_ACTION_REQUIRED |
| CONTENT_JSON_INVALID / CONTENT_SCHEMA_INVALID / AI_STAGE_SCHEMA_INVALID / EMPTY_CONTENT / FINALIZER_METADATA_INCOMPLETE | rule | GENERATION_STAGE_RECOVERY_REQUIRED | TECHNICAL_RECOVERABLE |
| STAGE_ORDER_VIOLATION / CHECKPOINT_INTEGRITY* / STALE_CHECKPOINT* / TECHNICAL_RETRY_LIMIT / RUN_NOT_ACTIVE / ATTEMPT_LOCKED / USAGE_RECORD_MISMATCH / INVALID_USAGE_RECORD / MULTIPLE_USAGE_RECORDS / LATE_USAGE_CALLBACK / INCOMPLETE_STAGE_CHAIN | rule | GENERATION_INTERNAL_ERROR | INTERNAL |
| MISSING_REQUIRED_STUDENT_INFORMATION / GENERATION_BLOCKED / GENERATION_CONTRACT_REQUIRED | rule | GENERATION_INPUT_INCOMPLETE | DATA_MISSING |
| GENERATION_ALREADY_IN_PROGRESS / generation_lock_conflict | rule | GENERATION_ALREADY_IN_PROGRESS | USER_ACTION_REQUIRED |
| FACT_REVIEWER_OUTPUT_INVALID | rule | GENERATION_STAGE_RECOVERY_REQUIRED | TECHNICAL_RECOVERABLE |
| GENERATION_CANCELLED | rule | GENERATION_CANCELLED | USER_ACTION_REQUIRED |

### Unclassified → falls to DEFAULT (GENERATION_INTERNAL_ERROR / recoverable:true)

| Error | Where raised | Problem |
|---|---|---|
| `SCHEMA_MIGRATION_REQUIRED` | generation-schema.ts assert | **Misclassified**: routes special-case it before classify, but if it ever flows through `failRun`/`classify` it reports recoverable=true INTERNAL — should be its own class (operator action, not retryable) |
| `RUN_SUPERSEDED` / `SUPERSEDED_BY_NEWER_RUN` / GenerationSupersededError | repository/service | Service handles the exact string "RUN_SUPERSEDED" pre-classify; GenerationSupersededError thrown inside repository helpers → INTERNAL if it reaches failRun |
| Dynamic `PROVIDER_${e.code}` | run-application-pipeline.ts:582 | e.code is provider-controlled; codes outside the rule set (e.g. `PROVIDER_EXPIRED`, `PROVIDER_QUOTA`) → INTERNAL (recoverable flag wrong direction) |
| `PROVIDER_INVALID_REQUEST` | pipeline | Matches NO rule → INTERNAL. Stable code exists; arguably correct class, but note it was a deliberate "fatal contract" decision |
| Raw transport errors (ETIMEDOUT/ECONNRESET/EAI_AGAIN/"Provider did not return a response id") | openai-transport create/retrieve raw throws | If they reach failure_message verbatim → INTERNAL default (classified, but error *category* is "unknown network" not surfaced distinctly) |
| DB errors (ER_BAD_FIELD_ERROR, ER_DUP_*, deadlocks, lock-wait) | lifecycle/repository | Reach `failure_message` raw → INTERNAL; DB error class collapsed — cannot distinguish schema-missing vs deadlock from code alone |
| `GenerationSupersededError` message | repository helpers | → INTERNAL (see RUN_SUPERSEDED) |
| MigrationBlockedError | migration runner only | Operator-facing; never reaches classifier — fine |

**Unclassified/misclassified runtime paths: ~7.**

### Raw-provider passthrough

`throw new StageExecutionError(`PROVIDER_${e.code}`)` (pipeline :582) is the only
pass-through that wraps a provider code — it is *wrapped*, not raw. Truly raw
provider bodies/messages can reach `failure_message` via `e.message` propagation
(e.g. `ProviderTerminalError` message text), and reach the **UI** via the route
defects below.

## 2. Raw technical errors reaching the UI

| Route | What leaks |
|---|---|
| `api/sop/generate-application/route.ts:138` | `error: result.error` returned raw — stage names (`STAGE_TIMEOUT:factReviewer`), internal codes, and for CONTENT_JSON_INVALID **an 80-char model-output prefix**. Biggest UI leak. |
| `api/application/cv-apply/route.ts:350` | `error?.message` raw in 500 |
| `api/application/delete/route.ts` | `error?.message` raw in 500 |
| `api/application/student/delete/route.ts` | `error?.message` raw in 500 |
| `api/application/document/delete/route.ts` | `error?.message` raw in 500 |
| `api/sop/generate/route.ts:314` | regex-sanitized message — strips ports/paths only; stage codes, `invalid_enum_value`, provider error text pass through |
| `api/application/document/generate/route.ts` | `sanitizeErrorMessage` strips ports/paths only — same residual exposure |

`generation-status` route is correct: `classifyGenerationError(run.failureMessage)`
→ stable code + userMessage. `document/generation/cancel` and `generation-status`
handle SCHEMA_MIGRATION_REQUIRED with a friendly message.

**Raw technical errors reaching UI: 6 paths (5 unsanitized + generate-application raw; plus 2 regex-sanitized partials).**

## 3. Event/field naming inconsistency

Mixed conventions observed:
- `error:` (free-text message), `reason:` (CV events), `code:`/`errorCode:`/`failureCode` — three names for the same concept.
- Event envelope: `JSON.stringify({event,...})` vs `[cv-apply] TAG k=v` text warns vs bare `console.error("X:", err)` objects.
- IDs: `generationId` means run-id in service events but means attempt-id in usage ledger context (`stageUsageFromProvider` opts.generationId = run id). Naming collision.

## 4. Recommended canonical envelope (design only — NOT implemented)

```ts
{
  event, timestamp, level,                      // required
  requestId?,                                   // per-request or recovery-<run8>
  generationId?, generationRunId?, attemptSeq?,
  documentId?, applicationId?, studentId?,      // ids only, never content
  stage?, status?,                              // currentStage/status enum
  errorCode?, errorClass?, retryable?,          // stable, classified
  durationMs?,
  provider?, model?, providerResponseId?,
  retryNumber?, recoveryCount?,
  reusedCheckpoint?, reusedProviderResponse?,
  inputTokens?, outputTokens?, reasoningTokens?,
  cachedInputTokens?, costUsd?, chargedNew?     // accounting
}
```

Rules: ids + enums + counts + codes only; **no content payloads, prompts,
document bodies, names, emails**; `failureMessage` content snippets eliminated.
One `errorCode` field name; `reason` merged into `errorCode`+`detail`.
