import type { ResponseComponent } from "@/lib/requirements/generation-contract-types";
import { isHardMandatoryTopicStatus } from "@/lib/requirements/generation-gate";

/**
 * Render a response component's requirement block consistently across
 * Planner / Writer / Quality Reviewer prompts.
 *
 * Distinctions matter:
 *  - hard-mandatory topics (VERIFIED/REQUIRED official requirements):
 *    must be covered; missing coverage can hard-block.
 *  - DECLARED topics (consultant/application-entered): must be
 *    attempted where approved evidence exists, but absence of
 *    keyword-matched evidence never aborts generation.
 *  - additionalQuestions: university questions the draft should
 *    materially answer — reviewable but not evidence-gated.
 */
export function formatComponentRequirements(rc: ResponseComponent): string {
  const hard = rc.requiredTopics.filter(t => isHardMandatoryTopicStatus(t.status)).map(t => t.topic);
  const soft = rc.requiredTopics.filter(t => !isHardMandatoryTopicStatus(t.status)).map(t => t.topic);
  const questions = rc.additionalQuestions || [];

  const lines: string[] = [];
  lines.push(`Required topics (must cover): ${hard.length ? hard.join("; ") : "None"}`);
  if (soft.length) {
    lines.push(`Requested topics (consultant-requested — cover where approved evidence allows): ${soft.join("; ")}`);
  }
  if (questions.length) {
    lines.push(`University questions to address: ${questions.join("; ")}`);
  }
  return lines.join("\n");
}
