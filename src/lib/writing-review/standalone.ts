// ============================================================
// Standalone "Humanizer & AI Check" — shared guards for the
// /api/standalone-studio/* routes. No document row exists in this
// module; the same paid pipelines run on submitted text with the
// same consent/ledger/dedup protections.
// ============================================================

import { countWords } from "./document-structure";

export const STANDALONE_MAX_WORDS = 5_000;
export const STANDALONE_MAX_CHARS = 60_000;
/** Pseudo version/document key recorded on standalone ledger events. */
export const STANDALONE_VERSION_ID = "standalone";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns an error message when the submitted text is unusable. */
export function standaloneTextError(content: unknown): string | null {
  if (typeof content !== "string" || !content.trim()) return "content is required";
  if (content.length > STANDALONE_MAX_CHARS) {
    return `content exceeds the ${STANDALONE_MAX_CHARS.toLocaleString()} character limit`;
  }
  const words = countWords(content);
  if (words > STANDALONE_MAX_WORDS) {
    return `content exceeds the ${STANDALONE_MAX_WORDS.toLocaleString()} word limit (${words.toLocaleString()} words)`;
  }
  return null;
}
