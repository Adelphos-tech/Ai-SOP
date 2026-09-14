/**
 * @file finalizer.ts
 * @description
 * Generic Finalizer prompt builder with render-aware compression.
 *
 * When render feedback indicates page overflow, the Finalizer receives
 * physical page information and compression instructions.
 *
 * NO fake word limits are generated from page counts.
 * NO render profile changes are requested.
 * Compression operates on CONTENT ONLY.
 *
 * Phase 19: Finalizer must return claim provenance metadata.
 * Finalizer may DELETE unsafe Writer claims but may NOT replace them
 * with new unsupported claims.
 */

import { ResponseComponent, FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import { RenderFeedback, FinalizerFactReferences } from "@/lib/render/render-lifecycle-types";

export function buildGenericFinalizerPrompt(
  studentFactsText: string,
  plan: any,
  calibratedOutput: any,
  qualityReview: any,
  responseComponents: ResponseComponent[],
  facultyAlignment: FacultyAlignment[],
  renderFeedback?: RenderFeedback | null,
  factReferences?: FinalizerFactReferences | null
): { system: string; user: string } {
  const rcDesc = responseComponents.map(rc => {
    const topics = rc.requiredTopics.map(t => t.topic).join("; ");
    return `RESPONSE COMPONENT ${rc.componentId} (label: ${rc.label}):
Official prompt: "${rc.exactPrompt}"
Required topics: ${topics}`;
  }).join("\n\n---\n\n");

  let renderSection = "";
  if (renderFeedback && renderFeedback.components.length > 0) {
    const overflowComponents = renderFeedback.components.filter(c => c.status === "RENDER_OVERFLOW");
    const passComponents = renderFeedback.components.filter(c => c.status === "PASS");
    const naComponents = renderFeedback.components.filter(c => c.status === "NOT_APPLICABLE");

    if (overflowComponents.length > 0) {
      const overflowDesc = overflowComponents.map(c =>
        `Component ${c.componentId}: Currently renders to ${c.actualPages} physical page(s) under profile ${c.renderProfileId}. Allowed: ${c.maxPages} page(s). Status: OVERFLOW.`
      ).join("\n");

      const passDesc = passComponents.length > 0
        ? passComponents.map(c => `Component ${c.componentId}: ${c.actualPages}/${c.maxPages} pages — PASS. Do NOT shorten.`).join("\n")
        : "";

      const naDesc = naComponents.length > 0
        ? naComponents.map(c => `Component ${c.componentId}: No page constraint — NOT_APPLICABLE.`).join("\n")
        : "";

      renderSection = `

RENDER FEEDBACK (physical page validation):
${overflowDesc}
${passDesc}
${naDesc}

The responses above that are marked OVERFLOW must be made substantially more concise to fit within their page limits under the selected rendering profile. Responses marked PASS or NOT_APPLICABLE should NOT be shortened merely because another component overflows.

COMPRESSION PRIORITY (for overflowing components only):
1. Remove repetition
2. Remove generic statements
3. Compress resume-in-prose descriptions
4. Remove redundant transitions
5. Combine overlapping sentences
6. Prefer strongest evidence over listing all evidence
7. Shorten background details not required by official prompt
8. Tighten program-fit language using only verified context

You may NOT:
- Request smaller font, smaller margins, reduced line spacing, or different page size
- Change the rendering profile
- Invent a word limit from the page count
- Shorten components that are already PASS or NOT_APPLICABLE

You MUST preserve:
- Official prompt answer for each component
- All required topics
- Material student facts
- Approved faculty alignment where required
- Career/research goals where required
- Document/response structure and component IDs`;
    } else {
      renderSection = `

RENDER FEEDBACK (physical page validation):
All response components are within their page limits. No compression needed for page compliance.`;
    }
  }

  let factRefSection = "";
  if (factReferences) {
    const refs: string[] = [];
    if (factReferences.studentFactIds.length > 0)
      refs.push(`Student fact IDs: ${factReferences.studentFactIds.join(", ")}`);
    if (factReferences.programSourceIds.length > 0)
      refs.push(`Program source IDs: ${factReferences.programSourceIds.join(", ")}`);
    if (factReferences.facultySourceIds.length > 0)
      refs.push(`Faculty source IDs: ${factReferences.facultySourceIds.join(", ")}`);
    if (factReferences.applicationSpecificFactIds.length > 0)
      refs.push(`Application-specific fact IDs: ${factReferences.applicationSpecificFactIds.join(", ")}`);
    if (refs.length > 0) {
      factRefSection = `

FACT BOUNDARIES:
Compression must operate only on supported information. The following fact references define the factual boundaries:
${refs.join("\n")}`;
    }
  }

  const system = `You are a finalizer for an application document. Finalize EACH response component to its best possible form.

${rcDesc}
${facultyAlignment.length > 0 ? "Faculty references may only reflect student-approved alignments." : ""}

FINALIZE by:
- Fixing repetition and generic language
- Improving clarity and flow
- Correcting unsupported interpretation noted by the quality reviewer
- Ensuring required topic coverage
${renderFeedback && renderFeedback.components.some(c => c.status === "RENDER_OVERFLOW") ? "- Compressing overflowing components to fit physical page limits (content only, no format changes)" : ""}

PHASE 19 — UNSAFE CLAIM DELETION:
- If the Quality Reviewer flagged a claim as SEMANTIC_EXPANSION or POTENTIALLY_UNSUPPORTED, you MAY DELETE that claim.
- You may NOT replace a deleted unsafe claim with a new unsupported motivation, specificity, or event.
- If deleting a claim would remove a required topic, report it in the removedClaimIds — the Action Planner will handle the gap.
- Deleting unsafe claims is preferred over keeping them.

DO NOT:
- Add new factual information not present in the verified evidence supplied
- Introduce any factual assertion absent from student facts, program facts, faculty facts, or application-specific facts
- Merge response components
- Add titles or markdown
- Invent a shorter substitute fact
- Change dates, grades, durations, employers, project outcomes, or software/tools
- Create new faculty claims or research activities
${renderFeedback && renderFeedback.components.some(c => c.status === "RENDER_OVERFLOW") ? "- Request or perform any typography, margin, spacing, or page size changes" : ""}

PHASE 19 — CLAIM PROVENANCE METADATA (MANDATORY):
You MUST return claim provenance metadata for each component:
- retainedClaimIds: the claim IDs from the pre-final (calibrated) text that you kept (may be rephrased)
- removedClaimIds: the claim IDs from the pre-final (calibrated) text that you removed (including unsafe claims deleted per quality review)
- repairClaims: new claims added ONLY for authorized repairs (empty for FREEZE and COMPRESS)
- For FREEZE: retainedClaimIds must equal all pre-final claim IDs, removedClaimIds must be empty, repairClaims must be empty
- For COMPRESS: retainedClaimIds must be a subset of pre-final claim IDs, repairClaims must be empty
- For TARGETED_COMPLIANCE_REPAIR / COMPRESS_AND_REPAIR: repairClaims allowed only for missing mandatory topics with authorized evidence

Return ONLY valid JSON:
{
  "responses": [
    {
      "componentId": "<id>",
      "text": "<final text>",
      "retainedClaimIds": ["<claimId>", ...],
      "removedClaimIds": ["<claimId>", ...],
      "repairClaims": [
        {
          "claimId": "CLAIM-<componentId>-<NNN>",
          "claim": "<the new claim text>",
          "evidenceIds": ["<evidence id>", ...],
          "topicId": "<topic being repaired>"
        }
      ],
      "repairReferences": []
    }
  ]
}`;

  const user = `STUDENT FACTS:
${studentFactsText}

ORIGINAL PLAN:
${JSON.stringify(plan, null, 2)}

CALIBRATED OUTPUT (pre-final text with claim IDs):
${JSON.stringify(calibratedOutput, null, 2)}

QUALITY REVIEW (includes factualRiskClaims with SEMANTIC_EXPANSION flags):
${JSON.stringify(qualityReview, null, 2)}
${renderSection}${factRefSection}

Finalize all response components. For each component, you MUST include retainedClaimIds, removedClaimIds, and repairClaims. If the Quality Reviewer flagged claims as SEMANTIC_EXPANSION or POTENTIALLY_UNSUPPORTED, delete those claims (add their IDs to removedClaimIds) rather than keeping unsupported assertions. Return ONLY the JSON.`;

  return { system, user };
}
