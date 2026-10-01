// ============================================================
// GENERATION SCHEMA — deployment-owned migration + runtime assertion
// ============================================================
// Split of schema responsibilities (rollout remediation):
//
//   A. MIGRATION (deployment-owned, explicit):
//      runGenerationOrderingMigrations() — applies columns, historical
//      attempt_seq backfill, UNIQUE index, AUTO_INCREMENT conversion.
//      Invoked ONLY by scripts/migrate-generation-ordering.ts (operator
//      command) or tests/test-setup.ts (test bootstrap). NEVER by a
//      normal request path.
//
//   B. RUNTIME ASSERTION (request-path):
//      assertGenerationLifecycleSchema() — read-only information_schema
//      inspection; throws SchemaMigrationRequiredError if any required
//      schema element is missing/incorrect. NEVER mutates schema.
//
// The circular import with generation-lifecycle is intentional and
// safe: both sides reference each other only inside function bodies
// (resolved at call time), never at module-eval time.
// ============================================================

import { getDbPool } from "./db";

/** Thrown when request-path code finds required schema absent/incomplete.
 *  Route/service handlers translate this to a friendly 503 — never raw SQL. */
export class SchemaMigrationRequiredError extends Error {
  readonly code = "SCHEMA_MIGRATION_REQUIRED";
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`SCHEMA_MIGRATION_REQUIRED: ${missing.join(", ")}`);
    this.name = "SchemaMigrationRequiredError";
    this.missing = missing;
  }
}

export function isSchemaMigrationRequiredError(e: unknown): e is SchemaMigrationRequiredError {
  return e instanceof SchemaMigrationRequiredError;
}

// ---------- DDL constants (shared by migration runner + fresh bootstrap) ----------

export const GENERATION_RUNS_DDL = `CREATE TABLE IF NOT EXISTS generation_runs (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  application_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  current_stage VARCHAR(40) DEFAULT NULL,
  current_stage_started_at DATETIME(3) DEFAULT NULL,
  completed_stages INT NOT NULL DEFAULT 0,
  total_stages INT NOT NULL DEFAULT 6,
  generation_started_at DATETIME(3) DEFAULT NULL,
  last_heartbeat_at DATETIME(3) DEFAULT NULL,
  cancel_requested_at DATETIME(3) DEFAULT NULL,
  cancelled_at DATETIME(3) DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  failed_at DATETIME(3) DEFAULT NULL,
  failure_message TEXT DEFAULT NULL,
  provider_response_id VARCHAR(128) DEFAULT NULL,
  provider_response_status VARCHAR(32) DEFAULT NULL,
  provider_stage VARCHAR(40) DEFAULT NULL,
  provider_started_at DATETIME(3) DEFAULT NULL,
  provider_last_checked_at DATETIME(3) DEFAULT NULL,
  provider_model VARCHAR(64) DEFAULT NULL,
  provider_input_tokens INT DEFAULT NULL,
  provider_output_tokens INT DEFAULT NULL,
  provider_reasoning_tokens INT DEFAULT NULL,
  provider_cached_input_tokens INT DEFAULT NULL,
  provider_usage_status VARCHAR(24) DEFAULT NULL,
  provider_error_code VARCHAR(64) DEFAULT NULL,
  provider_incomplete_reason VARCHAR(64) DEFAULT NULL,
  provider_error_message TEXT DEFAULT NULL,
  stage_fingerprint VARCHAR(64) DEFAULT NULL,
  attempt_seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  recovery_count INT NOT NULL DEFAULT 0,
  warnings_json TEXT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  INDEX idx_runs_document (document_id, created_at),
  INDEX idx_runs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export const GENERATION_STAGE_RESPONSES_DDL = `CREATE TABLE IF NOT EXISTS generation_stage_responses (
  id VARCHAR(36) PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL,
  document_id VARCHAR(36) NOT NULL,
  stage VARCHAR(40) NOT NULL,
  stage_fingerprint VARCHAR(64) NOT NULL,
  provider_response_id VARCHAR(128) NOT NULL,
  provider_response_status VARCHAR(32) NOT NULL,
  provider_model VARCHAR(64) DEFAULT NULL,
  input_tokens INT DEFAULT NULL,
  cached_input_tokens INT DEFAULT NULL,
  output_tokens INT DEFAULT NULL,
  reasoning_tokens INT DEFAULT NULL,
  usage_status VARCHAR(24) DEFAULT NULL,
  provider_error_code VARCHAR(64) DEFAULT NULL,
  provider_incomplete_reason VARCHAR(64) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  completed_at DATETIME(3) DEFAULT NULL,
  INDEX idx_gsr_fingerprint (stage, stage_fingerprint, provider_response_status),
  INDEX idx_gsr_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// ---------- runtime assertion (read-only) ----------

interface ColumnMeta { exists: boolean; nullable: boolean; autoIncrement: boolean }
interface IndexMeta { exists: boolean }

async function columnMeta(table: string, column: string): Promise<ColumnMeta> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT IS_NULLABLE, EXTRA FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  const row = (rows as any[])[0];
  return {
    exists: !!row,
    nullable: row ? row.IS_NULLABLE === "YES" : false,
    autoIncrement: row ? String(row.EXTRA).includes("auto_increment") : false,
  };
}

async function uniqueIndexOnColumn(table: string, column: string): Promise<boolean> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND COLUMN_NAME = ? AND NON_UNIQUE = 0
      LIMIT 1`,
    [table, column],
  );
  return (rows as any[]).length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return (rows as any[]).length > 0;
}

/** Read-only verification of required generation schema. Returns a list
 *  of missing/incorrect elements (empty = fully migrated). */
export async function verifyGenerationOrderingSchema(): Promise<string[]> {
  const missing: string[] = [];

  if (!(await tableExists("generation_runs"))) {
    missing.push("table generation_runs");
  } else {
    const seq = await columnMeta("generation_runs", "attempt_seq");
    if (!seq.exists) missing.push("column generation_runs.attempt_seq");
    else {
      if (seq.nullable) missing.push("attempt_seq must be NOT NULL");
      if (!seq.autoIncrement) missing.push("attempt_seq must be AUTO_INCREMENT");
      if (!(await uniqueIndexOnColumn("generation_runs", "attempt_seq")))
        missing.push("UNIQUE index on attempt_seq");
      // NULL-row check — a backfill gap means the anti-join supersession
      // checks silently fail open.
      const pool = getDbPool();
      const [nul] = await pool.execute(
        "SELECT 1 FROM generation_runs WHERE attempt_seq IS NULL LIMIT 1",
      );
      if ((nul as any[]).length > 0) missing.push("rows with NULL attempt_seq");
    }
    for (const col of ["recovery_count", "warnings_json", "provider_error_message"]) {
      if (!(await columnMeta("generation_runs", col)).exists)
        missing.push(`column generation_runs.${col}`);
    }
  }

  if (!(await tableExists("application_documents"))) {
    missing.push("table application_documents");
  } else if (!(await columnMeta("application_documents", "active_generation_run_id")).exists) {
    missing.push("column application_documents.active_generation_run_id");
  }

  if (!(await tableExists("generation_stage_responses"))) {
    missing.push("table generation_stage_responses");
  }

  return missing;
}

let assertPromise: Promise<void> | null = null;

/** Request-path schema assertion. Memoized per process. READ-ONLY:
 *  inspects information_schema and never executes DDL/DML. Throws
 *  SchemaMigrationRequiredError when the required schema is absent. */
export function assertGenerationLifecycleSchema(): Promise<void> {
  if (!assertPromise) {
    assertPromise = (async () => {
      const missing = await verifyGenerationOrderingSchema();
      if (missing.length > 0) throw new SchemaMigrationRequiredError(missing);
    })();
    // A failed assertion is not cached — next request retries the check
    // (deployment may be racing the migration).
    assertPromise.catch(() => { assertPromise = null; });
  }
  return assertPromise;
}

/** Test/CLI hook — clears the memoized assertion so schema-state tests
 *  can re-verify after mutating the test schema. Test-only. */
export function resetSchemaAssertionCache(): void {
  assertPromise = null;
}

// ---------- migration (deployment-owned) ----------

export interface MigrationPrecheck {
  activeCount: number;
  statusBreakdown: Record<string, number>;
  oldestHeartbeat: string | null;
  newestHeartbeat: string | null;
}

/** READ-ONLY precheck: reports active-run state. Operator runs this
 *  before the ordering migration (scripts/generation-migration-precheck). */
export async function precheckGenerationMigration(): Promise<MigrationPrecheck> {
  const pool = getDbPool();
  if (!(await tableExists("generation_runs"))) {
    return { activeCount: 0, statusBreakdown: {}, oldestHeartbeat: null, newestHeartbeat: null };
  }
  // 'QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED' — canonical active
  // statuses (generation-lifecycle.ACTIVE_GENERATION_STATUSES). Inlined
  // here because the migration tool must not depend on application code
  // evaluation order.
  const [active] = await pool.execute(
    `SELECT COUNT(*) AS c FROM generation_runs
      WHERE status IN ('QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED')`,
  );
  const [byStatus] = await pool.execute(
    `SELECT status, COUNT(*) AS c FROM generation_runs GROUP BY status`,
  );
  const [hb] = await pool.execute(
    `SELECT MIN(last_heartbeat_at) AS oldest, MAX(last_heartbeat_at) AS newest
       FROM generation_runs
      WHERE status IN ('QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED')`,
  );
  const breakdown: Record<string, number> = {};
  for (const r of byStatus as any[]) breakdown[r.status] = Number(r.c);
  return {
    activeCount: Number((active as any[])[0].c),
    statusBreakdown: breakdown,
    oldestHeartbeat: (hb as any[])[0]?.oldest ?? null,
    newestHeartbeat: (hb as any[])[0]?.newest ?? null,
  };
}

export class MigrationBlockedError extends Error {
  readonly code = "GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS";
  readonly activeCount: number;
  constructor(count: number) {
    super(`GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS count=${count}`);
    this.name = "MigrationBlockedError";
    this.activeCount = count;
  }
}

async function addColumnIfMissing(ddl: string): Promise<void> {
  const pool = getDbPool();
  try { await pool.execute(ddl); } catch (e: any) {
    if (e?.code !== "ER_DUP_FIELDNAME") throw e;
  }
}

/**
 * Deployment-owned migration for generation ordering.
 * Order: legacy additive columns → active_generation_run_id →
 * attempt_seq (add → deterministic backfill → AUTO_INCREMENT UNIQUE).
 *
 * Safety: REFUSES to run while active runs exist (a NULL-seq row created
 * mid-window would defeat the supersession anti-joins). Test bootstrap
 * may pass allowActiveRuns — production NEVER does.
 */
export async function runGenerationOrderingMigrations(opts?: {
  allowActiveRuns?: boolean;
}): Promise<{ missing: string[] }> {
  const pool = getDbPool();

  // Safety gate FIRST — never apply any DDL while active runs exist
  // (allowActiveRuns is a test-bootstrap-only override; fresh databases
  // have no table to check).
  if (!opts?.allowActiveRuns && (await tableExists("generation_runs"))) {
    const pre0 = await precheckGenerationMigration();
    if (pre0.activeCount > 0) throw new MigrationBlockedError(pre0.activeCount);
  }

  // Bootstrap tables for fresh environments (idempotent CREATE).
  await pool.execute(GENERATION_RUNS_DDL);
  await pool.execute(GENERATION_STAGE_RESPONSES_DDL);

  // Legacy additive columns (moved out of runtime ensure — item 11).
  for (const ddl of [
    `ALTER TABLE generation_runs ADD COLUMN recovery_count INT NOT NULL DEFAULT 0`,
    `ALTER TABLE generation_runs ADD COLUMN warnings_json TEXT DEFAULT NULL`,
    `ALTER TABLE generation_runs ADD COLUMN provider_error_message TEXT DEFAULT NULL`,
  ]) {
    await addColumnIfMissing(ddl);
  }

  // Ownership column.
  await addColumnIfMissing(
    `ALTER TABLE application_documents ADD COLUMN active_generation_run_id VARCHAR(36) DEFAULT NULL`,
  );

  // Application-scoped intake context (migrations/2026-10-01-application-context-scope.sql).
  // Purely additive — no backfill semantics needed: existing rows keep
  // DEFAULT 1 (LEGACY shared-profile fallback), new apps are created at 2.
  await addColumnIfMissing(
    `ALTER TABLE applications ADD COLUMN context_data JSON DEFAULT NULL`,
  );
  await addColumnIfMissing(
    `ALTER TABLE applications ADD COLUMN application_context_version INT NOT NULL DEFAULT 1`,
  );

  // attempt_seq — gated three-step migration.
  const seq = await columnMeta("generation_runs", "attempt_seq");
  if (!seq.autoIncrement) {
    const pre = await precheckGenerationMigration();
    if (pre.activeCount > 0 && !opts?.allowActiveRuns) {
      throw new MigrationBlockedError(pre.activeCount);
    }
    if (!seq.exists) {
      await pool.execute(
        `ALTER TABLE generation_runs ADD COLUMN attempt_seq BIGINT NULL`,
      );
    }
    // Deterministic backfill: created_at ASC, id ASC tie-breaker
    // (migration-only — true sub-ms ordering is unrecoverable).
    await pool.execute(
      `UPDATE generation_runs g
       JOIN (
         SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
         FROM generation_runs WHERE attempt_seq IS NULL
       ) x ON x.id = g.id
       SET g.attempt_seq = x.rn + (
         SELECT m FROM (SELECT COALESCE(MAX(attempt_seq),0) AS m FROM generation_runs) t
       )`,
    );
    await pool.execute(
      `ALTER TABLE generation_runs MODIFY attempt_seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE`,
    );
  } else if (!(await uniqueIndexOnColumn("generation_runs", "attempt_seq"))) {
    // Auto-incremented but missing the UNIQUE property (partial schema).
    const pre = await precheckGenerationMigration();
    if (pre.activeCount > 0 && !opts?.allowActiveRuns) {
      throw new MigrationBlockedError(pre.activeCount);
    }
    await pool.execute(
      `ALTER TABLE generation_runs ADD UNIQUE KEY uq_runs_attempt_seq (attempt_seq)`,
    );
  }

  // Post-migration verification — the migration fails loudly if any
  // required element is still absent.
  const missing = await verifyGenerationOrderingSchema();
  if (missing.length > 0) {
    throw new Error(`MIGRATION_INCOMPLETE: ${missing.join(", ")}`);
  }
  return { missing };
}
