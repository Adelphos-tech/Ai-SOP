# Background Responses Migration Report

Date: 2026-09-18
Scope: Generation transport hardening — synchronous Chat Completions →
OpenAI Background Responses with persisted provider state, resumable
stages, bounded SLAs, provider-aware cancellation.

---

## CURRENT FAILURE

```
Generation:
87df5ea0-e50a-4694-adf6-a772b9fa2224
(Document a1535b61 — Writer stage)

Writer attempts:
3 SDK attempts (120s timeout x 3: initial + maxRetries=2)

Total Writer wait:
416,623 ms (~7 min)

Root failure:
HTTP client timeout, not provider failure — synchronous
chat.completions call exceeded the 120s SDK timeout on all three
attempts. Each retry created a NEW request (potential duplicate spend).
The provider was likely still legitimately working.

Identical prior failure: 396d35ee-e285-47bc-8f74-228ac9638133
(395,696 ms, same "Request timed out." error, same document).
```

## HISTORICAL WRITER (28 successful calls, usage log)

```
p50 latency:      36,045 ms
p95 latency:      81,667 ms
p99 latency:      86,342 ms (max observed)

p50 input tokens: 4,020
p95 input tokens: 7,005
max input tokens: 7,225
```

## FAILED DOCUMENT

```
Writer input tokens:  ~3,044 (planner-stage input measured; writer
                      input similar order — no usage row exists for
                      the failed writer attempts)
prompt bytes:         ~12-15 KB (4,020-token p50 ≈ 16 KB; this doc
                      is below p50)
evidence records:     standard bundle (not elevated)
max output:           8,000 tokens (STAGE_MAX_COMPLETION_TOKENS)
reasoning effort:     model default (gpt-5.6-sol; no explicit effort
                      parameter — none exposed in current code)
SDK timeout:          120,000 ms
SDK maxRetries:       2
error class:          TimeoutError ("Request timed out.")
known usage:          none — all three attempts timed out before a
                      response body returned

Was payload abnormally large: NO
(mid-range input; successful writers ran on 2.4x larger payloads)
```

## TRANSPORT

```
OPENAI SDK VERSION:   openai@7.10.0 (supports responses.create /
                      retrieve / cancel + background flag — no
                      upgrade needed)

OLD TRANSPORT:        Chat Completions (synchronous, 120s HTTP timeout)

NEW TRANSPORT:        Background Responses (POST /responses
                      {background:true, store:true}, 30s create
                      timeout, server-side poll ~2.5s)

STORE SETTING:        store:true — required for background polling/
                      cancellation. Response data is retained
                      temporarily by the provider for retrieval; no
                      new data category is introduced.
```

## VERIFICATION (deterministic, zero OpenAI calls)

```
BACKGROUND CREATE:              PASS (mock: create → resp_mock_N,
                                30s-timeout-equivalent path)
PROVIDER RESPONSE ID PERSISTED: PASS (generation_runs +
                                generation_stage_responses written
                                BEFORE first poll)
PROVIDER POLLING:               PASS (80-poll in_progress sequence
                                completed; no timeout, no retry)
CANCEL PROVIDER RESPONSE:       PASS (cancel during in_progress →
                                transport.cancel invoked →
                                GenerationCancelledError)
PM2 RESTART RECOVERY:           PASS (seeded in_progress provider
                                state → resumed polling, no new
                                create)
NO DUPLICATE STAGE ON RECOVERY: PASS (fingerprint reuse — completed
                                stages return stored output, zero
                                new provider calls)
STAGE SLA:                      PASS (OPENAI_STAGE_SLA_* → provider
                                cancel + STAGE_TIMEOUT)
TOTAL GENERATION SLA:           PASS (MAX_GENERATION_DURATION_MS →
                                cancel + GENERATION_TIME_LIMIT)
RETRY POLICY:                   PASS (transient → exactly 1 retry;
                                invalid_request → 0; retrieval →
                                same id, no new create)
CIRCUIT BREAKER:                PASS (3 distinct transient provider
                                failures → open → 503
                                AI_SERVICE_TEMPORARILY_UNAVAILABLE)
USAGE ACCOUNTING:               PASS (completed → tokens + cost
                                logged; unavailable → USAGE_UNKNOWN,
                                never zero-as-free)
STRUCTURED OUTPUT COMPATIBILITY: PASS (parseStage + schema
                                validation untouched — same JSON
                                output contract)
EXISTING FACT SAFETY:           PASS (38/38 lifecycle regressions;
                                fact-safety path unchanged)
```

## TEST RESULTS

```
background-transport-tests.ts:  29/29 PASS  (test DB: sop_ai_app_test)
generation-lifecycle-tests.ts:  38/38 PASS  (regression — unchanged)
typecheck:                      PASS
build:                          PASS
migration:                      applied to sop_ai_app + sop_ai_app_test
deploy:                         GitHub Actions run 35371627231 SUCCESS
post-deploy smoke:              app 200, generation-status 200,
                                no recovery errors, no fresh
                                privilege errors

OPENAI CALLS:                   0
```

## ACCEPTANCE — the core scenario

A Writer taking >120s while OpenAI reports `in_progress` now:

- keeps waiting (server-side provider poll ~2.5s)
- keeps heartbeat healthy (existing 8s lifecycle heartbeat)
- keeps the UI alive (Write remains the active stage; after ~90s the
  card adds "taking a little longer than usual" — no failure shown)
- does NOT retry solely because 120s passed
- does NOT create a duplicate response

Only these can stop it: provider terminal error, stage SLA (480s
default, env-tunable), total generation SLA (20min), explicit cancel.

## ROLLOUT

- `OPENAI_BACKGROUND_RESPONSES_ENABLED` defaults ON (tests green).
- `=0` restores the legacy chat.completions path (temporary emergency
  rollback; remove after stabilization).
- Per-stage SLA env vars: OPENAI_STAGE_SLA_{PLANNER,WRITER,
  QUALITY_REVIEWER,LANGUAGE,FINALIZER,FACT_REVIEWER}_MS.
- MAX_GENERATION_DURATION_MS (default 1,200,000).

## PENDING

- First REAL generation requires manual approval — not triggered
  automatically.
- Recovery via instrumentation.ts runs on server start; the
  generation-status endpoint also triggers recovery for orphaned
  runs (>15s heartbeat age, no live in-process execution).
