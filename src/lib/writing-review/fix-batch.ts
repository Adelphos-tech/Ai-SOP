// ============================================================
// Brick 3 — batch sentence-fix runner.
// Pure scheduling logic, fully injectable: the panel supplies the
// paid `action:"rewrite"` transport, the runner supplies ordering,
// bounded concurrency, stop/drift abort and honest failure tracking.
// Never fabricates a replacement — a failed sentence is reported,
// not invented.
// ============================================================

/** A flagged sentence keyed by its resolved start offset — the same
 *  key the staged-edits map uses, so batch results drop straight in. */
export interface BatchTarget { start: number; end: number; text: string }

export type BatchRewriteResult =
  | { ok: true; replacement: string }
  | { ok: false; error: string };

export interface BatchFixResult {
  /** Sentences that were rewritten and handed to onStaged. */
  staged: number;
  /** Targets whose provider call actually failed — retryable set. */
  failed: BatchTarget[];
  /** True when halted early (Stop pressed or version drifted). */
  stopped: boolean;
}

/** Flagged findings that have no staged fix yet — batch never
 *  overwrites a fix the user already accepted or typed manually. */
export function unstagedTargets<T extends { start: number }>(
  findings: readonly T[],
  stagedStarts: ReadonlySet<number>,
): T[] {
  return findings.filter(f => !stagedStarts.has(f.start));
}

/**
 * Rewrite targets with bounded concurrency (default 2 — the rewrite
 * endpoint has no cooldown, only per-call timeout + ledger dedup).
 * - `rewrite` performs ONE paid call; a fresh operationId per target
 *   is the caller's job.
 * - `onStaged` fires per success so each result lands in the shared
 *   staged-edits map immediately.
 * - `signal` = user pressed Stop; `shouldAbort` = version drifted —
 *   in-flight results are still staged when they complete (already
 *   billed, still the same version) UNLESS shouldAbort is true, in
 *   which case they are discarded because the base text moved on.
 * - Unattempted targets after a stop are neither staged nor failed;
 *   the caller can simply recompute remaining targets to resume.
 */
export async function runBatchFix(opts: {
  targets: BatchTarget[];
  rewrite: (t: BatchTarget, signal?: AbortSignal) => Promise<BatchRewriteResult>;
  onStaged: (t: BatchTarget, replacement: string) => void;
  shouldAbort?: () => boolean;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<BatchFixResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 3));
  const queue = [...opts.targets];
  const failed: BatchTarget[] = [];
  let staged = 0;
  let stopped = false;
  const halted = () => opts.signal?.aborted === true || opts.shouldAbort?.() === true;

  async function worker() {
    for (;;) {
      if (halted()) { stopped = true; return; }
      const t = queue.shift();
      if (!t) return;
      const r = await opts.rewrite(t, opts.signal)
        .catch((e: any): BatchRewriteResult => ({ ok: false, error: e?.message || "Rewrite failed" }));
      // Version drift mid-flight: the result describes stale offsets —
      // discard it rather than corrupt a newer version's map.
      if (opts.shouldAbort?.()) { stopped = true; return; }
      if (r.ok) { staged++; opts.onStaged(t, r.replacement); }
      else failed.push(t);
      if (halted()) { stopped = true; return; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return { staged, failed, stopped };
}
