export function hasMarkdown(text: string): boolean {
  // Check for markdown formatting markers
  if (/^#{1,6}\s/m.test(text)) return true; // headings
  if (/\*\*[^*]+\*\*/.test(text)) return true; // bold
  if (/(?<!\w)_[^_]+_(?!\w)/.test(text)) return true; // italic
  if (/^\s*[-*]\s/m.test(text)) return true; // bullet points
  if (/^\s*\d+\.\s/m.test(text)) return true; // numbered lists
  return false;
}

export function isEmpty(text: string): boolean {
  return !text || text.trim().length === 0;
}

export function isTooShort(text: string, minWords: number): boolean {
  const words = text.trim().split(/\s+/).length;
  return words < minWords * 0.7; // allow 30% tolerance
}

export function isTooLong(text: string, maxWords: number): boolean {
  const words = text.trim().split(/\s+/).length;
  return words > maxWords * 1.1; // allow 10% tolerance
}

export function validateOutput(text: string, minWords: number, maxWords: number): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (isEmpty(text)) issues.push("Output is empty");
  if (hasMarkdown(text)) issues.push("Output contains markdown formatting");
  if (isTooShort(text, minWords)) issues.push(`Output is too short (min ${minWords} words expected)`);
  if (isTooLong(text, maxWords)) issues.push(`Output exceeds maximum length (max ${maxWords} words)`);
  return { valid: issues.length === 0, issues };
}
