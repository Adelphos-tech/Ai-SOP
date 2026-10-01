/**
 * READ-ONLY precheck for the generation-ordering migration.
 *
 * Prints only aggregate numbers — never student/document content.
 *
 *   npm run generation:migration-precheck
 *
 * Exit 0 → no active runs; safe to proceed with migration.
 * Exit 2 → GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS (count printed).
 */

import { precheckGenerationMigration } from "../src/lib/application/generation-schema";
import { closeDbPool } from "../src/lib/application/db";

async function main() {
  const pre = await precheckGenerationMigration();
  console.log(JSON.stringify({
    activeRunCount: pre.activeCount,
    statusBreakdown: pre.statusBreakdown,
    oldestHeartbeat: pre.oldestHeartbeat,
    newestHeartbeat: pre.newestHeartbeat,
  }, null, 2));

  if (pre.activeCount > 0) {
    console.error(`GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS count=${pre.activeCount}`);
    process.exit(2);
  }
  console.log("PRECHECK_OK — zero active generation runs");
  process.exit(0);
}

main().catch(async e => {
  console.error("PRECHECK_FAILED:", e instanceof Error ? e.message : e);
  await closeDbPool();
  process.exit(1);
});
