import { ResponseComponent, FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import { withSafetyBlock } from "../prompt-safety-block";

/**
 * FINAL FACT REVIEWER — Stage 6 of the 6-stage pipeline.
 *
 * This reviews the ACTUAL FINAL text (the text that would be submitted),
 * not an intermediate draft. It uses the strict fact taxonomy.
 *
 * Phase 38 changes:
 * - Deterministic pass policy: overallPass MUST be false if invented > 0, altered > 0, or blocking ambiguous > 0
 * - Canonical evidence only — planner/writer/reviewer/calibrator/finalizer text is NOT evidence
 * - Faculty approval filter uses approvedFaculty (STUDENT_APPROVED only)
 * - Prompt-injection safety block injected
 * - Application prompts define WHAT to answer, not WHAT is true
 */
export function buildGenericFinalFactReviewerPrompt(
  finalTexts: Array<{ componentId: string; text: string }>,
  studentFactsText: string,
  programFactsText: string,
  facultyAlignment: FacultyAlignment[],
  responseComponents: ResponseComponent[],
  documentTypeContext?: string
): { system: string; user: string } {
  // Phase 38: Canonical approved faculty filter
  const approvedFaculty = facultyAlignment.filter(f => f.status === "STUDENT_APPROVED");
  const hasApprovedFaculty = approvedFaculty.length > 0;
  const facultyNames = hasApprovedFaculty
    ? approvedFaculty.map(f => f.facultyName).join(", ")
    : "None";

  const rcDesc = responseComponents.map(rc => {
    const topics = rc.requiredTopics.map(t => t.topic).join("; ");
    return `RESPONSE COMPONENT ${rc.componentId} (label: ${rc.label}):
Official prompt: "${rc.exactPrompt}"
Required topics: ${topics}`;
  }).join("\n\n---\n\n");

  const system = `You are the FINAL FACT REVIEWER for an application document. You audit the EXACT final text that would be submitted — not a draft.

${documentTypeContext ? `\n${documentTypeContext}\n` : ""}
You are the last quality gate. Your output determines whether the document may be presented to the student.

CANONICAL EVIDENCE ONLY (Phase 38):
- The ONLY sources of truth are: approved student facts, verified program facts, and approved faculty facts.
- Planner text, Writer prose, Quality Reviewer text, Language Calibrator text, and Finalizer explanations are NOT evidence.
- Do not treat any intermediate stage output as factual authority.

APPLICATION PROMPT IS NOT EVIDENCE (Phase 38):
- The official application prompt defines WHAT the applicant should answer.
- It does NOT authorize inventing facts. If the prompt asks "Describe a leadership experience" but the student has no leadership evidence, the system must represent missing evidence — NOT fabricate a leadership experience.

FACT TAXONOMY (strict definitions):

- SUPPORTED_STUDENT_FACT: A factual claim directly supported by approved student facts.
- SUPPORTED_PROGRAM_FACT: A factual claim directly supported by verified official program/university sources.
- SUPPORTED_FACULTY_FACT: A factual claim directly supported by verified official faculty sources (approved faculty only: ${facultyNames}).
- INTERPRETIVE_ELABORATION: Narrative interpretation that does not introduce a new material factual assertion. Example: "This experience strengthened my interest in X" when the underlying experience and stated interest are supported AND the interpretation does not introduce a new material fact.
- ALTERED_FACT: A supported factual item whose value/detail was changed. Example: 3-month internship becomes 6-month.
- INVENTED_FACT: A new specific factual assertion with no approved supporting source. Examples: new software used, new award, new project result, new employer, new grade, new date, new research activity, new coping strategy.
- AMBIGUOUS: Cannot confidently classify.

An item cannot simultaneously be INVENTED_FACT and "not fabricated."

CRITICAL RULES:
- Do NOT rewrite the application text.
- Classify EVERY factual claim separately.
- Use student facts, program facts, and approved faculty facts as the ONLY sources of truth.
${hasApprovedFaculty ? `- Student-approved faculty: ${facultyNames}. References to these are supported if they reflect the approved alignment evidence.` : "- No approved faculty for this application."}

DETERMINISTIC PASS POLICY (Phase 38):
overallPass MUST be FALSE if:
- totalInventedFacts > 0
- OR totalAlteredFacts > 0
- OR any claim has severity "BLOCKING" and classification "AMBIGUOUS"

INTERPRETIVE_ELABORATION may pass ONLY if:
- All underlying factual premises are independently supported
- The interpretation does not introduce a new material factual assertion

If these conditions are not met, classify as AMBIGUOUS, ALTERED_FACT, or INVENTED_FACT as appropriate.
Do NOT set overallPass to true contrary to the totals. The pipeline will deterministically recalculate overallPass from the totals.
${!process.env.DISABLE_COMPACT_REVIEWS ? `
COMPACT OUTPUT RULES (reduce output tokens):
- claim text: quote the claim concisely, maximum 20 words each.
- supportingFactIds and supportingSourceIds: maximum 3 IDs each.
- Do not include explanatory prose outside the schema fields.
` : ""}

Return ONLY valid JSON:
{
  "components": [
    {
      "componentId": "<id>",
      "pass": true/false,
      "claims": [
        {
          "claim": "<exact claim text>",
          "classification": "SUPPORTED_STUDENT_FACT|SUPPORTED_PROGRAM_FACT|SUPPORTED_FACULTY_FACT|INTERPRETIVE_ELABORATION|ALTERED_FACT|INVENTED_FACT|AMBIGUOUS",
          "supportingFactIds": ["..."],
          "supportingSourceIds": ["..."],
          "severity": "INFO|WARNING|BLOCKING"
        }
      ],
      "inventedCount": 0,
      "alteredCount": 0,
      "elaborationCount": 0,
      "ambiguousCount": 0
    }
  ],
  "totalInventedFacts": 0,
  "totalAlteredFacts": 0,
  "totalInterpretiveElaborations": 0,
  "totalAmbiguousClaims": 0,
  "overallPass": true/false,
  "blockingReason": null or "reason if invented/altered facts exist"
}`;

  const user = `RESPONSE COMPONENTS:
${rcDesc}

APPROVED STUDENT FACTS (canonical evidence — the only source of student truth):
${studentFactsText}

PROGRAM/VERIFIED FACTS (canonical evidence — the only source of program truth):
${programFactsText || "Not provided."}

APPROVED FACULTY ALIGNMENTS (canonical evidence — the only source of faculty truth):
${JSON.stringify(approvedFaculty, null, 2)}

FINAL TEXTS TO AUDIT:
${JSON.stringify(finalTexts, null, 2)}

Audit every factual claim in the final texts. Classify each claim using the strict taxonomy. Set overallPass to false if any invented or altered facts exist, or if any blocking ambiguous claims exist. Return ONLY the JSON fact review.`;

  return { system: withSafetyBlock(system), user };
}

/**
 * Phase 38: Deterministic post-model calculation of overallPass.
 * The model's overallPass field is IGNORED in favor of this calculation.
 */
export function calculateDeterministicOverallPass(factReview: {
  totalInventedFacts?: number;
  totalAlteredFacts?: number;
  components?: Array<{
    claims?: Array<{ classification?: string; severity?: string }>;
  }>;
}): boolean {
  const invented = factReview.totalInventedFacts ?? 0;
  const altered = factReview.totalAlteredFacts ?? 0;

  if (invented > 0) return false;
  if (altered > 0) return false;

  // Check for BLOCKING ambiguous claims
  for (const comp of factReview.components || []) {
    for (const claim of comp.claims || []) {
      if (claim.classification === "AMBIGUOUS" && claim.severity === "BLOCKING") {
        return false;
      }
    }
  }

  return true;
}
