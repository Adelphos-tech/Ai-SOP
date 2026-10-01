/**
 * generation-ownership-races.test.ts — Remediation Wave 1 (final race proof)
 *
 * DB-level integration tests for the two remaining GEN-004 races:
 *
 *   1. Older RECOVERING run wakes AFTER a newer run reached a TERMINAL
 *      state. Supersession is no longer "newer ACTIVE run only" — ANY
 *      newer run row (created_at >= this run's, different id) means a
 *      later explicit attempt exists and permanently supersedes it.
 *   2. DELETE vs GENERATION-START TOCTOU — both contend on the same
 *      application_documents row lock. Real concurrent transactions on
 *      separate pool connections prove exactly one wins and provider
 *      work can never be orphaned.
 *
 * Runs against isolated sop_ai_app_test via tests/test-setup.ts.
 * OpenAI calls: 0. Production writes: 0.
 */

import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createGenerationRun,
  getRun,
  completeRun,
  failRun,
  cancelRun,
  requestCancelGeneration,
  markRunRecovering,
  claimRunForResume,
  hasNewerGenerationRun,
  GenerationSupersededError,
} from "../src/lib/application/generation-lifecycle";
import {
  acquireGenerationLock,
  adoptRunOwnership,
  isRunDocumentOwner,
  releaseDocumentGeneration,
  deleteDocumentCascade,
  deleteApplicationCascade,
  deleteStudentCascade,
  createDocumentVersion,
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
     VALUES (?, 'Race', 'Test', ?, NOW(), NOW())`,
    [studentId, `race-${studentId}@test.local`],
  );
  await pool.execute(
    `INSERT INTO applications
       (id, student_id, university_name, program_name, degree, country, intake, intake_year, status, created_at, updated_at)
     VALUES (?, ?, 'Race University', 'Race Program', 'MS', 'USA', 'Fall', '2027', 'ACTIVE', NOW(), NOW())`,
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
    "SELECT generation_status, active_generation_run_id FROM application_documents WHERE id = ?",
    [documentId],
  );
  return (rows as any[])[0];
}

async function runCount(documentId: string): Promise<number> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS c FROM generation_runs WHERE document_id = ?", [documentId]);
  return Number((rows as any[])[0].c);
}

async function main() {
  await assertTestDatabase();
  console.log("=== Generation Ownership Race Tests (DB) ===\n");

  // ================================================================
  // 1. A RECOVERING + B newer COMPLETED → A can never resume
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    const pool = getDbPool();

    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA breach");

    // B starts later (stale-lock path) and COMPLETES.
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    check("1: B is newer run", await hasNewerGenerationRun(documentId, runA));
    const completedB = await completeRun(runB, []);
    check("1: B completed", completedB === true);
    await releaseDocumentGeneration(documentId, runB, "GENERATED");
    check("1: doc GENERATED, owner released",
      (await docRow(documentId))?.generation_status === "GENERATED");

    // A wakes — EVERY resume gate must reject it.
    const claimedA = await claimRunForResume(runA);
    check("1: A claim rejected — newer run exists (any status)", claimedA === false);
    const adoptedA = await adoptRunOwnership(documentId, runA);
    check("1: A adopt rejected", adoptedA === false);
    check("1: A not document owner", !(await isRunDocumentOwner(documentId, runA)));
    // A must not be able to complete or release either.
    check("1: completeRun(A) = 0 affected", (await completeRun(runA, [])) === false);
    check("1: release(A) is no-op",
      (await releaseDocumentGeneration(documentId, runA, "FAILED")) === false);
    check("1: doc still GENERATED — B's result untouched",
      (await docRow(documentId))?.generation_status === "GENERATED");
    // Terminal A stays terminal-after-marking; B's row untouched.
    await failRun(runA, "SUPERSEDED_BY_NEWER_RUN");
    check("1: A marked FAILED (superseded)", (await getRun(runA))?.status === "FAILED");
    check("1: B still COMPLETED", (await getRun(runB))?.status === "COMPLETED");
  }

  // ================================================================
  // 2. Newer run exists but owner released → old A cannot reclaim
  //    (B FAILED + lock released → GENERATED flag is NOT set;
  //     adopt's newer-run check must still reject A)
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    const pool = getDbPool();

    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    // B FAILS — user-facing failure; A's old attempt must NOT resurrect.
    await failRun(runB, "provider error");
    await releaseDocumentGeneration(documentId, runB, "FAILED");
    check("2: doc FAILED after B fails", (await docRow(documentId))?.generation_status === "FAILED");

    const claimedA = await claimRunForResume(runA);
    check("2: A claim rejected — newer FAILED run supersedes", claimedA === false);
    check("2: adopt also rejected", (await adoptRunOwnership(documentId, runA)) === false);
  }

  // ================================================================
  // 2b. Newer CANCELLED run also supersedes (explicit user retry that
  //     was cancelled — resurrecting the older attempt would be wrong)
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID();
    const runB = randomUUID();
    const pool = getDbPool();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId],
    );
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    await requestCancelGeneration(documentId);
    await cancelRun(runB);
    await releaseDocumentGeneration(documentId, runB, "NOT_STARTED");
    check("2b: B CANCELLED", (await getRun(runB))?.status === "CANCELLED");
    check("2b: A claim rejected — newer CANCELLED run supersedes",
      (await claimRunForResume(runA)) === false);
  }

  // ================================================================
  // 3. Concurrent document delete + generation start → exactly one wins
  //    Ordering 1: delete holds doc-row lock first → lock acquire blocks
  //    then fails (0 rows). Ordering 2: lock acquired first → delete
  //    sees GENERATING and rejects.
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runId = randomUUID();

    // Ordering 1 — delete tx holds the row lock; acquire must block,
    // then hit a deleted row.
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      "SELECT id FROM application_documents WHERE id = ? FOR UPDATE", [documentId]);

    const acquirePromise = acquireGenerationLock(documentId, runId); // blocks on row lock
    await sleep(400); // prove it is still blocked
    await conn.execute("DELETE FROM application_documents WHERE id = ?", [documentId]);
    await conn.commit();
    conn.release();
    const acquired = await acquirePromise;
    check("3a: acquire blocked then failed after delete commit", acquired === false);
    check("3a: document deleted", !(await docRow(documentId)));
    // No run row was ever created — generation stops before provider work.
    const r = await getRun(runId);
    check("3a: no run row / no provider work possible", r === null);
  }
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runId = randomUUID();

    // Ordering 2 — generation wins the row first.
    const acquired = await acquireGenerationLock(documentId, runId);
    check("3b: generation acquired lock first", acquired === true);
    await createGenerationRun({ id: runId, documentId, applicationId, studentId });
    const del = await deleteDocumentCascade(documentId, applicationId);
    check("3b: delete rejected while GENERATING", del === "GENERATING", `got ${del}`);
    check("3b: doc + run intact",
      !!(await docRow(documentId)) && (await getRun(runId))?.status === "RUNNING");
  }

  // ================================================================
  // 4. Concurrent APPLICATION delete + contained generation start
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runId = randomUUID();

    // Simulate cascade's doc-row lock being held while a generation
    // start races — the lock acquire must block, then fail.
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      "SELECT id, generation_status FROM application_documents WHERE application_id = ? FOR UPDATE",
      [applicationId]);
    const acquirePromise = acquireGenerationLock(documentId, runId);
    await sleep(400);
    await conn.execute("DELETE FROM application_documents WHERE application_id = ?", [applicationId]);
    await conn.execute("DELETE FROM applications WHERE id = ?", [applicationId]);
    await conn.commit();
    conn.release();
    const acquired = await acquirePromise;
    check("4a: contained acquire blocked + failed after app delete", acquired === false);

    // Ordering 2 — generation flag committed first → real cascade rejects.
    const f2 = await seedFixture();
    const runId2 = randomUUID();
    await acquireGenerationLock(f2.documentId, runId2);
    await createGenerationRun({
      id: runId2, documentId: f2.documentId,
      applicationId: f2.applicationId, studentId: f2.studentId,
    });
    const del = await deleteApplicationCascade(f2.applicationId);
    check("4b: app delete rejected — doc GENERATING flag seen under FOR UPDATE",
      del === "GENERATING", `got ${del}`);
    check("4b: run row intact", (await getRun(runId2))?.status === "RUNNING");

    // True concurrency — several iterations, invariant: NEVER
    // (application deleted AND generation acquired lock).
    for (let i = 0; i < 4; i++) {
      const f = await seedFixture();
      const rid = randomUUID();
      const [delRes, acq] = await Promise.all([
        deleteApplicationCascade(f.applicationId),
        acquireGenerationLock(f.documentId, rid),
      ]);
      check(`4c.${i}: no delete+acquire overlap (del=${delRes}, acq=${acq})`,
        !(delRes === "DELETED" && acq === true));
    }
  }

  // ================================================================
  // 5. Concurrent STUDENT delete + contained generation start
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runId = randomUUID();

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      `SELECT d.id, d.generation_status FROM application_documents d
       JOIN applications a ON d.application_id = a.id
       WHERE a.student_id = ? FOR UPDATE`,
      [studentId]);
    const acquirePromise = acquireGenerationLock(documentId, runId);
    await sleep(400);
    await conn.execute(
      `DELETE d FROM application_documents d
       JOIN applications a ON d.application_id = a.id WHERE a.student_id = ?`,
      [studentId]);
    await conn.execute("DELETE FROM applications WHERE student_id = ?", [studentId]);
    await conn.execute("DELETE FROM students WHERE id = ?", [studentId]);
    await conn.commit();
    conn.release();
    check("5a: contained acquire blocked + failed after student delete",
      (await acquirePromise) === false);

    const f2 = await seedFixture();
    const runId2 = randomUUID();
    await acquireGenerationLock(f2.documentId, runId2);
    await createGenerationRun({
      id: runId2, documentId: f2.documentId,
      applicationId: f2.applicationId, studentId: f2.studentId,
    });
    const del = await deleteStudentCascade(f2.studentId);
    check("5b: student delete rejected — contained GENERATING flag",
      del === "GENERATING", `got ${del}`);

    for (let i = 0; i < 4; i++) {
      const f = await seedFixture();
      const rid = randomUUID();
      const [delRes, acq] = await Promise.all([
        deleteStudentCascade(f.studentId),
        acquireGenerationLock(f.documentId, rid),
      ]);
      check(`5c.${i}: no delete+acquire overlap (del=${delRes}, acq=${acq})`,
        !(delRes === "DELETED" && acq === true));
    }
  }

  // ================================================================
  // 6. completeRun from stale owner → zero affected (both guards)
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId]);
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    // Owner explicitly B.
    check("6a: completeRun(A) while B owns → 0 affected", (await completeRun(runA, [])) === false);
    // Owner released NULL but newer run exists → still 0.
    await releaseDocumentGeneration(documentId, runB, "FAILED");
    await failRun(runB, "x");
    check("6b: completeRun(A) w/ NULL owner + newer run → 0 affected",
      (await completeRun(runA, [])) === false);
    check("6b: A still not FAILED (CAS no-op)", (await getRun(runA))?.status === "RECOVERING");
  }

  // ================================================================
  // 7. Version creation from stale owner → impossible
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId]);
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });

    // 7a: doc owned by B → A's guarded version insert throws.
    let threw = false;
    try {
      await createDocumentVersion({
        documentId, content: "STALE", createdByType: "AI_GENERATED",
        expectedGenerationRunId: runA,
      });
    } catch (e) { threw = e instanceof GenerationSupersededError; }
    check("7a: stale owner version insert throws superseded", threw);
    check("7a: no version row created", await versionCount(documentId) === 0);

    // 7b: NULL owner + newer run exists → still rejected.
    await releaseDocumentGeneration(documentId, runB, "GENERATED");
    await completeRun(runB, []);
    threw = false;
    try {
      await createDocumentVersion({
        documentId, content: "STALE2", createdByType: "AI_GENERATED",
        expectedGenerationRunId: runA,
      });
    } catch (e) { threw = e instanceof GenerationSupersededError; }
    check("7b: NULL owner + newer run → version still rejected", threw);

    // 7c: legit owner creates version fine.
    const v = await createDocumentVersion({
      documentId, content: "LEGIT", createdByType: "AI_GENERATED",
      expectedGenerationRunId: runB,
    });
    check("7c: authoritative owner creates version", !!v.id);

    // 7d: unguarded path (consultant save) unaffected.
    const v2 = await createDocumentVersion({
      documentId, content: "EDIT", createdByType: "CONSULTANT_EDITED",
    });
    check("7d: unguarded version path unaffected", !!v2.id && v2.versionNumber === v.versionNumber + 1);
  }

  // ================================================================
  // 8. Duplicate recovery after newer terminal run → impossible
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runA = randomUUID();
    const runB = randomUUID();
    await acquireGenerationLock(documentId, runA);
    await createGenerationRun({ id: runA, documentId, applicationId, studentId });
    await markRunRecovering(runA, "SLA");
    await pool.execute(
      "UPDATE application_documents SET generation_started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?",
      [documentId]);
    await acquireGenerationLock(documentId, runB);
    await createGenerationRun({ id: runB, documentId, applicationId, studentId });
    await completeRun(runB, []);
    await releaseDocumentGeneration(documentId, runB, "GENERATED");

    // Two recovery workers hit the superseded A concurrently.
    const [w1, w2] = await Promise.all([
      claimRunForResume(runA),
      claimRunForResume(runA),
    ]);
    check("8: both recovery claims rejected — newer terminal run exists",
      w1 === false && w2 === false, `w1=${w1} w2=${w2}`);
    check("8: A still RECOVERING (not flipped RUNNING)",
      (await getRun(runA))?.status === "RECOVERING");
    check("8: run count still 2 — no phantom run", (await runCount(documentId)) === 2);
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  await closeDbPool();
  process.exit(failed === 0 ? 0 : 1);
}

async function versionCount(documentId: string): Promise<number> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", [documentId]);
  return Number((rows as any[])[0].c);
}

main().catch(async e => {
  console.error("Test crashed:", e);
  await closeDbPool();
  process.exit(1);
});
