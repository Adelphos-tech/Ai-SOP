// ============================================================
// AI Writing Studio — document structure helpers (pure, no I/O)
// Splits a plain-text document (blank-line-separated paragraphs) into
// ordered sections for full-document humanization, aligns provider
// output back onto paragraphs, and computes the word-level diff and
// detail-preservation checks the split view displays.
// ============================================================

import { segmentDocumentSentences } from "./segmentation";

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  return segmentDocumentSentences(text).length;
}

export function splitParagraphs(content: string): string[] {
  return content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

/** A heading is a short single line without sentence-final punctuation.
 *  Headings are passed through unchanged — never sent to the provider. */
export function isHeading(paragraph: string): boolean {
  const p = paragraph.trim();
  return !!p && !p.includes("\n") && countWords(p) <= 12 && !/[.!?]["')\]]*$/.test(p);
}

/** Ryne Titan's documented billing/size unit: max(words, ceil(chars/10)). */
export function ryneUnits(text: string): number {
  return Math.max(countWords(text), Math.ceil(text.length / 10));
}

export interface SectionLimits { maxUnits: number; maxChars: number }
/** Below Titan's documented 8,000-unit and the 40,000-char hard limits. */
export const DEFAULT_SECTION_LIMITS: SectionLimits = { maxUnits: 6000, maxChars: 30_000 };

export interface PlannedSection {
  index: number;
  kind: "HEADING" | "BODY";
  paragraphs: string[];
  /** Text sent to the provider (BODY only): paragraphs joined by blank lines. */
  text: string;
  words: number;
}

export type SectionPlan =
  | { ok: true; sections: PlannedSection[]; bodyWords: number }
  | { ok: false; reason: string };

/**
 * Plan the document as ordered sections: each heading is its own
 * pass-through section; consecutive body paragraphs form a BODY
 * section, split at paragraph boundaries when it would exceed the
 * provider limits. Order is the document order — never rearranged.
 */
export function planSections(content: string, limits: SectionLimits = DEFAULT_SECTION_LIMITS): SectionPlan {
  const sections: PlannedSection[] = [];
  let body: string[] = [];
  const flush = () => {
    if (!body.length) return;
    const text = body.join("\n\n");
    sections.push({ index: sections.length, kind: "BODY", paragraphs: body, text, words: countWords(text) });
    body = [];
  };
  for (const p of splitParagraphs(content)) {
    if (isHeading(p)) {
      flush();
      sections.push({ index: sections.length, kind: "HEADING", paragraphs: [p], text: p, words: countWords(p) });
      continue;
    }
    if (ryneUnits(p) > limits.maxUnits || p.length > limits.maxChars) {
      return { ok: false, reason: `A paragraph is too long for one provider request (${countWords(p)} words). Split it into smaller paragraphs and try again.` };
    }
    const next = [...body, p].join("\n\n");
    if (body.length && (ryneUnits(next) > limits.maxUnits || next.length > limits.maxChars)) flush();
    body.push(p);
  }
  flush();
  const bodyWords = sections.filter(s => s.kind === "BODY").reduce((n, s) => n + s.words, 0);
  if (!bodyWords) return { ok: false, reason: "The document has no body text to humanize." };
  return { ok: true, sections, bodyWords };
}

/**
 * Map provider output back onto the section's paragraphs. A 1:1
 * paragraph count is required for paragraph-linked display; anything
 * else is reported as a structure change — never silently merged,
 * split, padded or dropped.
 */
export function alignRewrite(originalParagraphs: string[], output: string): { paragraphs: string[]; structureChanged: boolean } {
  const byBlank = splitParagraphs(output);
  if (byBlank.length === originalParagraphs.length) return { paragraphs: byBlank, structureChanged: false };
  const byLine = output.split(/\n+/).map(p => p.trim()).filter(Boolean);
  if (byLine.length === originalParagraphs.length) return { paragraphs: byLine, structureChanged: false };
  return { paragraphs: byBlank.length ? byBlank : [output.trim()], structureChanged: true };
}

// ---------- word diff ----------

export interface DiffToken { text: string; changed: boolean }
const MAX_DIFF_CELLS = 4_000_000;

/** Word-level LCS diff. Whitespace is kept as unchanged tokens so the
 *  original text renders exactly. Returns null when too large to diff. */
export function wordDiff(a: string, b: string): { left: DiffToken[]; right: DiffToken[] } | null {
  const ta = a.split(/(\s+)/).filter(Boolean);
  const tb = b.split(/(\s+)/).filter(Boolean);
  const wa = ta.map((t, i) => [t, i] as const).filter(([t]) => !/^\s+$/.test(t));
  const wb = tb.map((t, i) => [t, i] as const).filter(([t]) => !/^\s+$/.test(t));
  const n = wa.length, m = wb.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = norm(wa[i][0]) === norm(wb[j][0])
        ? dp[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const keepA = new Set<number>(), keepB = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (norm(wa[i][0]) === norm(wb[j][0])) { keepA.add(wa[i][1]); keepB.add(wb[j][1]); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++;
    else j++;
  }
  const mark = (toks: string[], keep: Set<number>) =>
    toks.map((text, i) => ({ text, changed: !/^\s+$/.test(text) && !keep.has(i) }));
  return { left: mark(ta, keepA), right: mark(tb, keepB) };
}

// ---------- detail preservation ----------

/**
 * Specific details (numbers, dates, percentages and capitalised
 * names/institutions not at a sentence start) present in the original
 * but absent from the rewrite. Advisory only — shown for review.
 */
export function missingDetails(original: string, rewritten: string, limit = 12): string[] {
  const found = new Set<string>();
  for (const m of original.matchAll(/\d[\d,.:/-]*\d%?|\d%?/g)) found.add(m[0].replace(/[.,]$/, ""));
  for (const s of segmentDocumentSentences(original)) {
    const words = s.text.split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/, "");
      if (i > 0 && clean.length > 1 && /^\p{Lu}/u.test(clean) && clean !== "I") found.add(clean);
    });
  }
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...found]
    .filter(t => !new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t)}($|[^\\p{L}\\p{N}])`, "u").test(rewritten))
    .slice(0, limit);
}
