// ============================================================
// RESOLVED LENGTH CONTEXT — single source of truth
// ============================================================
// wordLimit.min/max exist in the Generation Contract but were never
// propagated into stage execution — the observed production bug where
// a 800–1000 word requirement produced a ~613-word document.
//
// All stage prompts, the action planner, and post-final checks derive
// length context from THIS module. Word counting uses the canonical
// countWordsForText (post-final-checks) — one counting rule everywhere.
// ============================================================

import { countWordsForText } from "@/lib/output/post-final-checks";

export interface WordLimit {
  min?: number | null;
  max?: number | null;
}

export type LengthStatus = "BELOW_MIN" | "WITHIN_RANGE" | "ABOVE_MAX" | "NO_LIMIT";

export interface ResolvedLengthContext {
  minWords: number | null;
  maxWords: number | null;
  /** Deterministic safe target: min + round((max-min) * 0.4).
   *  800–1000 → 880. Never targets the floor — downstream polish
   *  may reduce length. */
  targetWords: number | null;
}

export function resolveLengthContext(wordLimit?: WordLimit | null): ResolvedLengthContext {
  const minWords = typeof wordLimit?.min === "number" && wordLimit.min > 0 ? wordLimit.min : null;
  const maxWords = typeof wordLimit?.max === "number" && wordLimit.max > 0 ? wordLimit.max : null;
  let targetWords: number | null = null;
  if (minWords !== null && maxWords !== null && maxWords > minWords) {
    targetWords = minWords + Math.round((maxWords - minWords) * 0.4);
  } else if (minWords !== null) {
    targetWords = Math.round(minWords * 1.1); // min only → small headroom
  } else if (maxWords !== null) {
    targetWords = Math.round(maxWords * 0.9); // max only → stay under
  }
  return { minWords, maxWords, targetWords };
}

export function lengthStatusFor(words: number, ctx: ResolvedLengthContext): LengthStatus {
  if (ctx.minWords === null && ctx.maxWords === null) return "NO_LIMIT";
  if (ctx.minWords !== null && words < ctx.minWords) return "BELOW_MIN";
  if (ctx.maxWords !== null && words > ctx.maxWords) return "ABOVE_MAX";
  return "WITHIN_RANGE";
}

export function wordsOf(text: string | null | undefined): number {
  return countWordsForText(text || "");
}

/** Prompt-facing block — deterministic, identical across stages. */
export function describeLengthContext(ctx: ResolvedLengthContext, currentWords?: number): string {
  if (ctx.minWords === null && ctx.maxWords === null) return "";
  const lines: string[] = [];
  if (currentWords !== undefined) lines.push(`Current word count (deterministic): ${currentWords}`);
  if (ctx.minWords !== null) lines.push(`Minimum words: ${ctx.minWords}`);
  if (ctx.maxWords !== null) lines.push(`Maximum words: ${ctx.maxWords}`);
  if (ctx.targetWords !== null) lines.push(`Target length: approximately ${ctx.targetWords} words`);
  if (currentWords !== undefined) lines.push(`Length status: ${lengthStatusFor(currentWords, ctx)}`);
  return lines.join("\n");
}
