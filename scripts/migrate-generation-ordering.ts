/**
 * Explicit deployment-owned migration: generation ordering schema.
 *
 * Applies, in order:
 *   1. additive columns (recovery_count, warnings_json,
 *      provider_error_message)
 *   2. application_documents.active_generation_run_id
 *   3. generation_runs.attempt_seq (add → deterministic backfill →
 *      NOT NULL + AUTO_INCREMENT + UNIQUE)
 *   4. schema verification
 *
 * REFUSES to run while active runs exist (QUEUED/RUNNING/RECOVERING/
 * CANCEL_REQUESTED) — abort with GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS.
 *
 * Runbook:
 *   1. stop accepting new generation starts
 *   2. let active generations finish / reconcile them
 *   3. npm run generation:migration-precheck  → must exit 0
 *   4. npm run migrate:generation-ordering    → this script
 *   5. deploy the code that requires attempt_seq
 *   6. re-enable generation
 *
 * Usage: npx tsx scripts/migrate-generation-ordering.ts
 *        (or npm run migrate:generation-ordering)
 */

import {
  runGenerationOrderingMigrations,
  precheckGenerationMigration,
  MigrationBlockedError,
} from "../src/lib/application/generation-schema";
import { closeDbPool } from "../src/lib/application/db";

async function main() {
  const pre = await precheckGenerationMigration();
  console.log("Preflight:", JSON.stringify({
    activeCount: pre.activeCount,
    statusBreakdown: pre.statusBreakdown,
    oldestHeartbeat: pre.oldestHeartbeat,
    newestHeartbeat: pre.newestHeartbeat,
  }));

  if (pre.activeCount > 0) {
    console.error(`GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS count=${pre.activeCount}`);
    process.exit(2);
  }

  try {
    const res = await runGenerationOrderingMigrations();
    console.log("MIGRATION_OK missing:", res.missing.length);
    process.exit(0);
  } catch (e) {
    if (e instanceof MigrationBlockedError) {
      console.error(`GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS count=${e.activeCount}`);
      process.exit(2);
    }
    console.error("MIGRATION_FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await closeDbPool();
  }
}

main();
