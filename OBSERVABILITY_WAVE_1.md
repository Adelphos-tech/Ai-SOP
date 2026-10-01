# OBSERVABILITY WAVE 1 — CORE STATE + PAID-CALL EVIDENCE

Remediation of the deep observability audit's P0/P1 findings. This wave
does not change generation semantics — it makes evidence durable and
prevents silent evidence loss from causing duplicate paid work.

## Persistence classification (`src/lib/observability/events.ts`)

`PERSISTENCE_CLASS` makes every durable write explicitly one of:

| Class | Writes | Failure policy |
|---|---|---|
| CORE_STATE | run create/status transitions, document ownership, document version, `provider_response_id`, dedup `recordStageResponse`, terminal diagnostics | retry once → typed halt; never swallowed |
| ACCOUNTING | `setProviderUsage`/`setStageResponseUsage`, `openai-usage.jsonl` rows | warn event → continue |
| TELEMETRY | intermediate poll-status writes, heartbeat, stage marks, console events | warn event → continue |

`emitEvent(event, fields, level)` is the single canonical emitter —
whitelisted keys only (PII/content structurally impossible), never throws.

## Duplicate-paid-request prevention

`callOpenAIForStageBackground` reuse chain (ordered by authority):

1. run's persisted provider state (`getRun` — CORE_STATE read; failure → halt recoverable)
2. stage+fingerprint dedup index (`findReusableProviderResponse` — failure → halt recoverable)
3. attempt-dir `provider-responses.jsonl` fallback — written when DB identity persistence fails, so recovery still finds the paid response across restarts

If `setProviderState` fails after a response exists: the id is written to
the fallback file, `generation_state_persistence_failed` is emitted, and
the run throws `GENERATION_STATE_PERSISTENCE_FAILED` (technical +
recoverable → RECOVERING). No second provider request is created.

Checkpoint/artifact write failures poison the executor —
`GENERATION_CHECKPOINT_PERSISTENCE_FAILED` is thrown before the cursor
advances; the next paid stage is never called.

## Usage ledger schema (`UsageLogEntry`)

New fields: `generationId`, `generationRunId`, `attemptSeq`,
`documentId`, `provider`, `providerResponseId`, `requestKind`
(`NEW_PROVIDER_REQUEST`/`REUSED_PROVIDER_RESPONSE`/`POLL`/
`RETRY_NEW_PROVIDER_REQUEST`), `errorCode`, `usageStatus`
(`USAGE_KNOWN`/`USAGE_UNKNOWN`/`NOT_CHARGED_CONFIRMED`). Tokens are
`null` when unavailable — never invented zero.

## Events added/enriched

`generation_recovery_entered`, `generation_recovery_claimed`,
`generation_checkpoint_reused`, `generation_provider_response_reused`
(`detail`: run_state | fingerprint_dedup | fallback_file),
`generation_recovery_completed`, `generation_recovery_failed`,
`generation_superseded` (oldAttemptSeq + newAttemptSeq),
`generation_cancel_requested`, `generation_provider_cancel_issued`,
`provider_cancel_failed`, `provider_terminal_state`,
`provider_request_create_failed`, `generation_state_persistence_failed`,
`generation_checkpoint_persistence_failed`,
`generation_stage_response_record_failed`,
`provider_status_persist_failed`, `provider_usage_persist_failed`,
`provider_response_status_persist_failed`,
`generation_heartbeat_failed`, `generation_stage_mark_failed`,
`usage_ledger_write_failed`, `provider_fallback_write_failed`,
`student_deleted`, `application_deleted`, `document_deleted`,
`cv_identity_conflict_override`, `cv_replace_derived`.

All lifecycle events now carry `generationRunId`/`attemptSeq`/
`documentId`/`requestId` when available.

## Route boundaries

`result.error` / `error.message` verbatim removed from:
`sop/generate-application`, `sop/generate`, `document/generate`,
`cv-apply`, `requirements/resolve-prompt`, `requirements/discover`,
`requirements/verify`, `requirements/resolve`, `benchmark/run`.
All now return stable `code` + consultant-safe message; raw detail stays
in server logs.

## Error taxonomy additions (`generation-errors.ts`)

`SCHEMA_MIGRATION_REQUIRED`, `GENERATION_SUPERSEDED`,
`GENERATION_NOT_RESUMABLE`, `GENERATION_STATE_PERSISTENCE_FAILED`,
`GENERATION_CHECKPOINT_PERSISTENCE_FAILED`, `PROVIDER_INVALID_REQUEST`,
`PROVIDER_QUOTA`, `PROVIDER_RATE_LIMIT`, `PROVIDER_SERVER_ERROR`,
`PROVIDER_NETWORK_ERROR`, `PROVIDER_POLL_FAILED`.

## PII scrubbing

- cv-apply identity-override log: names/emails removed (ids only)
- student-delete log: name/email removed
- document-delete log: document title removed (may embed names)
- `CONTENT_JSON_INVALID` / planner parse errors: model-output prefixes removed
- `plan-sop` `PLANNER ERROR`: raw provider error object removed

## Attempt-artifact retention

`logs/attempts/<uuid>/` = DEBUG ARTIFACTS (raw model output + drafts).
`cleanupAttemptArtifacts()` removes dirs older than
`ATTEMPT_ARTIFACT_TTL_DAYS` (default 14) that hold no `.execution.lock`.
Operator command: `npm run cleanup:attempt-artifacts`.

## Deterministic tests — `tests/observability-wave1-tests.ts`

61 checks covering spec A–J + TTL (K). Zero provider calls, zero DB.
