// ============================================================
// Plain-text normalization for generated drafts.
// Models occasionally wrap numbers in inline LaTeX math ($7.89/10$),
// which leaks into the saved SOP and exported PDF as raw syntax.
// ============================================================

// Inline math whose body is ONLY a simple numeric expression: digits
// with . or , separators, optional %, \%, and simple operators between
// numbers (/ : - – × \times x). A lone currency amount ($50,000) has no
// closing "$" directly after the number, so it never matches.
const NUM = String.raw`\d[\d.,]*(?:\s*\\?%)?`;
const OP = String.raw`(?:\/|:|-|–|×|\\times|x)`;
const INLINE_NUMERIC_MATH = new RegExp(String.raw`\$\s*(${NUM}(?:\s*${OP}\s*${NUM})*)\s*\$`, "g");

/** `$7.89/10$` → `7.89/10`, `$9.2$` → `9.2`, `$30\%$` → `30%`,
 *  `$2 \times 3$` → `2 × 3`. Currency like `$50,000` is untouched. */
export function stripInlineLatexMath(text: string): string {
  return text.replace(INLINE_NUMERIC_MATH, (_m, body: string) =>
    body.replace(/\\%/g, "%").replace(/\\times/g, "×"));
}
