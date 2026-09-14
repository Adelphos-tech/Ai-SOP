import { ResponseComponent, FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import type { ComponentEvidencePacket } from "../../component-evidence-packet";
import { withSafetyBlock } from "../prompt-safety-block";

/**
 * Phase 38A: Validate that every response component has a corresponding evidence packet.
 * Throws WRITER_EVIDENCE_PACKET_MISSING if any component is missing its packet.
 *
 * A component with an explicit zero-fact declaration (packet with allEntries.length === 0
 * and a flag) is allowed — the generation contract explicitly represents that state.
 */
export function validateWriterEvidenceCoverage(
  responseComponents: ResponseComponent[],
  evidencePackets: ComponentEvidencePacket[] | undefined
): { valid: boolean; missingComponents: string[] } {
  if (!evidencePackets || evidencePackets.length === 0) {
    return { valid: false, missingComponents: responseComponents.map(rc => rc.componentId) };
  }

  const packetMap = new Map(evidencePackets.map(p => [p.componentId, p]));
  const missing: string[] = [];

  for (const rc of responseComponents) {
    const packet = packetMap.get(rc.componentId);
    if (!packet) {
      missing.push(rc.componentId);
    }
    // If packet exists but has no entries, it must be an explicit zero-fact declaration.
    // The packet's existence itself represents the explicit declaration.
    // If the packet is absent entirely, it's a missing packet.
  }

  return { valid: missing.length === 0, missingComponents: missing };
}

/**
 * Phase 38 changes:
 * - Writing plan is explicitly NOT evidence
 * - Fail-closed: if evidencePackets missing for a component requiring factual prose, throw
 * - Claim contract: claimId uniqueness, evidenceIds must exist in authorized packet
 * - Faculty approval filter uses approvedFaculty (STUDENT_APPROVED only)
 * - Prompt-injection safety block injected
 * - Word/character/page constraints passed explicitly (not guessed)
 *
 * Phase 38A changes:
 * - Per-component evidence coverage validation (not just length > 0)
 */
export function buildGenericWriterPrompt(
  plan: any,
  studentFactsText: string,
  responseComponents: ResponseComponent[],
  facultyAlignment: FacultyAlignment[],
  writingInstructions: string,
  evidencePackets?: ComponentEvidencePacket[]
): { system: string; user: string } {
  // Phase 38A: Per-component fail-closed — every component must have a corresponding evidence packet
  const coverage = validateWriterEvidenceCoverage(responseComponents, evidencePackets);
  if (!coverage.valid) {
    throw new Error(
      `WRITER_EVIDENCE_PACKET_MISSING: Evidence packets are required for every response component. ` +
      `Missing packets for components: ${coverage.missingComponents.join(", ")}. ` +
      `The Writer must never fall back to an unrestricted studentFactsText world. ` +
      `If a component legitimately requires no factual evidence, represent that explicitly ` +
      `with an empty evidence packet for that component.`
    );
  }

  // Phase 38: Canonical approved faculty filter
  const approvedFaculty = facultyAlignment.filter(f => f.status === "STUDENT_APPROVED");
  const hasApprovedFaculty = approvedFaculty.length > 0;
  const facultyNames = hasApprovedFaculty
    ? approvedFaculty.map(f => f.facultyName).join(", ")
    : "None";

  const rcDesc = responseComponents.map(rc => {
    const topics = rc.requiredTopics.map(t => t.topic).join("; ");
    const constraint = rc.pageLimit.maxPages
      ? `Maximum physical pages: ${rc.pageLimit.maxPages}. Do NOT guess a word equivalent for this limit.`
      : "No page limit specified.";
    const wordConstraint = rc.wordLimit?.max
      ? `\nMaximum words: ${rc.wordLimit.max}`
      : "";
    const charConstraint = rc.characterLimit?.max
      ? `\nMaximum characters: ${rc.characterLimit.max}`
      : "";
    return `RESPONSE COMPONENT ${rc.componentId} (label: ${rc.label}):
Official prompt: "${rc.exactPrompt}"
Required topics: ${topics}
${constraint}${wordConstraint}${charConstraint}`;
  }).join("\n\n---\n\n");

  const evidenceSection = (evidencePackets!).map(pkt => {
    const entries = pkt.allEntries.map(e =>
      `  ${e.id}: ${e.canonicalText} [category: ${e.category}]`
    ).join("\n");
    return `EVIDENCE PACKET FOR ${pkt.componentId}:
Authorized evidence IDs (the COMPLETE factual world for this response):
${entries || "  (no evidence authorized)"}`;
  }).join("\n\n---\n\n");

  const closedWorldRules = `
CLOSED-WORLD EVIDENCE CONSTRAINT (Phase 14 + 38):
- The evidence packet supplied below for each component is the COMPLETE factual world available for that response.
- Do NOT add a factual proposition that cannot be directly supported by the evidence packet for that component.
- If a detail is absent from the evidence packet, OMIT it. Do not infer, guess, or fabricate.
- Explicitly PROHIBITED inventions (even if plausible):
  - software/tools not in the evidence
  - methods not in the evidence
  - quantified results not in the evidence
  - grades not in the evidence
  - dates not in the evidence
  - durations not in the evidence
  - awards not in the evidence
  - research activities not in the evidence
  - employment activities not in the evidence
  - project activities not in the evidence
  - faculty relationships not in the evidence
  - lab participation not in the evidence
  - communication with faculty not in the evidence
  - future guarantees not in the evidence
- You MAY use narrative language to interpret supported facts (e.g., "This experience strengthened my interest in...") ONLY when both the experience AND the stated interest are supported by the evidence.
- Interpretation is allowed. Inventing new factual events is NOT allowed.
- Each component's evidence is INDEPENDENT. Do not use evidence from Component A in Component B unless it appears in both packets.

THE WRITING PLAN IS STRUCTURAL GUIDANCE ONLY — NOT EVIDENCE (Phase 38):
- A factual statement appearing in the Planner output is NOT authorized unless the same fact is supported by the component's authorized evidence packet.
- The Writer's factual world consists ONLY of the authorized evidence provided for that response component.
- If the Planner says "The student led a five-person team" but the evidence packet contains no such fact, you MUST NOT use it.
- Planning notes guide narrative structure only. They do not authorize factual claims.

CLAIM TYPE TAXONOMY (Phase 19):
Each factualClaim MUST include a claimType field. Choose the most appropriate type:
- DIRECT_FACT: A factual claim directly stated in the evidence (e.g., "I used MATLAB and SAP2000")
- CONSERVATIVE_PARAPHRASE: A rephrasing of an evidence fact without adding new specificity (e.g., "planned my analysis work ahead of time" for "organized my analysis work in advance")
- INTERPRETIVE_LINK: A narrative connection between TWO approved facts (e.g., "This experience strengthened my interest in X" — requires BOTH the experience fact AND the interest fact)
- STATED_MOTIVATION: Asserts the student's purpose, motivation, or intent (e.g., "I undertook this project to understand...")
- STATED_GOAL: Asserts the student's goal or objective (e.g., "My goal was to...")
- PROGRAM_FACT: A fact about the program/university (e.g., "MIT offers...")
- FACULTY_FACT: A fact about approved faculty (e.g., "Professor X researches...")

MOTIVATION AND INTENT RULES (Phase 19):
- STATED_MOTIVATION and STATED_GOAL require explicit approved student evidence supporting that motivation.
- Project activity evidence alone CANNOT authorize why the student undertook the project.
- If no motivation evidence exists, OMIT the motivational claim entirely.
- Do NOT infer the student's original historical purpose from a later interest.
- Phrases requiring motivation evidence: "I undertook...", "I chose...", "I decided to...", "I wanted to...", "My goal was...", "I hoped to...", "I sought to...", "This motivated me to..."

CONSERVATIVE PARAPHRASE RULES (Phase 19):
- A CONSERVATIVE_PARAPHRASE may rephrase wording but MUST NOT add:
  - frequency (e.g., "every", "each", "weekly", "regularly")
  - time (e.g., specific dates, semesters, "during my second year")
  - location (e.g., "in the lab", "during each lab session")
  - named setting (e.g., "workshop", "classroom", "field site")
  - sequence, quantity, tool, method, causality, purpose, relationship, result
- If the source says "organized my analysis work in advance", you may write "planned my analysis work ahead of time" but NOT "organized my analysis tasks before each lab session" (adds frequency "each" and location "lab session").

INTERPRETIVE LINK RULES (Phase 19):
- An INTERPRETIVE_LINK may connect two approved facts (e.g., experience + interest).
- It MUST reference BOTH evidence IDs in its evidenceIds array.
- It must NOT assert a new historical intention not in the evidence.

CLAIM CONTRACT (Phase 38):
- claimIds must be unique within the entire generation (across all components)
- evidenceIds in each claim MUST exist in the authorized evidence packet for that component
- No evidence ID outside the component's allowance may be referenced
- No fabricated evidence IDs
- No unsupported factual claim
- Stylistic or general statements should NOT be falsely marked as factual claims
`;

  const system = `You are an expert application writer. You must write SEPARATE responses for EACH response component defined below.

CRITICAL RULES:
- Use ONLY the facts provided in the evidence packets. Never invent universities, courses, countries, grades, CGPA, percentages, dates, employers, projects, technologies, research, publications, certifications, awards, or personal history.
- If information is missing, write around it naturally without naming or hinting at it.
- Do NOT merge response components into one essay. Each prompt receives its own dedicated response.
- Do NOT use markdown, headings, bold text, bullet points, numbered lists, or the document title inside responses.
- Do NOT include "Here is your response" or commentary.
- Page constraints are physical rendering constraints — do NOT convert pages to word counts.
- Word and character constraints are exact — do NOT exceed them.
${hasApprovedFaculty ? `- Approved faculty: ${facultyNames}. Reference them only as approved. Do NOT claim contact, supervision, or lab placement.` : "- No approved faculty for this application."}
${closedWorldRules}
${writingInstructions}

Return ONLY valid JSON:
{
  "responses": [
    {
      "componentId": "<id>",
      "title": "<label>",
      "text": "<the response text>",
      "usedEvidenceIds": ["<evidence id>", ...],
      "factualClaims": [
        {
          "claimId": "CLAIM-<componentId>-<NNN>",
          "claim": "<the factual assertion in the text>",
          "claimType": "DIRECT_FACT|CONSERVATIVE_PARAPHRASE|INTERPRETIVE_LINK|STATED_MOTIVATION|STATED_GOAL|PROGRAM_FACT|FACULTY_FACT",
          "evidenceIds": ["<evidence id>", ...],
          "supportMode": "DIRECT|PARAPHRASE|INTERPRETIVE_LINK"
        }
      ]
    }
  ]
}

Each factualClaim MUST have:
- A stable claimId in the format CLAIM-<componentId>-<NNN> (e.g., CLAIM-RC-A-001, CLAIM-RC-A-002)
- A claimType from the taxonomy above
- A supportMode indicating how the claim relates to its evidence
- evidenceIds that exist in the authorized evidence packet for that component
usedEvidenceIds and factualClaims are INTERNAL metadata for auditing. They do not make a claim true. They help trace which evidence supports each assertion.`;

  const userPrompt = `Write the application document based on this plan and the per-component evidence packets.

WRITING PLAN (structural guidance only — NOT evidence):
${JSON.stringify(plan, null, 2)}

${rcDesc}

${evidenceSection}

Write all ${responseComponents.length} response component(s) now. For each response, include usedEvidenceIds (all evidence IDs you used) and factualClaims (each factual assertion mapped to its supporting evidence IDs, claimType, and supportMode). Return ONLY the JSON.`;

  return { system: withSafetyBlock(system), user: userPrompt };
}
