import type { ResponseComponent, FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import type { EvidenceLedger } from "../../evidence-ledger";
import type { ComponentEvidencePacket } from "../../component-evidence-packet";
import { withSafetyBlock } from "../prompt-safety-block";
import { formatComponentRequirements } from "./component-requirements";
import { resolveLengthContext, describeLengthContext, wordsOf } from "../../length-context";

/**
 * Phase 38 changes:
 * - Removed phantom field "allowedEvidenceIds" (does not exist in schema)
 * - All prompt-mentioned fields verified against actual response schema
 * - Faculty approval filter uses approvedFaculty (STUDENT_APPROVED only)
 * - Word/character/page constraints passed explicitly
 * - Prompt-injection safety block injected
 * - Quality Reviewer must NOT rewrite the document
 */
export function buildGenericQualityReviewerPrompt(
  writerOutput: any,
  responseComponents: ResponseComponent[],
  facultyAlignment: FacultyAlignment[],
  evidenceLedger?: EvidenceLedger,
  evidencePackets?: ComponentEvidencePacket[],
  qualityRubricInstructions?: string,
  /** Consultant instructions + formatting rules the Writer was given —
   *  QR must be able to evaluate compliance with them. */
  complianceInstructions?: string
): { system: string; user: string } {
  // Phase 38: Canonical approved faculty filter
  const approvedFaculty = facultyAlignment.filter(f => f.status === "STUDENT_APPROVED");
  const hasApprovedFaculty = approvedFaculty.length > 0;
  const facultyNames = hasApprovedFaculty
    ? approvedFaculty.map(f => f.facultyName).join(", ")
    : "None";

  // Deterministic word counts — QR receives the status, not arithmetic homework.
  const writerWords = new Map<string, number>(
    ((writerOutput?.responses || []) as Array<{ componentId: string; text?: string }>)
      .map(r => [r.componentId, wordsOf(r.text)])
  );
  const rcDesc = responseComponents.map(rc => {
    const topics = formatComponentRequirements(rc);
    const lenCtx = resolveLengthContext(rc.wordLimit);
    const current = writerWords.get(rc.componentId);
    const wordConstraint = lenCtx.minWords !== null || lenCtx.maxWords !== null
      ? `\nWORD COUNT REQUIREMENT:\n${describeLengthContext(lenCtx, current)}\n(The word count and status above are computed deterministically — report wordCompliance from this status, not your own count.)`
      : "";
    const charConstraint = rc.characterLimit?.max ? `\nCharacter limit: max ${rc.characterLimit.max}` : "";
    const pageConstraint = rc.pageLimit?.maxPages ? `\nPage limit: max ${rc.pageLimit.maxPages} physical pages (render-validated, not word count)` : "";
    return `RESPONSE COMPONENT ${rc.componentId} (label: ${rc.label}):
Official prompt: "${rc.exactPrompt}"
${topics}${wordConstraint}${charConstraint}${pageConstraint}`;
  }).join("\n\n---\n\n");

  const system = `You are a quality reviewer for an application document. Review EACH response component separately and the overall document.

${rcDesc}
${hasApprovedFaculty ? `Approved faculty: ${facultyNames}` : "No approved faculty for this application."}
${qualityRubricInstructions ? `\n${qualityRubricInstructions}` : ""}
${complianceInstructions ? `\nCONSULTANT/FORMATTING INSTRUCTIONS GIVEN TO THE WRITER (evaluate whether the draft complies):\n${complianceInstructions}` : ""}

Evaluate each component for:
- Official prompt coverage
- Required topic coverage
- Student specificity (not generic)
- Program relevance
- Faculty alignment quality (if applicable)
- Narrative coherence
- Professional tone
- Personal voice
- Generic language (penalize)
- Repetition (penalize)
- Resume-in-prose tendency (penalize)
- Language-profile consistency
- Factual discipline
- Word compliance (if word limit configured)
- Character compliance (if character limit configured)
- Page/render concerns (if page limit configured — render-validated, not word count)

PRE-FINAL FACTUAL RISK ASSESSMENT (Phase 14 + Phase 19):
For EACH component, audit each Writer factual claim against the evidence.
For each claim, classify as:
  SUPPORTED — directly traceable to an evidence entry
  POTENTIALLY_UNSUPPORTED — asserts a factual detail not clearly in the evidence
  SEMANTIC_EXPANSION — the claim adds novel specificity (frequency, location, quantity, tool, method, causality, purpose) not in the evidence, OR asserts unsupported motivation/intent
  AMBIGUOUS — cannot determine from the evidence alone

SPECIFIC CHECKS (Phase 19):
1. Unsupported motivation: If a claim asserts the student's purpose, motivation, or intent (e.g., "I undertook this project to understand..."), check that the evidence explicitly states that motivation. Project activity alone cannot authorize why the student undertook the project. Flag as SEMANTIC_EXPANSION.
2. Novel specificity: If a claim adds frequency ("every", "each", "weekly"), location ("in the lab", "during each lab session"), quantity (numbers), named tools, methods, or causal claims not in the evidence, flag as SEMANTIC_EXPANSION.
3. Context broadening/narrowing: If a claim broadens a project-specific fact to a general context, or narrows a general fact to a specific context not in the evidence, flag as SEMANTIC_EXPANSION.

This is an EARLY WARNING layer. It does NOT replace the stage-6 Final Fact Reviewer.
Be conservative: if a claim asserts specific software, dates, grades, methods, outcomes, or faculty relationships not clearly in the evidence, flag it as POTENTIALLY_UNSUPPORTED or SEMANTIC_EXPANSION.

DO NOT rewrite the document. You are a reviewer, not an editor. Return findings only.

Return exactly one componentScores entry per response component, with no missing, extra or duplicate components.
${!process.env.DISABLE_COMPACT_REVIEWS ? `
COMPACT OUTPUT RULES (mandatory — machine actions, not essays):
- factualRiskClaims must contain ONLY claims needing action: status POTENTIALLY_UNSUPPORTED, SEMANTIC_EXPANSION, or AMBIGUOUS. Do NOT emit SUPPORTED claims there — put their claimIds in verifiedClaimIds instead.
- verifiedClaimIds: claimIds you verified as SUPPORTED. Every Writer claimId must appear in exactly one of factualRiskClaims or verifiedClaimIds.
- reason fields: maximum 15 words each.
- supportingEvidenceIds: maximum 3 IDs.
- Do NOT return feedback, overall_feedback, majorIssues, or recommendedEdits fields.
- Do NOT restate the draft, evidence, rubric, or requirements.
- For SEMANTIC_EXPANSION claims set the applicable flags: unsupportedMotivation, novelSpecificity, contextShift.
` : ""}
For EVERY component return topicCoverage with exactly one entry for EACH exact required topic string listed for that component. No paraphrased, omitted, duplicate or extra topics. Use [] when that component has no required topics.
covered must be an explicit boolean based on that component's own text, independent of its score and the global compliance flag. Never use a different component's coverage.
For each covered:false topic, return candidateEvidence from the supplied Evidence Ledger that might support repairing THAT topic. For each candidate, classify suitability as:
  SUITABLE — the evidence establishes the factual proposition AND the context required by the official topic (e.g., the specific project, experience, or situation the topic asks about)
  INSUFFICIENT — the evidence exists but does not establish the proposition in the required context (e.g., a general background fact that cannot be tied to the specific project/experience the topic requires)
  AMBIGUOUS — cannot determine from the evidence alone whether the context matches
Do not select evidence by keyword overlap. If no SUITABLE evidence exists, or no ledger was supplied, return []. Do not invent IDs or facts. For covered:true return candidateEvidence: [].
These references propose topic-local provenance authorization; they do not certify semantic entailment. Independent stage-6 fact review remains mandatory.

Return ONLY valid JSON:
{
  "componentScores": [
    {
      "componentId": "<id>",
      "score": 1-10,
      "topicCoverage": [
        {
          "topic": "<exact required topic>",
          "covered": true,
          "candidateEvidence": [
            {
              "evidenceId": "<ledger id>",
              "suitability": "SUITABLE" | "INSUFFICIENT" | "AMBIGUOUS",
              "supportedContext": "<context the evidence establishes, <=10 words>"
            }
          ]
        }
      ],
      "factualRiskClaims": [
        {
          "claimId": "<claim id from writer — non-SUPPORTED only>",
          "claim": "<the factual assertion>",
          "status": "POTENTIALLY_UNSUPPORTED" | "SEMANTIC_EXPANSION" | "AMBIGUOUS",
          "supportingEvidenceIds": [],
          "reason": "<why, <=15 words>",
          "unsupportedMotivation": true/false,
          "novelSpecificity": true/false,
          "contextShift": true/false
        }
      ],
      "verifiedClaimIds": ["<claimId verified SUPPORTED>"],
      "wordCompliance": "PASS" | "FAIL" | "N/A",
      "characterCompliance": "PASS" | "FAIL" | "N/A",
      "pageCompliance": "RENDER_VALIDATION_REQUIRED" | "N/A"
    }
  ],
  "overall_score": 1-10,
  "requirementCompliance": {
    "documentStructure": "PASS/FAIL",
    "responseComponentCount": "PASS/FAIL",
    "componentPromptCoverage": "PASS/FAIL",
    "requiredTopics": "PASS/FAIL",
    "facultyRequirement": "PASS/FAIL/N/A",
    "pageLimit": "RENDER_VALIDATION_REQUIRED",
    "wordLimit": "PASS/FAIL/N/A",
    "characterLimit": "PASS/FAIL/N/A"
  }
}`;

  let evidenceSection: string;
  if (evidencePackets && evidencePackets.length > 0) {
    evidenceSection = evidencePackets.map(pkt => {
      const entries = pkt.allEntries.map(e =>
        `  ${e.id}: ${e.canonicalText} [category: ${e.category}]`
      ).join("\n");
      return `EVIDENCE PACKET FOR ${pkt.componentId}:\n${entries || "  (no evidence authorized)"}`;
    }).join("\n\n---\n\n");
  } else {
    evidenceSection = evidenceLedger
      ? JSON.stringify(evidenceLedger.allEntries, null, 2)
      : "Not supplied; return empty candidateEvidence arrays. Do not infer evidence from the draft.";
  }

  const user = `WRITER OUTPUT:
${JSON.stringify(writerOutput, null, 2)}

EVIDENCE (the only source of evidence for missing-topic repair and factual risk assessment):
${evidenceSection}

Review all components. For each component, include factualRiskClaims assessing whether factual assertions are SUPPORTED, POTENTIALLY_UNSUPPORTED, SEMANTIC_EXPANSION, or AMBIGUOUS relative to the evidence. For each SEMANTIC_EXPANSION claim, set unsupportedMotivation, novelSpecificity, or contextShift as appropriate. Return ONLY the JSON quality review.`;

  return { system: withSafetyBlock(system), user };
}
