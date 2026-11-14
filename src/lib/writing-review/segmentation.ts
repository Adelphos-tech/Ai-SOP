// ============================================================
// AI Writing Review — sentence segmentation
// Splits canonical plain-text document content (blank-line-separated
// paragraphs) into sentences with stable character offsets. Offsets
// index into the version content string so flagged passages are
// anchored by range, never by global text search.
// ============================================================

export interface DocumentSentence {
  index: number;
  paragraphIndex: number;
  /** UTF-16 offset range into the source content. */
  start: number;
  end: number;
  text: string;
}

const SENTENCE_END = /[.!?]["')\]]*\s+/;

/**
 * Split content into sentences with real offsets.
 * A sentence ends at sentence-final punctuation followed by whitespace.
 * Headings and list lines without terminal punctuation stay whole.
 */
export function segmentDocumentSentences(content: string): DocumentSentence[] {
  const sentences: DocumentSentence[] = [];
  const paragraphs = content.split(/\n\s*\n/);
  let paragraphIndex = 0;
  let base = 0; // offset where current paragraph's text begins
  let cursor = 0; // scan position across whole content

  for (const para of paragraphs) {
    const paraText = para.trim();
    // Locate where this (trimmed) paragraph begins in the source.
    const start = content.indexOf(paraText, cursor);
    if (start < 0) { cursor = base; continue; }
    base = start;
    cursor = start + paraText.length;

    if (!paraText) { paragraphIndex++; continue; }

    let segStart = 0;
    let i = 0;
    let index = sentences.length;
    while (i <= paraText.length) {
      const m = SENTENCE_END.exec(paraText.slice(i));
      if (!m) {
        // tail: remainder of the paragraph (may be empty if trailing ws)
        const end = paraText.length;
        const text = paraText.slice(segStart, end).trim();
        if (text) {
          const absStart = base + segStart + leadingWs(paraText.slice(segStart));
          sentences.push({ index: index++, paragraphIndex, start: absStart, end: absStart + text.length, text });
        }
        break;
      }
      const boundary = i + m.index + m[0].length;
      const raw = paraText.slice(segStart, boundary);
      const text = raw.trim();
      if (text) {
        const absStart = base + segStart + leadingWs(raw);
        sentences.push({ index: index++, paragraphIndex, start: absStart, end: absStart + text.length, text });
      }
      segStart = boundary;
      i = boundary;
    }
    paragraphIndex++;
  }
  return sentences;
}

function leadingWs(s: string): number {
  const m = /^\s*/.exec(s);
  return m ? m[0].length : 0;
}

/**
 * Locate the passage inside content using its recorded range first;
 * when the content shifted (edits elsewhere), fall back to an exact
 * match scan — never substring-replace anything else.
 */
export function resolvePassageRange(
  content: string,
  passage: { start: number; end: number; text: string },
): { start: number; end: number } | null {
  if (content.slice(passage.start, passage.end) === passage.text) {
    return { start: passage.start, end: passage.end };
  }
  let idx = content.indexOf(passage.text);
  if (idx < 0) return null;
  // unique occurrence required — ambiguous matches are unsafe to edit
  if (content.indexOf(passage.text, idx + 1) !== -1) return null;
  return { start: idx, end: idx + passage.text.length };
}
