/**
 * generation-run-ordering.test.ts — strict total order proof (GEN-004)
 *
 * attempt_seq (BIGINT AUTO_INCREMENT UNIQUE on generation_runs) is the
 * ONLY authority ordering field. These tests prove:
 *   - identical created_at → still distinct, strictly ordered seqs
 *   - supersession resolves unambiguously (exactly one is newer)
 *   - terminal newer runs (COMPLETED/FAILED/CANCELLED) supersede even
 *     when timestamps are identical
 *   - transitivity across three runs
 *   - concurrent inserts → unique ordering
 *   - stale run cannot complete or create a version
 *
 * Runs against isolated sop_ai_app_test. OpenAI calls: 0.
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
  claimRunForResume,
  hasNewerGenerationRun,
  GenerationSupersededError,
} from "../src/lib/application/generation-lifecycle";
import {
  adoptRunOwnership,
  isRunDocumentOwner,
  releaseDocumentGeneration,
  createDocumentVersion,
} from "../src/lib/application/application-repository";
import { randomUUID } from "crypto";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function seedFixture(): Promise<{ studentId: string; applicationId: string; documentId: string }> {
  const pool = getDbPool();
  const studentId = randomUUID(), applicationId = randomUUID(), documentId = randomUUID();
  await pool.execute(
    `INSERT INTO students (id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, 'Ord', 'Test', ?, NOW(), NOW())`,
    [studentId, `ord-${studentId}@t.local`]);
  await pool.execute(
    `INSERT INTO applications (id, student_id, university_name, program_name, degree, country, intake, intake_year, status, created_at, updated_at)
     VALUES (?, ?, 'U', 'P', 'MS', 'USA', 'Fall', '2027', 'ACTIVE', NOW(), NOW())`,
    [applicationId, studentId]);
  await pool.execute(
    `INSERT INTO application_documents
       (id, application_id, document_type, document_title, prompt_text, prompt_source,
        requirements_status, generation_status, review_status, created_at, updated_at)
     VALUES (?, ?, 'SOP', 'SOP', 'p', 'CUSTOM', 'NOT_STARTED', 'NOT_STARTED', 'DRAFT', NOW(), NOW())`,
    [documentId, applicationId]);
  return { studentId, applicationId, documentId };
}

/** Insert a run row with a FORCED created_at (bypasses NOW(3) default)
 *  so identical-timestamp ordering can be tested. attempt_seq is still
 *  DB-assigned. */
async function insertRunAt(
  runId: string, documentId: string, applicationId: string, studentId: string,
  createdAt: string, status = "RUNNING",
) {
  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO generation_runs
       (id, document_id, application_id, student_id, status, generation_started_at, last_heartbeat_at, created_at)
     VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3), ?)`,
    [runId, documentId, applicationId, studentId, status, createdAt]);
}

async function seqOf(runId: string): Promise<number> {
  return Number((await getRun(runId))?.attemptSeq);
}

async function main() {
  await assertTestDatabase();
  console.log("=== Generation Run Ordering Tests (DB) ===\n");

  // ================================================================
  // 1-2. Identical created_at → distinct attempt_seq, exactly one newer
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID(), runB = randomUUID();
    const sameTs = "2030-06-01 12:00:00.000";
    await insertRunAt(runA, documentId, applicationId, studentId, sameTs, "RECOVERING");
    await insertRunAt(runB, documentId, applicationId, studentId, sameTs, "RECOVERING");

    const seqA = await seqOf(runA);
    const seqB = await seqOf(runB);
    check("1: distinct attempt_seq despite identical created_at", seqA !== seqB, `A=${seqA} B=${seqB}`);
    check("1: both seqs non-null", seqA > 0 && seqB > 0);

    const newerThanA = await hasNewerGenerationRun(documentId, runA);
    const newerThanB = await hasNewerGenerationRun(documentId, runB);
    check("2: exactly one direction is newer (antisymmetric, total)",
      newerThanA !== newerThanB, `newer>A=${newerThanA} newer>B=${newerThanB}`);
    // The higher-seq run is the newer one — deterministic, not random.
    check("2: higher attempt_seq is the newer run",
      seqB > seqA ? (newerThanA && !newerThanB) : (newerThanB && !newerThanA));
  }

  // ================================================================
  // 3. Latest run deterministically owns document (NULL-owner fallback)
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID(), runB = randomUUID();
    const sameTs = "2030-06-01 12:00:00.000";
    await insertRunAt(runA, documentId, applicationId, studentId, sameTs);
    await insertRunAt(runB, documentId, applicationId, studentId, sameTs);
    // owner column NULL — fallback picks latest by attempt_seq.
    const seqA = await seqOf(runA);
    const seqB = await seqOf(runB);
    const latestId = seqB > seqA ? runB : runA;
    check("3: getLatestRun returns max attempt_seq (not random)",
      (await getLatestRun(documentId))?.id === latestId);
    check("3: isRunDocumentOwner crowns the higher-seq run",
      await isRunDocumentOwner(documentId, latestId));
    check("3: older-seq run is NOT owner",
      !(await isRunDocumentOwner(documentId, latestId === runA ? runB : runA)));
  }

  // ================================================================
  // 4. RECOVERING A + newer COMPLETED B (same created_at) → A dead
  // ================================================================
  for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runA = randomUUID(), runB = randomUUID();
    const sameTs = "2030-06-01 12:00:00.000";
    await insertRunAt(runA, documentId, applicationId, studentId, sameTs, "RECOVERING");
    await insertRunAt(runB, documentId, applicationId, studentId, sameTs);
    // Guarantee B is the newer run by attempt_seq (insert order does so,
    // but assert it rather than assume).
    check(`4-${terminal}: B has higher seq`, (await seqOf(runB)) > (await seqOf(runA)));

    // Simulate B having owned and reached a terminal state.
    await pool.execute(
      "UPDATE application_documents SET generation_status='GENERATING', active_generation_run_id=? WHERE id=?",
      [runB, documentId]);
    if (terminal === "COMPLETED") {
      await completeRun(runB, []);
      await releaseDocumentGeneration(documentId, runB, "GENERATED");
    } else if (terminal === "FAILED") {
      await failRun(runB, "x");
      await releaseDocumentGeneration(documentId, runB, "FAILED");
    } else {
      await requestCancelGeneration(documentId);
      await cancelRun(runB);
      await releaseDocumentGeneration(documentId, runB, "NOT_STARTED");
    }
    check(`4-${terminal}: B reached ${terminal}`, (await getRun(runB))?.status === terminal);

    check(`4-${terminal}: A claim rejected`, (await claimRunForResume(runA)) === false);
    check(`4-${terminal}: A adopt rejected`, (await adoptRunOwnership(documentId, runA)) === false);
    check(`4-${terminal}: A not owner`, !(await isRunDocumentOwner(documentId, runA)));
    check(`4-${terminal}: completeRun(A) rejected`, (await completeRun(runA, [])) === false);
  }

  // ================================================================
  // 5. Three-run transitivity A < B < C
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const runA = randomUUID(), runB = randomUUID(), runC = randomUUID();
    const sameTs = "2030-06-01 12:00:00.000";
    await insertRunAt(runA, documentId, applicationId, studentId, sameTs);
    await insertRunAt(runB, documentId, applicationId, studentId, sameTs);
    await insertRunAt(runC, documentId, applicationId, studentId, sameTs);
    const [sA, sB, sC] = [await seqOf(runA), await seqOf(runB), await seqOf(runC)];
    check("5: strictly increasing seqs", sA < sB && sB < sC, `A=${sA} B=${sB} C=${sC}`);
    check("5: newer run exists for A (B and C)", await hasNewerGenerationRun(documentId, runA));
    check("5: newer run exists for B (C)", await hasNewerGenerationRun(documentId, runB));
    check("5: transitivity — A < B < C by seq", sA < sB && sB < sC);
    check("5: C has no newer run", (await hasNewerGenerationRun(documentId, runC)) === false);
    check("5: B is not latest", (await getLatestRun(documentId))?.id === runC);
  }

  // ================================================================
  // 6. Concurrent run creation → unique ordering
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const ids = Array.from({ length: 6 }, () => randomUUID());
    await Promise.all(ids.map(id =>
      createGenerationRun({ id, documentId, applicationId, studentId })));
    const seqs = await Promise.all(ids.map(seqOf));
    check("6: all seqs non-null", seqs.every(s => s > 0));
    check("6: all seqs unique", new Set(seqs).size === ids.length, seqs.join(","));
    // getLatestRun returns the highest seq deterministically.
    const maxId = ids[seqs.indexOf(Math.max(...seqs))];
    check("6: latest = max seq", (await getLatestRun(documentId))?.id === maxId);
  }

  // ================================================================
  // 7-8. Stale run cannot create version or complete
  // ================================================================
  {
    const { studentId, applicationId, documentId } = await seedFixture();
    const pool = getDbPool();
    const runA = randomUUID(), runB = randomUUID();
    const sameTs = "2030-06-01 12:00:00.000";
    await insertRunAt(runA, documentId, applicationId, studentId, sameTs, "RECOVERING");
    await insertRunAt(runB, documentId, applicationId, studentId, sameTs);
    await pool.execute(
      "UPDATE application_documents SET generation_status='GENERATING', active_generation_run_id=? WHERE id=?",
      [runB, documentId]);

    let threw = false;
    try {
      await createDocumentVersion({
        documentId, content: "STALE", createdByType: "AI_GENERATED",
        expectedGenerationRunId: runA,
      });
    } catch (e) { threw = e instanceof GenerationSupersededError; }
    check("7: stale run version insert rejected", threw);

    check("8: stale run completeRun rejected", (await completeRun(runA, [])) === false);
    check("8: stale run still RECOVERING", (await getRun(runA))?.status === "RECOVERING");
  }

  // ================================================================
  // 9. Immutability + non-null uniqueness invariant (invariant check)
  // ================================================================
  {
    const pool = getDbPool();
    const [dup] = await pool.execute(
      "SELECT attempt_seq, COUNT(*) c FROM generation_runs GROUP BY attempt_seq HAVING c > 1");
    check("9: no duplicate attempt_seq across table", (dup as any[]).length === 0);
    const [nul] = await pool.execute(
      "SELECT COUNT(*) c FROM generation_runs WHERE attempt_seq IS NULL");
    check("9: no NULL attempt_seq", Number((nul as any[])[0].c) === 0);
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
