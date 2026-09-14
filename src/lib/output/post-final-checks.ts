/**
 * @file post-final-checks.ts
 * @description
 * Deterministic (non-AI) checks run after the final fact review.
 * No OpenAI calls.
 */

export interface PostFinalCheckResult {
  pass: boolean;
  responseCount: number;
  expectedResponseCount: number;
  emptyResponses: string[];
  wordCounts: Record<string, number>;
  characterCounts: Record<string, number>;
  hasMarkdown: boolean;
  issues: string[];
}

export function countWordsForText(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function runPostFinalChecks(
  responses: Array<{ componentId: string; text: string }>,
  expectedResponseCount: number
): PostFinalCheckResult {
  const issues: string[] = [];
  const emptyResponses: string[] = [];
  const wordCounts: Record<string, number> = {};
  const characterCounts: Record<string, number> = {};

  if (responses.length !== expectedResponseCount) {
    issues.push(`Expected ${expectedResponseCount} responses, got ${responses.length}.`);
  }

  for (const r of responses) {
    if (!r.text || r.text.trim().length === 0) {
      emptyResponses.push(r.componentId);
      issues.push(`Response ${r.componentId} is empty.`);
    }
    wordCounts[r.componentId] = countWordsForText(r.text || "");
    characterCounts[r.componentId] = (r.text || "").length;

    // Markdown detection
    if (/^#{1,6}\s|\*\*|\`\`\`|^- \[|\|.*\|/m.test(r.text || "")) {
      issues.push(`Response ${r.componentId} contains markdown.`);
    }
  }

  return {
    pass: issues.length === 0,
    responseCount: responses.length,
    expectedResponseCount,
    emptyResponses,
    wordCounts,
    characterCounts,
    hasMarkdown: issues.some(i => i.includes("markdown")),
    issues,
  };
}
