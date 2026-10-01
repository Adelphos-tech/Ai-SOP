/**
 * Attempt-artifact retention — removes expired logs/attempts/<uuid>/
 * debug directories (full model output + rendered drafts).
 *
 * Safe: only directories older than ATTEMPT_ARTIFACT_TTL_DAYS (default
 * 14) without a live .execution.lock are removed. Correlation evidence
 * survives in generation_runs / generation_stage_responses /
 * openai-usage.jsonl.
 *
 * Run:  npm run cleanup:attempt-artifacts
 */
import { cleanupAttemptArtifacts } from "../src/lib/ai/pipeline-checkpoint";
import { emitEvent } from "../src/lib/observability/events";

async function main() {
  const res = await cleanupAttemptArtifacts();
  emitEvent("attempt_artifacts_cleanup", {
    detail: `removed=${res.removed.length} skippedLocked=${res.skippedLocked.length}`,
    missing: res.removed,
  });
  console.log(`removed=${res.removed.length} skippedLocked=${res.skippedLocked.length}`);
  if (res.removed.length) console.log("removed:", res.removed.join(", "));
  if (res.skippedLocked.length) console.log("skipped (locked):", res.skippedLocked.join(", "));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
