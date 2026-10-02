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
} from "../src/lib/application/generation-ui-state";

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
  assert.deepEqual(active, { updateLive: true, clearGenerating: false, refreshDocument: false });

  const done = decidePollAction({
    status: "COMPLETED", generationId: "run-1", startedAt: "2026-10-02T07:48:00Z",
    generating: true, liveGenerationId: "run-1", lastSubmitAt: Date.parse("2026-10-02T07:47:59Z"),
  });
  assert.deepEqual(done, { updateLive: true, clearGenerating: true, refreshDocument: true });
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
  assert.deepEqual(d, { updateLive: true, clearGenerating: true, refreshDocument: true });
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
  assert.deepEqual(d, { updateLive: false, clearGenerating: false, refreshDocument: false });
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

console.log(`\n${passed} passed, ${failed} failed`);

}

main().then(f => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
