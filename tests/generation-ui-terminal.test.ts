// ============================================================
// GENERATION UI TERMINAL-STATE RECONCILIATION TESTS
// Deterministic — exercises the pure status machine the document
// page uses. No DOM, no network, no provider calls.
// ============================================================
import assert from "node:assert/strict";
import {
  decidePollAction,
  deriveStageProgress,
  isActiveStatus,
  isTerminalStatus,
  isCompletedStatus,
  isTransportFailure,
} from "../src/lib/application/generation-ui-state";
import { startDetached } from "../src/lib/application/generation-start";

const STAGE_IDS = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"] as const;

let passed = 0, failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e: any) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
}

async function main() {
// ---------- status classifiers ----------
await check("classifiers: active/terminal/completed sets", () => {
  for (const s of ["QUEUED", "RUNNING", "RECOVERING", "CANCEL_REQUESTED"]) assert(isActiveStatus(s));
  for (const s of ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"]) {
    assert(isTerminalStatus(s)); assert(!isActiveStatus(s));
  }
  assert(isCompletedStatus("COMPLETED"));
  assert(isCompletedStatus("COMPLETED_WITH_WARNINGS"));
  assert(!isTerminalStatus("RUNNING"));
  assert(!isTerminalStatus(null));
  assert(!isActiveStatus(undefined));
});

// ---------- A. RUNNING factReviewer → COMPLETED → review ----------
await check("A: RUNNING factReviewer → COMPLETED → refresh + clear generating", () => {
  const active = decidePollAction({
    status: "RUNNING", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.deepEqual(active, { updateLive: true, clearGenerating: false, refreshDocument: false, clearError: true });

  const done = decidePollAction({
    status: "COMPLETED", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.deepEqual(done, { updateLive: true, clearGenerating: true, refreshDocument: true, clearError: true });
});

// ---------- B. network error between polls → terminal still wins ----------
await check("B: poll error (no update) then COMPLETED → review shown", () => {
  // Poll 2 failed — liveStatus holds last RUNNING payload. Poll 3:
  const d = decidePollAction({
    status: "COMPLETED", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.equal(d.refreshDocument, true);
  assert.equal(d.clearGenerating, true);
});

// ---------- C. page reload after completion → terminal accepted ----------
await check("C: reload — completed run, generating=false → accepted", () => {
  const d = decidePollAction({
    status: "COMPLETED", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: false, liveGenerationId: undefined, lastSubmitAt: 0,
  });
  assert.deepEqual(d, { updateLive: true, clearGenerating: true, refreshDocument: true, clearError: true });
});

// ---------- D. COMPLETED_WITH_WARNINGS → review + warnings ----------
await check("D: COMPLETED_WITH_WARNINGS → refresh + clear", () => {
  const d = decidePollAction({
    status: "COMPLETED_WITH_WARNINGS", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: 0,
  });
  assert.equal(d.clearGenerating, true);
  assert.equal(d.refreshDocument, true);
});

// ---------- E. FAILED → stops progress ----------
await check("E: FAILED current run → clear generating, no refresh", () => {
  const d = decidePollAction({
    status: "FAILED", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.equal(d.clearGenerating, true);
  assert.equal(d.refreshDocument, false);
});

// ---------- F. RECOVERING → stays active ----------
await check("F: RECOVERING → keep polling, no clear", () => {
  const d = decidePollAction({
    status: "RECOVERING", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.equal(d.updateLive, true);
  assert.equal(d.clearGenerating, false);
});

// ---------- G. stale-run tombstone during regenerate ----------
await check("G: old run's FAILED while new submit in flight → ignored", () => {
  // Previous run failed yesterday; consultant re-submitted — the new
  // row isn't visible yet. The old tombstone must not stop polling.
  const d = decidePollAction({
    status: "FAILED", generationId: "run-old", startedAt: "2026-09-30T13:00:00Z",
    generating: true, liveGenerationId: "run-old", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.deepEqual(d, { updateLive: false, clearGenerating: false, refreshDocument: false, clearError: false });
});

await check("G2: new run's terminal once visible → accepted", () => {
  const d = decidePollAction({
    status: "FAILED", generationId: "run-new", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-new", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.equal(d.clearGenerating, true);
});

// ---------- H. COMPLETED can never be suppressed ----------
await check("H: COMPLETED never suppressed — even for an older run", () => {
  // Worst case: status endpoint reports an OLD completed run while a
  // new submit is in flight. Accepting it is still correct — a
  // completed run means a draft exists; showing review is right.
  const d = decidePollAction({
    status: "COMPLETED", generationId: "run-old", startedAt: "2026-09-19T19:40:00Z",
    generating: true, liveGenerationId: "run-new", lastSubmitAt: Date.now(),
  });
  assert.equal(d.updateLive, true);
  assert.equal(d.clearGenerating, true);
  assert.equal(d.refreshDocument, true);
});

// ---------- Stage display consistency ----------
await check("G3: Verify active ⇒ all preceding stages render complete", () => {
  const p = deriveStageProgress({ currentStage: "factReviewer", completedStages: 4, stageIds: STAGE_IDS });
  assert.equal(p.activeIndex, 5);
  assert.equal(p.completedCount, 5); // floor = activeIndex, not the lagging count
});

await check("G4: no current stage → derive from completedStages", () => {
  const p = deriveStageProgress({ currentStage: null, completedStages: 3, stageIds: STAGE_IDS });
  assert.equal(p.activeIndex, 3);
  assert.equal(p.completedCount, 3);
});

await check("G5: writer active, count 1 → consistent", () => {
  const p = deriveStageProgress({ currentStage: "writer", completedStages: 1, stageIds: STAGE_IDS });
  assert.equal(p.activeIndex, 1);
  assert.equal(p.completedCount, 1);
});

// ---------- H. stale "Generation failed" banner (prod 2026-11-20) ----------
// The generate POST died at nginx's 300s proxy timeout while the run
// went on to COMPLETE at 321s. The banner must clear once the server
// proves the run is alive or finished — and never for a real FAILED.
await check("H1: active poll clears a stale client error", () => {
  const d = decidePollAction({
    status: "RUNNING", generationId: "run-1", startedAt: "2026-11-20T09:02:45Z",
    generating: false, liveGenerationId: "run-1", lastSubmitAt: 0,
  });
  assert.equal(d.clearError, true);
});

await check("H2: COMPLETED poll clears a stale client error", () => {
  const d = decidePollAction({
    status: "COMPLETED", generationId: "run-1", startedAt: "2026-11-20T09:02:45Z",
    generating: false, liveGenerationId: "run-1", lastSubmitAt: 0,
  });
  assert.equal(d.clearError, true);
});

await check("H3: genuine FAILED / CANCELLED keep the error", () => {
  for (const status of ["FAILED", "CANCELLED"]) {
    const d = decidePollAction({
      status, generationId: "run-1", startedAt: "2026-11-20T09:02:45Z",
      generating: false, liveGenerationId: "run-1", lastSubmitAt: 0,
    });
    assert.equal(d.clearError, false, status);
  }
});

await check("H4: IDLE / unknown status keeps the error", () => {
  const d = decidePollAction({
    status: "IDLE", generationId: null, startedAt: null,
    generating: false, liveGenerationId: null, lastSubmitAt: 0,
  });
  assert.equal(d.clearError, false);
});

await check("H5: body-less proxy 502/504 is a transport failure, app errors are not", () => {
  assert.equal(isTransportFailure(504, {}), true);
  assert.equal(isTransportFailure(502, {}), true);
  assert.equal(isTransportFailure(500, {}), false);
  assert.equal(isTransportFailure(504, { error: "X", code: "Y" }), false);
  assert.equal(isTransportFailure(503, { error: "busy", code: "RENDER_BUSY" }), false);
});

// ---------- I. accept-early start (no HTTP request spans the pipeline) ----------
await check("I1: resolves 202 on acceptance while the pipeline keeps running", async () => {
  let finishPipeline!: () => void;
  let pipelineDone = false;
  const res = await startDetached(
    async (onAccepted) => {
      onAccepted("run-42");
      await new Promise<void>((r) => { finishPipeline = r; });
      pipelineDone = true;
      return { status: 200 };
    },
    (id) => ({ status: 202, id }),
    () => { throw new Error("no background error expected"); },
  );
  assert.deepEqual(res, { status: 202, id: "run-42" });
  assert.equal(pipelineDone, false, "response must not wait for the pipeline");
  finishPipeline();
  await new Promise((r) => setImmediate(r));
  assert.equal(pipelineDone, true);
});

await check("I2: pre-acceptance outcomes (blocked / 409) return synchronously", async () => {
  const res = await startDetached(
    async () => ({ status: 409 }),
    () => ({ status: 202 }),
    () => {},
  );
  assert.deepEqual(res, { status: 409 });
});

await check("I3: pre-acceptance throw rejects (route catch releases the lock)", async () => {
  await assert.rejects(
    startDetached(async () => { throw new Error("busy"); }, () => 1, () => {}),
    /busy/,
  );
});

await check("I4: post-acceptance throw goes to onBackgroundError, not the response", async () => {
  const errors: unknown[] = [];
  const res = await startDetached(
    async (onAccepted) => { onAccepted("run-7"); await Promise.resolve(); throw new Error("late"); },
    () => "accepted",
    (e) => errors.push(e),
  );
  assert.equal(res, "accepted");
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /late/);
});

console.log(`\n${passed} passed, ${failed} failed`);

}

main().then(f => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
