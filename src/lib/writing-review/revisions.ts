// ============================================================
// AI Writing Review — range-anchored revision application
// Applying an approved revision edits exactly one [start,end)
// range of the base content. It never runs a global replace, so
// identical sentences elsewhere are untouched and all unrelated
// text is preserved byte-for-byte.
// ============================================================

import type { DocumentRevision, FlaggedPassage } from "./types";
import { resolvePassageRange } from "./segmentation";

export interface ApplyOutcome {
  /** Content after applying every applicable APPROVED/EDITED revision. */
  content: string;
  applied: string[];           // revision ids that were written
  skipped: { id: string; reason: string }[];
}

const APPLICABLE = new Set(["APPROVED", "EDITED"]);

/**
 * Apply approved revisions to the base content in one pass.
 * Each revision carries the range it was created against (anchored to
 * the detection-time content). Ranges are resolved defensively: if the
 * slice no longer matches the recorded text, the revision is skipped
 * rather than blindly overwriting.
 */
export function applyApprovedRevisions(
  baseContent: string,
  revisions: DocumentRevision[],
): ApplyOutcome {
  const applicable = revisions
    .filter(r => APPLICABLE.has(r.status))
    .sort((a, b) => a.passageStart - b.passageStart);

  const outcome: ApplyOutcome = { content: baseContent, applied: [], skipped: [] };
  let drift = 0; // running offset shift from earlier edits

  for (const rev of applicable) {
    const replacement = rev.status === "EDITED" && rev.editedText !== undefined
      ? rev.editedText
      : rev.suggestionText;
    const shiftedStart = rev.passageStart + drift;
    const shiftedEnd = rev.passageEnd + drift;
    const resolved = resolvePassageRange(
      outcome.content,
      { start: shiftedStart, end: shiftedEnd, text: rev.originalText },
    );
    if (!resolved) {
      outcome.skipped.push({ id: rev.id, reason: "CONFLICT" });
      continue;
    }
    outcome.content =
      outcome.content.slice(0, resolved.start) +
      replacement +
      outcome.content.slice(resolved.end);
    drift += replacement.length - (resolved.end - resolved.start);
    outcome.applied.push(rev.id);
  }
  return outcome;
}

/** Passage offsets become stale whenever the document's content
 *  changes. Re-anchor a passage to the *current* draft for display:
 *  exact range first, then unique-text fallback. Returns null when
 *  the passage can no longer be located safely. */
export function reanchorPassage(
  currentContent: string,
  passage: FlaggedPassage,
): { start: number; end: number } | null {
  return resolvePassageRange(currentContent, passage);
}

export function passageIsStale(currentContent: string, passage: FlaggedPassage): boolean {
  return reanchorPassage(currentContent, passage) === null;
}
