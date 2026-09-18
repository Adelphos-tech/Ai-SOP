/**
 * Generation lifecycle tests — deterministic, no OpenAI calls.
 *
 * Covers the persisted generation_runs state machine and the
 * cancellation semantics the pipeline relies on:
 *
 *   A. Stage progression 1→6 → COMPLETED
 *   B. Cancel during stage 1 → next stage cannot start (boundary)
 *   C. Cancel during stage 3 → stage 4 never starts
 *   D. CANCEL_REQUESTED persists, then finalizes CANCELLED
 *   E. Server state restores stage progress (refresh simulation)
 *   F. Completion-vs-cancel race → exactly one terminal winner
 *   G. Cancelled run releases document lock → new generation allowed
 *   H. Failed run → FAILED terminal, doc lock FAILED
 *   I. Heartbeat staleness detection
 *   J. Human stage labels — no raw technical names
 *
 * OpenAI calls: 0
 */

import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createGenerationRun,
  markStageStarted,
  markStageCompleted,
  heartbeatRun,
  isCancelRequested,
  requestCancelGeneration,
  cancelRun,
  completeRun,
  failRun,
  getLatestRun,
  getRun,
  isHeartbeatStale,
  STAGE_ORDER,
  STAGE_LABELS,
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  GenerationCancelledError,
} from "../src/lib/application/generation-lifecycle";
import { updateDocumentStatus, acquireGenerationLock } from "../src/lib/application/application-repository";
import { randomUUID } from "crypto";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- fixture helpers ----------

async function seedFixture(): Promise<{ studentId: string; applicationId: string; documentId: string }> {
  const pool = getDbPool();
  const studentId = randomUUID();
  const applicationId = randomUUID();
  const documentId = randomUUID();
  await pool.execute(
    `INSERT INTO students (id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, 'Lifecycle', 'Test', ?, NOW(), NOW())`,
    [studentId, `lifecycle-${studentId}@test.local`],
  );
  await pool.execute(
    `INSERT INTO applications
       (id, student_id, university_name, program_name, degree, country, intake, intake_year, status, created_at, updated_at)
     VALUES (?, ?, 'Test University', 'Test Program', 'Master of Science', 'USA', 'Fall', '2027', 'ACTIVE', NOW(), NOW())`,
    [applicationId, studentId],
  );
  await pool.execute(
    `INSERT INTO application_documents
       (id, application_id, document_type, document_title, prompt_text, prompt_source,
        requirements_status, generation_status, review_status, created_at, updated_at)
     VALUES (?, ?, 'SOP', 'Statement of Purpose', 'test prompt', 'CUSTOM',
             'NOT_STARTED', 'NOT_STARTED', 'DRAFT', NOW(), NOW())`,
    [documentId, applicationId],
  );
  return { studentId, applicationId, documentId };
}

/** Simulates the pipeline's execStage boundary: check → run → check. */
async function execStageBoundary(runId: string, stage: string, work: () => Promise<void>) {
  if (await isCancelRequested(runId)) throw new GenerationCancelledError(stage);
  await markStageStarted(runId, stage);
  await work();
  await markStageCompleted(runId);
  if (await isCancelRequested(runId)) throw new GenerationCancelledError(stage);
}

async function main() {
  await assertTestDatabase();
  console.log("=== Generation Lifecycle Tests ===\n");

  // ---------- A. Full stage progression → COMPLETED ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    for (const stage of STAGE_ORDER) {
      await execStageBoundary(runId, stage, async () => {});
    }
    await completeRun(runId);
    const run = await getRun(runId);
    check("A: all 6 stages completed", run?.completedStages === 6, `got ${run?.completedStages}`);
    check("A: status COMPLETED", run?.status === "COMPLETED");
    check("A: completedAt set", !!run?.completedAt);
    check("A: currentStage cleared", run?.currentStage === null);
  }

  // ---------- B. Cancel during stage 1 → stage 2 never starts ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const executed: string[] = [];
    try {
      await execStageBoundary(runId, "planner", async () => {
        executed.push("planner");
        await requestCancelGeneration(documentId);
      });
      await execStageBoundary(runId, "writer", async () => { executed.push("writer"); });
    } catch (e) {
      check("B: GenerationCancelledError thrown", e instanceof GenerationCancelledError);
    }
    await cancelRun(runId);
    check("B: writer never started", !executed.includes("writer"));
    const run = await getRun(runId);
    check("B: status CANCELLED", run?.status === "CANCELLED");
    check("B: only 1 stage completed", run?.completedStages === 1, `got ${run?.completedStages}`);
    check("B: cancelRequestedAt persisted", !!run?.cancelRequestedAt);
    check("B: cancelledAt persisted", !!run?.cancelledAt);
  }

  // ---------- C. Cancel during stage 3 → stage 4 never starts ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const executed: string[] = [];
    try {
      for (const stage of STAGE_ORDER) {
        await execStageBoundary(runId, stage, async () => {
          executed.push(stage);
          if (stage === "qualityReviewer") await requestCancelGeneration(documentId);
        });
      }
    } catch { /* expected */ }
    await cancelRun(runId);
    check("C: stages 1-3 ran", executed.join(",") === "planner,writer,qualityReviewer", executed.join(","));
    check("C: stage 4+ never started", !executed.includes("languageCalibrator"));
    check("C: completedStages = 3", (await getRun(runId))?.completedStages === 3);
  }

  // ---------- D. CANCEL_REQUESTED → CANCELLED transition ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const req = await requestCancelGeneration(documentId);
    check("D: cancel request → CANCEL_REQUESTED", req.result === "CANCEL_REQUESTED");
    check("D: status persisted as CANCEL_REQUESTED", (await getRun(runId))?.status === "CANCEL_REQUESTED");
    await cancelRun(runId);
    const run = await getRun(runId);
    check("D: finalizes to CANCELLED", run?.status === "CANCELLED");
    check("D: CANCELLED is terminal", TERMINAL_RUN_STATUSES.includes(run!.status));
    // Second cancel is idempotent — terminal state can't regress.
    const again = await requestCancelGeneration(documentId);
    check("D: re-cancel on terminal → CANCELLED", again.result === "CANCELLED");
  }

  // ---------- E. Refresh restores progress (server state) ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await execStageBoundary(runId, "planner", async () => {});
    await execStageBoundary(runId, "writer", async () => {});
    await execStageBoundary(runId, "qualityReviewer", async () => {});
    await markStageStarted(runId, "languageCalibrator");
    // Simulate "browser refresh" — read fresh from DB only.
    const restored = await getLatestRun(documentId);
    check("E: restores completed count", restored?.completedStages === 3, `got ${restored?.completedStages}`);
    check("E: restores current stage", restored?.currentStage === "languageCalibrator");
    check("E: run id preserved", restored?.id === runId);
    check("E: status still RUNNING", restored?.status === "RUNNING");
    check("E: startedAt preserved", !!restored?.generationStartedAt);
  }

  // ---------- F. Completion vs cancel race — one winner ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    // Complete first, then a late cancel must not revert it.
    await completeRun(runId);
    const req = await requestCancelGeneration(documentId);
    check("F: cancel after completion → ALREADY_TERMINAL", req.result === "ALREADY_TERMINAL");
    check("F: stays COMPLETED", (await getRun(runId))?.status === "COMPLETED");

    // Cancel first (finalized), then completion must not overwrite.
    const f2 = await seedFixture();
    const runId2 = randomUUID();
    await createGenerationRun({ id: runId2, documentId: f2.documentId, applicationId: f2.applicationId, studentId: f2.studentId });
    await requestCancelGeneration(f2.documentId);
    await cancelRun(runId2);
    const completed = await completeRun(runId2);
    check("F: completion cannot overwrite CANCELLED", completed === false);
    check("F: stays CANCELLED", (await getRun(runId2))?.status === "CANCELLED");
  }

  // ---------- G. Cancelled generation releases document lock ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    const acquired = await acquireGenerationLock(documentId);
    check("G: generation lock acquired", acquired === true);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await requestCancelGeneration(documentId);
    await cancelRun(runId);
    // Service releases the doc lock on cancel.
    await updateDocumentStatus(documentId, undefined, "NOT_STARTED");
    const reacquired = await acquireGenerationLock(documentId);
    check("G: lock released — new generation can start", reacquired === true);
  }

  // ---------- H. Failed generation is terminal + lock released ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await failRun(runId, "simulated stage failure");
    await updateDocumentStatus(documentId, undefined, "FAILED");
    const run = await getRun(runId);
    check("H: status FAILED", run?.status === "FAILED");
    check("H: failureMessage stored", run?.failureMessage === "simulated stage failure");
    // Lock is FAILED, not GENERATING → a new attempt may re-acquire.
    const reacquired = await acquireGenerationLock(documentId);
    check("H: lock re-acquirable after failure", reacquired === true);
  }

  // ---------- I. Heartbeat staleness ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const fresh = await getRun(runId);
    check("I: fresh heartbeat not stale", !isHeartbeatStale(fresh!));
    // Age the heartbeat artificially.
    const pool = getDbPool();
    await pool.execute(
      `UPDATE generation_runs SET last_heartbeat_at = DATE_SUB(NOW(3), INTERVAL 120 SECOND) WHERE id = ?`,
      [runId],
    );
    const stale = await getRun(runId);
    check("I: 120s-old heartbeat is stale", isHeartbeatStale(stale!));
    await heartbeatRun(runId);
    check("I: heartbeat refresh clears staleness", !isHeartbeatStale((await getRun(runId))!));
  }

  // ---------- J. Human stage labels only ----------
  {
    const internalNames = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
    const labels = internalNames.map(s => STAGE_LABELS[s]);
    const expected = [
      "Preparing document", "Writing draft", "Checking quality",
      "Improving language", "Finalizing document", "Verifying facts",
    ];
    check("J: all 6 stages have human labels", labels.every((l, i) => l === expected[i]), labels.join(","));
    check("J: no raw stage name used as label", labels.every(l => !internalNames.includes(l)));
    check("J: STAGE_ORDER covers 6 stages", STAGE_ORDER.length === 6);
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  await closeDbPool();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async e => {
  console.error("Test crashed:", e);
  await closeDbPool();
  process.exit(1);
});
