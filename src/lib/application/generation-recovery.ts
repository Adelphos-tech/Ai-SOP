// ============================================================
// GENERATION RECOVERY — restart/orphan resume
// ============================================================
// When the process restarts mid-generation (PM2 deploy, crash), the
// generation_runs row stays RUNNING but nothing is executing it.
//
// Recovery = re-invoke the SAME pipeline for the same run id:
// - completed stages reuse their persisted provider responses via
//   stage fingerprint (no model re-call, no double billing)
// - the interrupted stage resumes polling its provider_response_id
// - the checkpoint lock's stale-PID path handles the dead process
//
// A run is only recovered when its heartbeat is older than
// ORPHAN_GRACE_MS AND no live in-process execution exists — a live
// pipeline writes a heartbeat every ~8s.
// ============================================================

import { getActiveRuns, GenerationRun } from "./generation-lifecycle";
import { isGenerationLive } from "./generation-registry";
import { generateApplicationDocument } from "./generation-service";

const ORPHAN_GRACE_MS = 15_000;

function heartbeatAgeMs(run: GenerationRun): number {
  const hb = run.lastHeartbeatAt || run.generationStartedAt;
  if (!hb) return Infinity;
  return Date.now() - new Date(hb).getTime();
}

export function isOrphanedRun(run: GenerationRun): boolean {
  if (isGenerationLive(run.documentId)) return false;
  return heartbeatAgeMs(run) > ORPHAN_GRACE_MS;
}

function resumeRun(run: GenerationRun): void {
  generateApplicationDocument({
    studentId: run.studentId,
    applicationId: run.applicationId,
    documentId: run.documentId,
    resumeRunId: run.id,
    requestId: `recovery-${run.id.slice(0, 8)}`,
  }).catch((e) => {
    console.error(JSON.stringify({
      event: "generation_recovery_failed",
      runId: run.id,
      documentId: run.documentId,
      error: e instanceof Error ? e.message : String(e),
    }));
  });
}

/** Startup scan — recover every orphaned active run. */
export async function recoverInterruptedGenerations(): Promise<void> {
  try {
    const runs = await getActiveRuns();
    for (const run of runs) {
      if (isOrphanedRun(run)) {
        console.log(JSON.stringify({
          event: "generation_recovery_start",
          runId: run.id,
          documentId: run.documentId,
          stage: run.currentStage,
        }));
        resumeRun(run);
      }
    }
  } catch (e) {
    console.error("generation recovery scan failed:", e);
  }
}

/** Endpoint-driven recovery — resume one orphaned run if needed. */
export function maybeRecoverRun(run: GenerationRun): void {
  if (!isOrphanedRun(run)) return;
  console.log(JSON.stringify({
    event: "generation_recovery_start",
    runId: run.id,
    documentId: run.documentId,
    stage: run.currentStage,
    via: "status_endpoint",
  }));
  resumeRun(run);
}
