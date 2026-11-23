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

const ABBREVIATION = /^(?:e\.g|i\.e|etc|vs|approx|cf|al|fig|esp|incl)$/i;
/** "word. lowercase" junctions — a period followed by a lowercase word,
 *  skipping abbreviations (e.g. / i.e. / etc.), dotted acronyms and
 *  ellipses. Keyed so only junctions NEW in a rewrite count. */
function midSentenceBreaks(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\S+)\.[ \t]+([a-z][a-z'’-]*)/g)) {
    const prev = m[1].replace(/^[("'“‘[]+/, "");
    if (ABBREVIATION.test(prev) || prev.endsWith(".") || /\.\w/.test(prev)) continue;
    out.add(`${prev.toLowerCase()}. ${m[2]}`);
  }
  return out;
}

const CHAT_LEAKS = [
  /with the information (?:you['’]ve|you have) (?:given|provided)/i,
  /here(?: is|['’]s) the rewritten/i,
  /\bas requested\b/i,
];
const ENROLLED_IN_MASTERS = /\benrolled (?:in|for) (?:a|the) masters?\b/i;

/**
 * Severe corruptions a provider rewrite can introduce — checked for the
 * single-sentence path (via checkRewrite) and per section by the
 * full-document Humanizer. Only patterns ABSENT from the original count.
 * Returns the reason, or null when none is found.
 */
export function severeCorruption(original: string, rewrite: string): string | null {
  const before = midSentenceBreaks(original);
  const broken = [...midSentenceBreaks(rewrite)].find(k => !before.has(k));
  if (broken) return `the rewrite broke a sentence mid-way ("${broken}")`;
  const leak = CHAT_LEAKS.map(re => rewrite.match(re)).find((m, i) => m && !CHAT_LEAKS[i].test(original));
  if (leak) return `the rewrite contains a chat-assistant phrase ("${leak[0]}")`;
  if (ENROLLED_IN_MASTERS.test(rewrite) && !/\benrolled\b/i.test(original)) {
    return "the rewrite claims the applicant is already enrolled in a master's program";
  }
  return null;
}

const IRREGULAR_PAST = "built|made|led|wrote|ran|took|got|began|found|saw|taught|grew|became|chose|did|won|spent|kept|brought|thought|felt|met|held|gave|went|sought|understood|learnt";
const SUBJECTLESS_START = new RegExp(`^(?:\\w+ly\\s+|(?:then|also|later|soon|eventually|previously)\\s+)?(?:\\w+ed|${IRREGULAR_PAST})\\b`);
/** "I recently created…" rewritten as "Recently created…" — the subject vanished. */
function droppedSubject(original: string, rewrite: string): boolean {
  return /^I\s/.test(original.trim()) && !/\bI\b/.test(rewrite) && SUBJECTLESS_START.test(rewrite.trim().toLowerCase());
}

/**
 * Safety gate before a provider rewrite may be staged. Rejects — never
 * repairs — a rewrite that drops numbers/names/acronyms from the
 * original, loses the sentence's ending punctuation, turns a statement
 * into a question, introduces a severe corruption (mid-sentence break,
 * chat phrase, applicant→enrolled flip) or drops the leading "I".
 */
export function checkRewrite(original: string, replacement: string): RewriteCheck {
  const rewritten = replacement.trim();
  if (!rewritten) return { ok: false, reason: "the rewrite was empty" };
  const severe = severeCorruption(original, rewritten);
  if (severe) return { ok: false, reason: severe };
  if (droppedSubject(original, rewritten)) return { ok: false, reason: 'the rewrite dropped the sentence\'s subject ("I")' };
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
