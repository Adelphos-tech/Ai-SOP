# TEST AND OBSERVABILITY AUDIT

## 1. LOGGING / OBSERVABILITY — diagnosability without reproduction

Required fields per generation event vs actual emission:

| Field | Emitted? | Where |
|---|---|---|
| generationId | YES | run-state.json, attempts.jsonl, logUsage |
| documentId | YES | same |
| attempt | YES | attempt dir + attempts.jsonl |
| stage | YES | per-stage usage rows + stage logs |
| status | YES | run-state, lifecycle |
| duration | YES | usage ledger + attempts |
| providerResponseId | YES | gsr rows + stage logs |
| reusedResponse | YES | stage result meta |
| reusedCheckpoint | YES | stage result meta |
| retryNumber | YES | failedStageCalls |
| fallbackUsed | YES | stage result meta |
| warningCount | YES | run row |
| inputTokens/outputTokens/cost | YES | usage ledger (when provider reports) |
| **error code on failure** | **GAP (OBS-001)** | planner failures log success:false with NO error field — 7 local occurrences undiagnosable |

Applicant text: NOT logged — verified (only IDs, hashes, token counts).

**Rotation/retention:** none — logs/append-only forever (OPS-001).

## 2. ERROR NORMALIZATION — UI-reachable error inventory

| Raw error | Normalized to | User copy |
|---|---|---|
| STAGE_TIMEOUT:* | GENERATION_STAGE_TIMEOUT | friendly stage-failure text |
| CONTENT_JSON_INVALID | GENERATION_STAGE_RECOVERY_REQUIRED / PROVIDER_TRUNCATED | normalized |
| invalid_enum_value / Zod | GENERATION_STAGE_RECOVERY_REQUIRED | no Zod paths exposed |
| 429/5xx provider bodies | GENERATION_PROVIDER_DELAY | generic delay text |
| PROVIDER_INCOMPLETE:max_output_tokens | GENERATION_PROVIDER_TRUNCATED | normalized |
| SQL errors | GENERATION_INTERNAL_ERROR | generic |
| CV_* codes | CV_* stable codes | already normalized |
| unclassified | GENERATION_INTERNAL_ERROR | generic fallback |

Remaining exposure: `failureMessage` shown under "View details" — now
contains the normalized message only (endpoint-level normalization). No
stack traces or raw provider bodies reach the client on the audited paths.

## 3. TEST ARCHITECTURE — coverage vs production reality

| Subsystem | Unit | Integration | Regression fixture | Prod-safe smoke |
|---|---|---|---|---|
| stage execution | YES (mock transport) | YES (fs checkpoints) | partial | n/a |
| timeout/recovery | YES (9 resilience tests) | partial — no real clock | n/a | n/a |
| status CAS transitions | **NO DB test (TEST-001)** | — | — | — |
| CV pipeline | YES | YES (real buffers) | YES (khushi classes) | cv-production-upload.cjs |
| requirements | YES | partial | fixtures | — |
| rendering | partial | — | — | — |

**Tests that pass but diverge from production:**

| Divergence | Files | Impact |
|---|---|---|
| mock provider instantly returns scripted statuses | generation-resilience.test.ts | real latency classes (slow progress, stall-then-complete) untested — TEST-003 |
| fixture schemas hand-constructed | several | may accept shapes real provider wouldn't emit |
| no MySQL transition tests | all | RECOVERING CAS / lock races verified by code-review only — TEST-001 |
| duplicate .ts/.mjs harnesses | tests/ | drift risk between twins — some already removed this wave |

## 4. FIXTURE GOVERNANCE

| Fixture | Owned in VCS? | Stale-risk |
|---|---|---|
| phase-17 golden | **NO — gitignored** (TEST-002) | regenerates differently across envs |
| CV benchmark fixtures | YES | medium — two khushi classes pinned |
| requirement fixtures | YES | low |
| run-state fixtures | partial | low |

Recommendation (no change yet): commit generated fixtures OR pin generator
script + seed; delete unreferenced .mjs twins; add a fixture-manifest hash.

## 5. TEST SUITE BASELINE (this audit)

- 23 test files pass; generation-resilience.test.ts = 9 checks.
- All provider-free; zero paid calls.
- node:test TAP files verified via exit codes.
