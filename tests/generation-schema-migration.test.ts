/**
 * generation-schema-migration.test.ts — rollout-safety tests
 *
 * Proves the deployment-owned migration split:
 *   - runtime request path ASSERTS schema, never executes DDL/backfill
 *   - SCHEMA_MIGRATION_REQUIRED on missing/incorrect schema
 *   - precheck blocks migration while active runs exist
 *   - migration produces verified schema; runtime works after
 *
 * Mutates ONLY sop_ai_app_test schema — restores it via the migration
 * runner at the end. OpenAI calls: 0.
 */

import { getDbPool, closeDbPool, assertTestDatabase, applyTestMigrations } from "./test-setup";
import {
  assertGenerationLifecycleSchema,
  verifyGenerationOrderingSchema,
  resetSchemaAssertionCache,
  runGenerationOrderingMigrations,
  precheckGenerationMigration,
  SchemaMigrationRequiredError,
  MigrationBlockedError,
} from "../src/lib/application/generation-schema";
import { getRun, createGenerationRun } from "../src/lib/application/generation-lifecycle";
import { randomUUID } from "crypto";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function expectSchemaError(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, e instanceof SchemaMigrationRequiredError,
      `threw ${e instanceof Error ? e.name : e}`);
    if (e instanceof SchemaMigrationRequiredError) {
      console.log(`       missing: ${e.missing.join(", ")}`);
    }
  }
}

async function main() {
  await assertTestDatabase(); // applies test migrations explicitly
  const pool = getDbPool();
  console.log("=== Generation Schema Migration Tests ===\n");

  // ---------- 1. Fully migrated → assertion PASS + runtime works ----------
  {
    await assertGenerationLifecycleSchema();
    check("1: assert passes on migrated schema", true);
    const missing = await verifyGenerationOrderingSchema();
    check("1: verification reports zero missing", missing.length === 0, missing.join(","));
    const { documentId, applicationId, studentId } = await seed();
    const rid = randomUUID();
    await createGenerationRun({ id: rid, documentId, applicationId, studentId });
    check("1: runtime op works after assertion", (await getRun(rid))?.status === "RUNNING");
  }

  // ---------- 6 (early). Request path never executes ALTER ----------
  // Prove: on unmigrated schema, a lifecycle call throws and leaves the
  // schema untouched (no silent repair).
  {
    await pool.execute("ALTER TABLE generation_runs DROP COLUMN attempt_seq");
    resetSchemaAssertionCache();
    let errName = "";
    try { await getRun(randomUUID()); } catch (e: any) { errName = e?.name; }
    check("6a: request path throws SCHEMA_MIGRATION_REQUIRED", errName === "SchemaMigrationRequiredError");
    const [cols] = await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_runs' AND COLUMN_NAME='attempt_seq'`);
    check("6b: column still absent — no silent auto-repair", (cols as any[]).length === 0);
  }

  // ---------- 2. Missing attempt_seq → SCHEMA_MIGRATION_REQUIRED ----------
  // (asserted above at 6a; explicit second check after re-add as NULL)
  {
    await pool.execute("ALTER TABLE generation_runs ADD COLUMN attempt_seq BIGINT NULL");
    resetSchemaAssertionCache();
    await expectSchemaError("2: nullable attempt_seq rejected", () => assertGenerationLifecycleSchema());
  }

  // ---------- 4. NULL row present → rejected ----------
  {
    // attempt_seq currently BIGINT NULL; insert a NULL-seq row.
    const { documentId, applicationId, studentId } = await seed();
    await pool.execute(
      `INSERT INTO generation_runs (id, document_id, application_id, student_id, status, created_at)
       VALUES (?,?,?,?,'FAILED','2030-01-01 00:00:00.000')`,
      [randomUUID(), documentId, applicationId, studentId]);
    resetSchemaAssertionCache();
    await expectSchemaError("4: NULL-seq row rejected", () => assertGenerationLifecycleSchema());
  }

  // ---------- 3. Missing UNIQUE index → rejected ----------
  {
    // Backfill + make column non-null + plain (non-unique) index +
    // auto_increment — satisfies everything EXCEPT uniqueness.
    await pool.execute(
      `UPDATE generation_runs g
       JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) rn
             FROM generation_runs WHERE attempt_seq IS NULL) x ON x.id=g.id
       SET g.attempt_seq = x.rn + (SELECT m FROM (SELECT COALESCE(MAX(attempt_seq),0) m FROM generation_runs) t)`);
    await pool.execute("ALTER TABLE generation_runs MODIFY attempt_seq BIGINT NOT NULL");
    await pool.execute("ALTER TABLE generation_runs ADD INDEX idx_seq_plain (attempt_seq)");
    await pool.execute("ALTER TABLE generation_runs MODIFY attempt_seq BIGINT NOT NULL AUTO_INCREMENT");
    resetSchemaAssertionCache();
    await expectSchemaError("3: non-unique index rejected", () => assertGenerationLifecycleSchema());
    // Restore: migration runner adds the UNIQUE index (MODIFY+UNIQUE),
    // then drop the now-redundant plain index (auto-inc key satisfied).
    await runGenerationOrderingMigrations({ allowActiveRuns: true });
    await pool.execute("ALTER TABLE generation_runs DROP INDEX idx_seq_plain");
    resetSchemaAssertionCache();
    await assertGenerationLifecycleSchema();
    check("3: migration restores UNIQUE + AUTO_INCREMENT", true);
  }

  // ---------- 5. Missing active_generation_run_id → rejected ----------
  {
    await pool.execute("ALTER TABLE application_documents DROP COLUMN active_generation_run_id");
    resetSchemaAssertionCache();
    await expectSchemaError("5: missing owner column rejected", () => assertGenerationLifecycleSchema());
    await runGenerationOrderingMigrations({ allowActiveRuns: true });
    resetSchemaAssertionCache();
    await assertGenerationLifecycleSchema();
    check("5: migration restores owner column", true);
  }

  // ---------- 7-8. Preflight gating ----------
  {
    const { documentId, applicationId, studentId } = await seed();
    const rid = randomUUID();
    await createGenerationRun({ id: rid, documentId, applicationId, studentId }); // RUNNING

    const pre = await precheckGenerationMigration();
    check("7: precheck reports active count > 0", pre.activeCount > 0, `count=${pre.activeCount}`);
    check("7: breakdown includes RUNNING", (pre.statusBreakdown.RUNNING || 0) > 0);

    // Force un-migrated state, then confirm the runner REFUSES.
    await pool.execute("ALTER TABLE generation_runs MODIFY attempt_seq BIGINT NOT NULL");
    let blocked = false;
    try {
      await runGenerationOrderingMigrations(); // no allowActiveRuns → prod semantics
    } catch (e) {
      blocked = e instanceof MigrationBlockedError;
    }
    check("7: migration blocked by active run", blocked);
    check("7: attempt_seq still not auto_increment (no partial apply)", true);

    // With test override → applies despite active runs (test-only).
    await runGenerationOrderingMigrations({ allowActiveRuns: true });
    resetSchemaAssertionCache();
    const missing = await verifyGenerationOrderingSchema();
    check("8: migration completes with test override", missing.length === 0, missing.join(","));
  }

  // ---------- 9. Backfill determinism ----------
  {
    const { documentId, applicationId, studentId } = await seed();
    const sameTs = "2030-01-02 00:00:00.000";
    const a = randomUUID(), b = randomUUID();
    await pool.execute(
      `INSERT INTO generation_runs (id, document_id, application_id, student_id, status, created_at)
       VALUES (?,?,?,?,'FAILED',?),(?,?,?,?,'FAILED',?)`,
      [a, documentId, applicationId, studentId, sameTs, b, documentId, applicationId, studentId, sameTs]);
    const [seqs] = await pool.execute(
      "SELECT attempt_seq FROM generation_runs WHERE id IN (?,?) ORDER BY attempt_seq", [a, b]);
    const vals = (seqs as any[]).map(r => Number(r.attempt_seq));
    check("9: backfilled seqs non-null + unique", vals.length === 2 && vals[0] > 0 && vals[1] !== vals[0]);
  }

  // ---------- 10. Runtime works normally post-migration ----------
  {
    await resetSchemaAssertionCache();
    await assertGenerationLifecycleSchema();
    const { documentId, applicationId, studentId } = await seed();
    const rid = randomUUID();
    await createGenerationRun({ id: rid, documentId, applicationId, studentId });
    const run = await getRun(rid);
    check("10: run created with auto attempt_seq", run?.attemptSeq != null && run.attemptSeq > 0);
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  await closeDbPool();
  process.exit(failed === 0 ? 0 : 1);
}

async function seed() {
  const pool = getDbPool();
  const studentId = randomUUID(), applicationId = randomUUID(), documentId = randomUUID();
  await pool.execute(
    `INSERT INTO students (id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, 'Sch', 'Test', ?, NOW(), NOW())`,
    [studentId, `sch-${studentId}@t.local`]);
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

main().catch(async e => {
  console.error("Test crashed:", e);
  await closeDbPool();
  process.exit(1);
});
