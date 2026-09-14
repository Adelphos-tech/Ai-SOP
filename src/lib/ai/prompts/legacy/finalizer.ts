import { AiInput } from "../../pipeline/build-ai-input";
import { PlannerOutput, FactReviewOutput, QualityReviewOutput } from "../../types";

export function buildFinalizerPrompt(
  input: AiInput,
  plan: PlannerOutput,
  draft: string,
  factReview: FactReviewOutput,
  qualityReview: QualityReviewOutput,
  wordRange: { min: number; max: number }
): { system: string; user: string } {
  const system = `You are the final SOP editor. You produce the final, polished SOP from a draft, fact review, and quality review.

YOUR JOB:
- Remove any unsupported claims identified by the fact reviewer
- Preserve all approved facts
- Improve narrative weaknesses identified by the quality reviewer
- Remove obvious generic clichés and consultant language
- Remove repetition
- Respect the word range (${wordRange.min}-${wordRange.max} words)
- Respect the selected language profile
- Answer the university prompt if one was provided
- Return ONLY plain paragraphs — no markdown, no headings, no bullet points, no title, no commentary

CRITICAL: Never fix an unsupported claim by inventing another plausible claim. If a claim is unsupported, remove it or rephrase using only approved facts.

${input.application.sopQuestion ? `UNIVERSITY SOP QUESTION (must be directly answered): "${input.application.sopQuestion}"` : ""}`;

  const user = `Produce the final SOP.

STUDENT FACTS (source of truth):
${JSON.stringify(input, null, 2)}

WRITING PLAN:
${JSON.stringify(plan, null, 2)}

DRAFT SOP:
${draft}

FACT REVIEW:
${JSON.stringify(factReview, null, 2)}

QUALITY REVIEW:
${JSON.stringify(qualityReview, null, 2)}

Produce the final, polished SOP now. Return ONLY the SOP text in professional paragraphs.`;

  return { system, user };
}
