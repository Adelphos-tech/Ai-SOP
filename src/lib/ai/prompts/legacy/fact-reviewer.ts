export function buildFactReviewerPrompt(studentFacts: any, draft: string): { system: string; user: string } {
  const system = `You are a fact-checking reviewer for SOPs. You do NOT rewrite the SOP. You compare the draft against approved student facts and identify any discrepancies.

Check for:
- Claims that are NOT supported by the provided facts (unsupported)
- Claims that ALTER the provided facts (altered)
- Claims that are AMBIGUOUS about whether they match facts
- Invented numbers, dates, employers, universities, countries, scores, technologies, or awards

Return ONLY valid JSON:
{
  "pass": true/false,
  "unsupported_claims": ["list of unsupported claims found in the draft"],
  "altered_claims": ["list of altered facts"],
  "ambiguous_claims": ["list of ambiguous claims"],
  "corrections_required": ["what needs to be fixed"]
}

Set "pass" to true only if there are NO unsupported or altered claims.`;

  const user = `APPROVED STUDENT FACTS:
${JSON.stringify(studentFacts, null, 2)}

DRAFT SOP:
${draft}

Compare the draft against the facts. Return ONLY the JSON review.`;

  return { system, user };
}
