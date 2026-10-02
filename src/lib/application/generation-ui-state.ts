// ============================================================
// GENERATION UI STATE — pure, testable status-machine helpers.
//
// The backend run status is AUTHORITATIVE. The page derives all
// progress/terminal reconciliation from these functions so the
// polling loop stays a thin transport. No timers, no heuristics
// that can permanently suppress a terminal state.
// ============================================================

export const GENERATION_ACTIVE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "RECOVERING",
  "CANCEL_REQUESTED",
] as const;

export const GENERATION_TERMINAL_STATUSES = [
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
] as const;

export const GENERATION_COMPLETED_STATUSES = [
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
] as const;

export function isActiveStatus(status: string | null | undefined): boolean {
  return !!status && (GENERATION_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && (GENERATION_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isCompletedStatus(status: string | null | undefined): boolean {
  return !!status && (GENERATION_COMPLETED_STATUSES as readonly string[]).includes(status);
}

export interface PollDecision {
  /** Apply this payload to liveStatus. */
  updateLive: boolean;
  /** Clear the local `generating` flag. */
  clearGenerating: boolean;
  /** Reload document + versions (terminal success reconciliation). */
  refreshDocument: boolean;
}

/**
 * Decide what a poll payload does to UI state.
 *
 * Rules:
 *  - COMPLETED / COMPLETED_WITH_WARNINGS are ALWAYS authoritative:
 *    a completed run means a generated version exists — surface it.
 *    There is no "stale COMPLETED" worth suppressing; an old completed
 *    run still means the document has a draft to show.
 *  - FAILED / CANCELLED are authoritative too — EXCEPT the narrow
 *    regenerate race: the consultant re-submitted, the new run row is
 *    not visible yet, and the endpoint still reports the PREVIOUS run's
 *    terminal state. Accepting it would stop polling and show a stale
 *    FAILED card. Detect via generationId mismatch against the run we
 *    have actually observed, or a startedAt that predates this submit.
 *  - Active statuses always update.
 */
export function decidePollAction(args: {
  status: string | null | undefined;
  generationId: string | null | undefined;
  startedAt: string | null | undefined;
  generating: boolean;
  liveGenerationId: string | null | undefined;
  lastSubmitAt: number;
}): PollDecision {
  const { status, generationId, startedAt, generating, liveGenerationId, lastSubmitAt } = args;

  if (isCompletedStatus(status)) {
    return { updateLive: true, clearGenerating: true, refreshDocument: true };
  }

  if (status === "FAILED" || status === "CANCELLED") {
    const differentRun = !!liveGenerationId && !!generationId && generationId !== liveGenerationId;
    const predatesSubmit =
      !!startedAt && new Date(startedAt).getTime() < lastSubmitAt - 2000;
    if (generating && (differentRun || predatesSubmit)) {
      // Previous run's tombstone — the new run may not have persisted
      // yet. Ignore it and keep polling.
      return { updateLive: false, clearGenerating: false, refreshDocument: false };
    }
    return { updateLive: true, clearGenerating: true, refreshDocument: false };
  }

  // Active, IDLE, or unknown — always update the live status.
  return { updateLive: true, clearGenerating: false, refreshDocument: false };
}

/**
 * Stage-rail display derivation. Stages run sequentially, so if a
 * later stage is the current one, every preceding stage is complete —
 * even if completedStages lags behind in the status payload (the count
 * updates when a stage row is persisted; the current-stage pointer can
 * lead it by a few seconds).
 */
export function deriveStageProgress(args: {
  currentStage: string | null | undefined;
  completedStages: number | null | undefined;
  stageIds: readonly string[];
}): { activeIndex: number; completedCount: number } {
  const { currentStage, completedStages, stageIds } = args;
  const total = stageIds.length;
  const completed = completedStages ?? 0;
  const idx = currentStage ? stageIds.indexOf(currentStage) : -1;
  const activeIndex = idx >= 0 ? idx : Math.min(completed, Math.max(total - 1, 0));
  const completedCount = Math.max(completed, Math.min(activeIndex, total));
  return { activeIndex, completedCount };
}
