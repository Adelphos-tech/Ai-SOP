# STAGE ORCHESTRATION ROOT CAUSE

**Run:** `10c6d2ef-8d71-464d-a6e7-2714e65f5741` — FAILED `STAGE_ORDER_VIOLATION` at 2026-09-20 15:39 CEST, after 4 completed stages (planner→writer→QR→LC), 4 provider calls, zero duplicates.

## Root cause — precise

`StageExecution` keeps an in-memory **cursor** (`stage-execution.ts`). Each stage may only `execute()` when `stage === EXECUTION_STAGES[cursor]`; cursor advances only when a stage completes (provider call or checkpoint replay).

The strictness normalization added a **"skip the Finalizer"** path — `fallBackToCalibrated()` when the plan was inconsistent or metadata retries exhausted — that preserved the calibrated text but **never advanced the cursor**. The pipeline then called `execute("factReviewer")` while the cursor still sat at index 4 (`finalizer`) → `STAGE_ORDER_VIOLATION`.

For this run specifically: QR uncovered topics → `validateFinalizerActionPlan` threw `BoundedFinalizerBlockedError` (FREEZE with missingTopics was treated as an error) → pipeline fell back to calibrated text → skipped the finalizer stage → cursor=4 → factReviewer rejected → run FAILED after spending 4 paid calls.

## Fixes

1. **`stageExecution.skip(stage, output)`** — new deterministic, no-provider stage completion: writes raw + artifact + checkpoint, records a zero-cost usage (`deterministic-fallback`), advances cursor. Enforces the same order check, lock, and persistence as `execute()`.
2. **Pipeline** calls `skip("finalizer", freezeShapedOutput)` whenever the finalizer didn't run — stage 6 proceeds normally.
3. **`bounded-finalizer`** — FREEZE/COMPRESS with `missingTopics` is no longer a plan error (it is the *intended* degradation: preserve verified text, warn upstream).

## Concurrency answers

- **Concurrent pipelines for same run: NO** — file lock (`.execution.lock`, wx-create + PID check) held per attempt dir; second `createStageExecution` → `ATTEMPT_LOCKED`.
- **Duplicate Generate request: SAFE** — service returns 409 `GENERATION_ALREADY_IN_PROGRESS` while a run is active.
- **Multi-process race: N/A** — single PM2 `fork` instance (sop-app). File lock would cover multi-process anyway since it is filesystem-backed (checkpoint dirs live on shared disk).
- **Recovery race: NO** — TECHNICAL_STAGE_RETRY validates journal hash chain + stage index consistency (`CHECKPOINT_INTEGRITY_FAILED`, `TECHNICAL_RETRY_NOT_ALLOWED`, `STALE_CHECKPOINT_REJECTED`) and replays checkpoints without new provider calls.
- **Cross-run contamination: NO** — checkpoints keyed by generationId dir + callId binding + dependency-hash validation.

## Still fatal (technical)

`STAGE_ORDER_VIOLATION`, `ATTEMPT_LOCKED`, `EXECUTION_CLOSED`, `RUN_NOT_ACTIVE`, `CHECKPOINT_INTEGRITY_FAILED`, `STALE_CHECKPOINT_REJECTED`, `TECHNICAL_RETRY_*`, `PERSISTENCE_FAILED_LOCK_RETAINED`.

## Orchestration regression tests

`tests/orchestration-invariants.test.ts` — **7/7 PASS** (order 1→6, out-of-order reject pre-call, skip advances cursor, no re-execute after skip, duplicate executor locked, resume replays checkpoint + retries exactly once, closed executor rejects). Provider calls: 0.

STAGE ORCHESTRATION ROOT FIX VERIFIED — EXACTLY ONE WORKER PER PAID STAGE
