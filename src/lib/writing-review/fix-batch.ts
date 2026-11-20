// ============================================================
// Brick 3 — batch sentence-fix runner.
// Pure scheduling logic, fully injectable: the panel supplies the
// paid `action:"rewrite"` transport, the runner supplies ordering,
// bounded concurrency, stop/drift abort and honest failure tracking.
// Never fabricates a replacement — a failed sentence is reported,
// not invented.
// ============================================================

import { isHeading, missingDetails } from "./document-structure";

/** A flagged sentence keyed by its resolved start offset — the same
 *  key the staged-edits map uses, so batch results drop straight in. */
export interface BatchTarget { start: number; end: number; text: string }

export type BatchRewriteResult =
  | { ok: true; replacement: string }
  | { ok: false; error: string };

export interface BatchFixResult {
  /** Sentences that were rewritten and handed to onStaged. */
  staged: number;
  /** Targets whose provider call failed or whose rewrite was rejected
   *  by checkRewrite — retryable set. */
  failed: BatchTarget[];
  /** How many of `failed` were rewrites rejected by the safety gate. */
  rejected: number;
  /** True when halted early (Stop pressed or version drifted). */
  stopped: boolean;
}

/** Headings (e.g. "STATEMENT OF PURPOSE") are document structure, not
 *  prose — they are never sent for sentence rewriting. Same rule the
 *  full-document Humanizer uses to pass headings through. */
export function isFixableFinding(f: { text: string }): boolean {
  return !isHeading(f.text);
}

/** Flagged, fixable findings that have no staged fix yet — batch never
 *  overwrites a fix the user already accepted or typed manually, and
 *  never queues a heading. */
export function unstagedTargets<T extends { start: number; text: string }>(
  findings: readonly T[],
  stagedStarts: ReadonlySet<number>,
): T[] {
  return findings.filter(f => isFixableFinding(f) && !stagedStarts.has(f.start));
}

/** Above either limit, sentence-by-sentence rewriting shreds the
 *  document's flow (one 55-sentence run produced broken grammar) — the
 *  full-document Humanizer is the right tool instead. */
export const BATCH_MAX_FLAGGED = 20;
export const BATCH_MAX_FLAGGED_SHARE = 0.5;

export function batchFixBlocked(flagged: number, totalSentences: number): boolean {
  return flagged > BATCH_MAX_FLAGGED || (totalSentences > 0 && flagged / totalSentences >= BATCH_MAX_FLAGGED_SHARE);
}

export type RewriteCheck = { ok: true } | { ok: false; reason: string };

const terminalMark = (s: string) => /([.!?])["'”’)\]]*\s*$/.exec(s)?.[1] ?? null;

/**
 * Safety gate before a provider rewrite may be staged. Rejects — never
 * repairs — a rewrite that drops numbers/names/acronyms from the
 * original, loses the sentence's ending punctuation, or turns a
 * statement into a question.
 */
export function checkRewrite(original: string, replacement: string): RewriteCheck {
  const rewritten = replacement.trim();
  if (!rewritten) return { ok: false, reason: "the rewrite was empty" };
  const lost = missingDetails(original, rewritten).filter(t => !/^I['’]/.test(t));
  if (lost.length) return { ok: false, reason: `the rewrite dropped details (${lost.slice(0, 4).join(", ")})` };
  const before = terminalMark(original), after = terminalMark(rewritten);
  if (before && !after) return { ok: false, reason: "the rewrite lost its ending punctuation" };
  if (before === "." && after === "?") return { ok: false, reason: "the rewrite turned a statement into a question" };
  return { ok: true };
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
  let staged = 0, rejected = 0;
  let stopped = false;
  const halted = () => opts.signal?.aborted === true || opts.shouldAbort?.() === true;

  async function worker() {
    for (;;) {
      if (halted()) { stopped = true; return; }
      const t = queue.shift();
      if (!t) return;
      if (!isFixableFinding(t)) continue; // headings are never rewritten
      const r = await opts.rewrite(t, opts.signal)
        .catch((e: any): BatchRewriteResult => ({ ok: false, error: e?.message || "Rewrite failed" }));
      // Version drift mid-flight: the result describes stale offsets —
      // discard it rather than corrupt a newer version's map.
      if (opts.shouldAbort?.()) { stopped = true; return; }
      const verdict = r.ok ? checkRewrite(t.text, r.replacement) : null;
      if (r.ok && verdict?.ok) { staged++; opts.onStaged(t, r.replacement.trim()); }
      else { if (r.ok) rejected++; failed.push(t); }
      if (halted()) { stopped = true; return; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return { staged, failed, rejected, stopped };
}
