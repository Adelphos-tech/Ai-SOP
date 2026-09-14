import { ResponseComponent, FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import { withSafetyBlock } from "../prompt-safety-block";

/**
 * Generic planner prompt — driven by the GenerationContract.
 * No university names are hardcoded here; they come from the contract data.
 *
 * Phase 38 changes:
 * - Plan is explicitly NON-AUTHORITATIVE — planning text is structural guidance only, NOT evidence
 * - Evidence references (IDs) preferred over generated factual restatement
 * - Faculty approval filter uses approvedFaculty (STUDENT_APPROVED only)
 * - Prompt-injection safety block injected
 */
export function buildGenericPlannerPrompt(
  studentFactsText: string,
  responseComponents: ResponseComponent[],
  facultyAlignment: FacultyAlignment[],
  programContextText: string,
  documentTypeGuidance?: string
): { system: string; user: string } {
  // Phase 38: Canonical approved faculty filter
  const approvedFaculty = facultyAlignment.filter(f => f.status === "STUDENT_APPROVED");
  const hasApprovedFaculty = approvedFaculty.length > 0;

  const rcDesc = responseComponents.map((rc, i) => {
    const topics = rc.requiredTopics.map(t => t.topic).join("; ");
    return `RESPONSE COMPONENT ${rc.componentId} (label: ${rc.label}, max ${rc.pageLimit.maxPages || "unspecified"} page(s)):
Official prompt: "${rc.exactPrompt}"
Required topics: ${topics}`;
  }).join("\n\n---\n\n");

  const facultyDesc = hasApprovedFaculty
    ? approvedFaculty.map(f => `APPROVED FACULTY: ${f.facultyName}\nVerified evidence: ${f.alignmentReason}`).join("\n\n")
    : "None";

  const system = `You are an expert application writing planning assistant. You do NOT write the final text. You analyze student facts and create a structured writing plan for EACH response component defined in the application requirements.

CRITICAL: The document has ${responseComponents.length} separate response component(s). Do NOT merge them into one generic essay. Plan each component separately against its official prompt.

${documentTypeGuidance ? `\n${documentTypeGuidance}\n` : ""}
${hasApprovedFaculty ? `The student has approved faculty alignment(s). Reference them ONLY as approved — do not invent new faculty relationships.\n${facultyDesc}` : "No faculty requirement for this application."}

PLANNING TEXT IS STRUCTURAL GUIDANCE ONLY AND IS NOT EVIDENCE (Phase 38):
- Your planning notes guide the Writer's narrative structure.
- They do NOT authorize factual claims.
- A fact appearing in your plan is NOT evidence unless it is independently supported by the component's authorized evidence packet.
- Prefer evidence IDs over restating facts. Do not rephrase or summarize evidence into new factual statements.
- If you reference a fact, use its evidence ID, not a restatement.

Return ONLY valid JSON. Structure:
{
  "componentPlans": [
    {
      "componentId": "<id>",
      "officialPrompt": "<exact prompt>",
      "requiredTopics": ["..."],
      "studentEvidenceIds": ["<evidence id>", "..."],
      "programEvidenceIds": ["<evidence id>", "..."],
      "facultyEvidenceIds": ["<evidence id>", "..."],
      "planningNotes": "<structural guidance only — NOT evidence>",
      "factsToOmit": ["..."],
      "missingInformation": ["..."],
      "narrativeStrategy": "<how to structure the response>"
    }
  ]
}`;

  const user = `Analyze this student profile and create a writing plan for each response component.

${rcDesc}

PROGRAM CONTEXT:
${programContextText || "Not provided."}

STUDENT FACTS:
${studentFactsText}

Return ONLY the JSON plan. Use evidence IDs where available. Do not restate facts as new authority.`;

  return { system: withSafetyBlock(system), user };
}
