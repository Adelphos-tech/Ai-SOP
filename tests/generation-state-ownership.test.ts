/**
 * generation-state-ownership.test.ts — Remediation Wave 1
 *
 * DB-level integration tests for GEN-003 (delete safety) and GEN-004
 * (run supersession / document ownership). Runs against the isolated
 * sop_ai_app_test database via tests/test-setup.ts — the hard guard
 * aborts if connected to anything else.
 *
 * Race matrix (spec §6):
 *   A. RUNNING + delete            → blocked
 *   B. RECOVERING + delete         → blocked  (GEN-003 fix)
 *   C. CANCEL_REQUESTED + delete   → blocked
 *   D. FAILED + delete             → cleanup allowed
 *   E. Run A RECOVERING, Run B authoritative, A wakes
 *        → A cannot continue/finalize (superseded)
 *   F. Run A recovery + Run B start concurrently → exactly one owns doc
 *   G. two recovery workers claim same run → one effective continuation
 *   H. cancel vs recovery race → cancelled run cannot resume
 *   I. delete after CANCEL_REQUESTED → blocked until terminal
 *   J. new run after terminal FAILED → allowed and authoritative
 *
 * Plus: application/student cascade active-run guards, owner-guarded
 * completeRun, isRunDocumentOwner semantics, canonical status helpers.
 *
 * OpenAI calls: 0
 */

import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createGenerationRun,
  getRun,
  getLatestRun,
  completeRun,
  failRun,
  cancelRun,
  requestCancelGeneration,
  markRunRecovering,
  claimRunForResume,
  isActiveGenerationStatus,
  isTerminalRunStatus,
  ACTIVE_GENERATION_STATUSES,
  TERMINAL_RUN_STATUSES,
  runStatusInSql,
} from "../src/lib/application/generation-lifecycle";
import {
  acquireGenerationLock,
  adoptRunOwnership,
  isRunDocumentOwner,
  releaseDocumentGeneration,
  releaseOrphanedDocumentLock,
  deleteDocumentCascade,
  deleteApplicationCascade,
  deleteStudentCascade,
} from "../src/lib/application/application-repository";
import { randomUUID } from "crypto";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function seedFixture(): Promise<{ studentId: string; applicationId: string; documentId: string }> {
  const pool = getDbPool();
  const studentId = randomUUID();
  const applicationId = randomUUID();
  const documentId = randomUUID();
  await pool.execute(
    `INSERT INTO students (id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, 'Ownership', 'Test', ?, NOW(), NOW())`,
    [studentId, `own-${studentId}@test.local`],
  );
  await pool.execute(
    `INSERT INTO applications
       (id, student_id, university_name, program_name, degree, country, intake, intake_year, status, created_at, updated_at)
     VALUES (?, ?, 'Test University', 'Test Program', 'MS', 'USA', 'Fall', '2027', 'ACTIVE', NOW(), NOW())`,
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

async function docRow(documentId: string): Promise<any> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT generation_status, active_generation_run_id, generation_started_at FROM application_documents WHERE id = ?",
    [documentId],
  );
  return (rows as any[])[0];
}

async function setDocStatus(documentId: string, status: string) {
  const pool = getDbPool();
  await pool.execute("UPDATE application_documents SET generation_status = ? WHERE id = ?", [status, documentId]);
}

async function main() {
  await assertTestDatabase();
  console.log("=== Generation State Ownership Tests (DB) ===\n");

  // ---------- Canonical status domain ----------
  {
    check("canon: 4 active statuses", ACTIVE_GENERATION_STATUSES.length === 4);
    check("canon: RECOVERING is active", isActiveGenerationStatus("RECOVERING"));
    check("canon: CANCEL_REQUESTED is active", isActiveGenerationStatus("CANCEL_REQUESTED"));
    check("canon: FAILED not active", !isActiveGenerationStatus("FAILED"));
    check("canon: terminal predicate", isTerminalRunStatus("COMPLETED") && isTerminalRunStatus("FAILED") && isTerminalRunStatus("CANCELLED"));
    check("canon: sql fragment", runStatusInSql(ACTIVE_GENERATION_STATUSES) === "'QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED'");
  }

  // ---------- A. RUNNING + delete → blocked ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const res = await deleteDocumentCascade(documentId, applicationId);
    check("A: delete while RUNNING blocked", res === "GENERATING", `got ${res}`);
    check("A: document still exists", !!(await docRow(documentId)));
    check("A: run row preserved", (await getRun(runId))?.status === "RUNNING");
    check("A: doc still GENERATING", (await docRow(documentId))?.generation_status === "GENERATING");
  }

  // ---------- B. RECOVERING + delete → blocked (GEN-003) ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await markRunRecovering(runId, "simulated SLA breach");
    check("B: run is RECOVERING", (await getRun(runId))?.status === "RECOVERING");
    const res = await deleteDocumentCascade(documentId, applicationId);
    check("B: delete while RECOVERING blocked", res === "GENERATING", `got ${res}`);
    check("B: run row preserved", (await getRun(runId))?.status === "RECOVERING");
    // Drift edge: doc flag not GENERATING but run still RECOVERING —
    // the defensive run-level check must still block the delete.
    await setDocStatus(documentId, "NOT_STARTED");
    const res2 = await deleteDocumentCascade(documentId, applicationId);
    check("B: drifted doc + RECOVERING run still blocked", res2 === "GENERATING", `got ${res2}`);
  }

  // ---------- C. CANCEL_REQUESTED + delete → blocked ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await requestCancelGeneration(documentId);
    check("C: run is CANCEL_REQUESTED", (await getRun(runId))?.status === "CANCEL_REQUESTED");
    const res = await deleteDocumentCascade(documentId, applicationId);
    check("C: delete while CANCEL_REQUESTED blocked", res === "GENERATING", `got ${res}`);
  }

  // ---------- D. FAILED + delete → cleanup allowed ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await failRun(runId, "simulated failure");
    await releaseDocumentGeneration(documentId, runId, "FAILED");
    const res = await deleteDocumentCascade(documentId, applicationId);
    check("D: delete after FAILED allowed", res === "DELETED", `got ${res}`);
    check("D: document gone", !(await docRow(documentId)));
    check("D: run row deleted", (await getRun(runId)) === null);
  }

  // ---------- E. A RECOVERING; B authoritative; A wakes → superseded ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA breach");
    // Stale the doc lock so B can legitimately acquire it.
    const pool = getDbPool();
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    const acquiredB = await acquireGenerationLock(documentId, runB);
    check("E: B acquires stale lock", acquiredB === true);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    // A wakes up (recovery): claim CAS itself is rejected — a newer run
    // row exists (B). The adoption check is a second independent gate.
    const claimedA = await claimRunForResume(runA);
    check("E: A claim rejected — newer run supersedes", claimedA === false);
    check("E: A stays RECOVERING (no RUNNING flip)", (await getRun(runA))?.status === "RECOVERING");
    const adoptedA = await adoptRunOwnership(documentId, runA);
    check("E: A CANNOT adopt ownership — superseded", adoptedA === false);
    check("E: A is not document owner", !(await isRunDocumentOwner(documentId, runA)));
    check("E: B IS document owner", await isRunDocumentOwner(documentId, runB));
    // A must not finalize/complete or touch doc state.
    const completedA = await completeRun(runA, []);
    check("E: completeRun on superseded A rejected by CAS", completedA === false);
    await failRun(runA, "SUPERSEDED_BY_NEWER_RUN");
    check("E: A marked FAILED terminal", (await getRun(runA))?.status === "FAILED");
    check("E: doc still GENERATING under B", (await docRow(documentId))?.generation_status === "GENERATING");
    check("E: doc owner column is B", (await docRow(documentId))?.active_generation_run_id === runB);
    check("E: B unaffected — still RUNNING", (await getRun(runB))?.status === "RUNNING");
  }

  // ---------- F. A recovery + B start concurrently → exactly one owner ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    const pool = getDbPool();
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    // Interleave: A claims first, then B acquires → B wins ownership,
    // A's adoption must fail.
    await claimRunForResume(runA);
    const acquiredB = await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    const adoptedA = await adoptRunOwnership(documentId, runA);
    check("F: B lock acquisition succeeded", acquiredB === true);
    check("F: A adopt rejected", adoptedA === false);
    check("F: exactly one owner (B)", (await docRow(documentId))?.active_generation_run_id === runB);
    check("F: A superseded check fails", !(await isRunDocumentOwner(documentId, runA)));
  }

  // ---------- G. two recovery workers → one effective claim ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await markRunRecovering(runId, "SLA");
    const [w1, w2] = await Promise.all([
      claimRunForResume(runId),
      claimRunForResume(runId),
    ]);
    check("G: exactly one resumer claims", (w1 ? 1 : 0) + (w2 ? 1 : 0) === 1, `w1=${w1} w2=${w2}`);
    check("G: run is RUNNING", (await getRun(runId))?.status === "RUNNING");
    // Third worker (heartbeat now fresh) cannot re-claim a RUNNING run.
    const w3 = await claimRunForResume(runId);
    check("G: fresh-heartbeat RUNNING not claimable", w3 === false);
  }

  // ---------- H. cancel vs recovery race → cancelled cannot resume ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await markRunRecovering(runId, "SLA");
    // Cancel request lands before the recovery claim.
    await requestCancelGeneration(documentId);
    check("H: cancel → CANCEL_REQUESTED", (await getRun(runId))?.status === "CANCEL_REQUESTED");
    const claimed = await claimRunForResume(runId);
    check("H: cancelled run cannot be claimed", claimed === false);
    await cancelRun(runId);
    check("H: run is CANCELLED", (await getRun(runId))?.status === "CANCELLED");
    const claimed2 = await claimRunForResume(runId);
    check("H: CANCELLED run never resumable", claimed2 === false);
    // Opposite race: claim wins first → cancel request must still apply.
    const f2 = await seedFixture();
    const runId2 = randomUUID();
    await acquireGenerationLock(f2.documentId, runId2);
    await createGenerationRun({ id: runId2, documentId: f2.documentId, applicationId: f2.applicationId, studentId: f2.studentId });
    await markRunRecovering(runId2, "SLA");
    const claimedFirst = await claimRunForResume(runId2);
    check("H: claim wins when first", claimedFirst === true);
    const cancelAfter = await requestCancelGeneration(f2.documentId);
    check("H: cancel still applies after claim (RUNNING)", cancelAfter.result === "CANCEL_REQUESTED");
    const claimed3 = await claimRunForResume(runId2);
    check("H: post-cancel re-claim rejected", claimed3 === false);
  }

  // ---------- I. delete immediately after cancel request → still blocked ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await requestCancelGeneration(documentId);
    const res = await deleteDocumentCascade(documentId, applicationId);
    check("I: delete during CANCEL_REQUESTED blocked", res === "GENERATING");
    // After terminal CANCELLED + lock release, delete is allowed.
    await cancelRun(runId);
    await releaseDocumentGeneration(documentId, runId, "NOT_STARTED");
    const res2 = await deleteDocumentCascade(documentId, applicationId);
    check("I: delete after terminal CANCELLED allowed", res2 === "DELETED", `got ${res2}`);
  }

  // ---------- J. new run after terminal FAILED → allowed + authoritative ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await failRun(runA, "hard failure");
    await releaseDocumentGeneration(documentId, runA, "FAILED");
    const runB = randomUUID();
    const acquiredB = await acquireGenerationLock(documentId, runB);
    check("J: new generation allowed after FAILED", acquiredB === true);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    check("J: B is authoritative owner", (await docRow(documentId))?.active_generation_run_id === runB);
    check("J: B owns document", await isRunDocumentOwner(documentId, runB));
    check("J: terminal A not owner", !(await isRunDocumentOwner(documentId, runA)));
    // A (terminal) cannot re-complete.
    check("J: completeRun on terminal A rejected", (await completeRun(runA, [])) === false);
  }

  // ---------- Application/student cascade guards ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    await markRunRecovering(runId, "SLA");
    const appRes = await deleteApplicationCascade(applicationId);
    check("cascade: application delete blocked during RECOVERING", appRes === "GENERATING", `got ${appRes}`);
    const stuRes = await deleteStudentCascade(studentId);
    check("cascade: student delete blocked during RECOVERING", stuRes === "GENERATING", `got ${stuRes}`);
    // After terminal state, both cascade paths succeed.
    await failRun(runId, "done");
    await releaseDocumentGeneration(documentId, runId, "FAILED");
    const appRes2 = await deleteApplicationCascade(applicationId);
    check("cascade: application delete allowed after FAILED", appRes2 === "DELETED", `got ${appRes2}`);
  }

  // ---------- releaseOrphanedDocumentLock semantics ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();
    await acquireGenerationLock(documentId, runId);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    // Live active run → catch-all release must NOT fire.
    await releaseOrphanedDocumentLock(documentId);
    check("orphan-release: live run keeps lock", (await docRow(documentId))?.generation_status === "GENERATING");
    check("orphan-release: owner preserved", (await docRow(documentId))?.active_generation_run_id === runId);
    // Terminal run → release applies.
    await failRun(runId, "x");
    await releaseOrphanedDocumentLock(documentId);
    check("orphan-release: no active run → FAILED", (await docRow(documentId))?.generation_status === "FAILED");
    check("orphan-release: owner cleared", (await docRow(documentId))?.active_generation_run_id === null);
  }

  // ---------- Owner-guarded release: superseded run cannot clear doc ----------
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    const pool = getDbPool();
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    // A's release attempt must be a no-op (B owns the doc).
    const relA = await releaseDocumentGeneration(documentId, runA, "FAILED");
    check("release-guard: superseded A release is no-op", relA === false);
    const doc = await docRow(documentId);
    check("release-guard: doc still GENERATING under B", doc.generation_status === "GENERATING" && doc.active_generation_run_id === runB);
    // B's release works and clears ownership.
    const relB = await releaseDocumentGeneration(documentId, runB, "GENERATED");
    check("release-guard: owner B releases cleanly", relB === true);
    check("release-guard: owner column cleared", (await docRow(documentId))?.active_generation_run_id === null);
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
