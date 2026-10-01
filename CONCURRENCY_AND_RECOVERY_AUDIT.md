# CONCURRENCY AND RECOVERY AUDIT

## 1. RACE SCENARIO MATRIX

| Scenario | Mechanism | Verdict |
|---|---|---|
| double-click generate | document lock (DB row + file lock) | SAFE — second request rejected |
| generate while RECOVERING | doc still GENERATING + lock | SAFE within lock window |
| generate after lock expiry (10min) while run RECOVERING | lock released on age; new run allowed | **RISK (GEN-004)** — old run can still be recovered by status-poll → two pipelines |
| manual retry after FAILED | resumeRunId reuses run; new attempt dir | SAFE — fingerprints dedup provider calls |
| cancel during background poll | CAS CANCEL_REQUESTED → provider cancel attempted | SAFE — persisted before cancel |
| cancel while RECOVERING | requestCancelGeneration includes RECOVERING | SAFE |
| delete while RECOVERING | cascade guard misses RECOVERING | **BUG (GEN-003)** |
| two browser tabs polling status | maybeRecoverRun on each GET; run_resume lock prevents double-spawn | SAFE-ish — resume idempotent, but GET-with-side-effects is fragile (GEN-006) |
| PM2 restart mid-generation | process death → heartbeat stale → startup/status recovery resumes | SAFE — checkpoint + provider-ID resume |
| multiple PM2 workers | in-process registries diverge | **FUTURE RISK (GEN-010)** — single instance assumed |

## 2. RECOVERING DEEP-AUDIT (no paid runs — code+test evidence)

| Check | Result |
|---|---|
| same provider response reused | YES — gsr row + fingerprint → getBackgroundStage(id) |
| no duplicate provider call | YES — start only if no reusable row |
| stages 1–5 untouched | YES — checkpoint replay |
| recovery_count loop bound | YES — `<3` CAS bound |
| CAS race | YES — `WHERE status='RUNNING'` |
| parallel gen blocked | YES while lock valid — GEN-004 expiry edge |
| status endpoint truthful | YES — recovering normalized |
| cancel-safe | YES |
| stale-heartbeat safe | YES — 45s heartbeat vs 15s grace: heartbeat must be 3+ cycles stale |
| lock hygiene | YES — attempt dir lock per run; PID-alive check |
| fact review mandatory | YES — finish(true) requires 6/6 checkpoints |

## 3. STAGE RETRY ACCOUNTING — counter semantics

| Concept | Counter | Increments on | Paid? |
|---|---|---|---|
| provider request | transportCalls / gsr insert | startBackgroundStage only | YES |
| provider poll | (none — free) | getBackgroundStage | NO |
| technical retry | failedStageCalls | re-execute same stage | YES (new call) |
| contract retry | in-run bounded loop | same-stage re-request | YES |
| run retry | recovery_count | process resume | NO (dedup'd calls) |
| recovery attempt | attempts/* dir | new execution context | metadata only |

Polls are never counted as paid requests — confirmed by the gsr/fingerprint
logic: only a NEW `startBackgroundStage` writes a new response row.
**No off-by-one found.** In-run contract retries correctly consume the
`failedStageCalls` budget so the resume-rejection gate stays reachable.

## 4. CHECKPOINT REUSE — proof + invalidation conditions

Reuse happens when: fingerprint matches + response completed + not
content_invalid (cross-run gsr reuse), or checkpoint inputHash matches
(in-run replay).

Invalidation inventory:

| Reason | Intentional | Note |
|---|---|---|
| input changed | yes | evidenceHash |
| prompt changed | yes | promptVersionHash — blunt (GEN-008) |
| model changed | yes | modelConfigHash |
| schema changed | yes | contractHash |
| evidence changed | yes | — |
| contract changed | yes | — |
| response marked content_invalid | yes | new this wave — prevents bad replay |

**Unnecessary invalidation:** only cosmetic prompt-version bumps re-bill
everything. No other over-invalidation found.

## 5. FAILURE-STATE CONSISTENCY — remaining disagreement windows

| Window | Risk | Status |
|---|---|---|
| version insert → completeRun crash | stray version, run still RUNNING | recoverable — run resumes, recomputes |
| completeRun → doc status update crash | run COMPLETED, doc GENERATING | reconciled by next reconcile pass (exists) |
| delete vs RECOVERING | GEN-003 | OPEN |
| stale lock + RECOVERING resume | GEN-004 | OPEN |

## 6. LOCKING — file lock + DB lock duality

- `.execution.lock` per attempt dir, PID-owned, stale-PID reclaimable.
- DB lock on application_documents with generation_started_at freshness.
- Locks never deleted while owner PID alive — verified.
- Edge: DB lock expires on wall-clock only; a live-but-slow recovery past
  10min loses lock protection (GEN-004 family).
