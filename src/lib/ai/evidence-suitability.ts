/**
 * @file evidence-suitability.ts
 * @description
 * Phase 16B: Evidence Suitability Model.
 *
 * Distinguishes:
 *   EVIDENCE EXISTS (authorized ID in ledger)
 * from
 *   EVIDENCE ACTUALLY SUPPORTS THIS REQUIRED TOPIC IN THIS CONTEXT
 *
 * A repair is only permitted when at least one candidate evidence item
 * is SUITABLE — not merely authorized.
 *
 * This is DETERMINISTIC validation based on the Quality Reviewer's
 * structured suitability output. No AI calls.
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type EvidenceSuitability = "SUITABLE" | "INSUFFICIENT" | "AMBIGUOUS";

export interface CandidateEvidence {
  evidenceId: string;
  suitability: EvidenceSuitability;
  reason: string;
  supportedContext: string;
  requiredContext: string;
}

export interface TopicCoverageWithSuitability {
  topic: string;
  covered: boolean;
  candidateEvidence: CandidateEvidence[];
}

export interface SuitabilityResult {
  suitableEvidenceIds: string[];
  insufficientEvidenceIds: string[];
  ambiguousEvidenceIds: string[];
  hasSuitableEvidence: boolean;
}

/* ------------------------------------------------------------------ */
/* Extract suitability from Quality Reviewer output                  */
/* ------------------------------------------------------------------ */

export function extractSuitability(topicCoverage: TopicCoverageWithSuitability): SuitabilityResult {
  const suitableEvidenceIds: string[] = [];
  const insufficientEvidenceIds: string[] = [];
  const ambiguousEvidenceIds: string[] = [];

  for (const candidate of topicCoverage.candidateEvidence || []) {
    if (candidate.suitability === "SUITABLE") {
      suitableEvidenceIds.push(candidate.evidenceId);
    } else if (candidate.suitability === "INSUFFICIENT") {
      insufficientEvidenceIds.push(candidate.evidenceId);
    } else if (candidate.suitability === "AMBIGUOUS") {
      ambiguousEvidenceIds.push(candidate.evidenceId);
    }
  }

  return {
    suitableEvidenceIds,
    insufficientEvidenceIds,
    ambiguousEvidenceIds,
    hasSuitableEvidence: suitableEvidenceIds.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Check if a mandatory missing topic has suitable evidence          */
/* ------------------------------------------------------------------ */

export function checkMandatoryTopicSuitability(args: {
  topicCoverage: TopicCoverageWithSuitability;
  mandatory: boolean;
}): { canRepair: boolean; authorizedRepairEvidenceIds: string[]; blockingReason?: string } {
  // If topic is already covered, no repair needed
  if (args.topicCoverage.covered) {
    return { canRepair: false, authorizedRepairEvidenceIds: [] };
  }

  // If topic is optional, no repair needed (IGNORE)
  if (!args.mandatory) {
    return { canRepair: false, authorizedRepairEvidenceIds: [] };
  }

  // Mandatory missing topic — check suitability
  const suitability = extractSuitability(args.topicCoverage);

  if (suitability.hasSuitableEvidence) {
    return {
      canRepair: true,
      authorizedRepairEvidenceIds: suitability.suitableEvidenceIds,
    };
  }

  // No suitable evidence — BLOCK
  return {
    canRepair: false,
    authorizedRepairEvidenceIds: [],
    blockingReason: `MISSING_REQUIRED_STUDENT_INFORMATION: Mandatory topic "${args.topicCoverage.topic}" has no SUITABLE evidence. Authorized but INSUFFICIENT/AMBIGUOUS evidence cannot be used for repair.`,
  };
}

/* ------------------------------------------------------------------ */
/* Build authorized repair evidence map from Quality Review          */
/* ------------------------------------------------------------------ */

export function buildAuthorizedRepairEvidence(args: {
  componentScores: Array<{
    componentId: string;
    topicCoverage: TopicCoverageWithSuitability[];
  }>;
  requiredTopics: Array<{
    componentId: string;
    topics: Array<{ topicId: string; text: string; mandatory: boolean }>;
  }>;
}): {
  authorizedRepairEvidence: Array<{
    componentId: string;
    topic: string;
    allowedEvidenceIds: string[];
  }>;
  blockingTopics: Array<{
    componentId: string;
    topic: string;
    reason: string;
  }>;
} {
  const authorizedRepairEvidence: Array<{ componentId: string; topic: string; allowedEvidenceIds: string[] }> = [];
  const blockingTopics: Array<{ componentId: string; topic: string; reason: string }> = [];

  for (const cs of args.componentScores) {
    const componentTopics = args.requiredTopics.find(rt => rt.componentId === cs.componentId);
    if (!componentTopics) continue;

    for (const tc of cs.topicCoverage) {
      if (tc.covered) continue;

      const topicDef = componentTopics.topics.find(t => t.topicId === tc.topic || t.text === tc.topic);
      if (!topicDef) continue;

      const check = checkMandatoryTopicSuitability({
        topicCoverage: tc,
        mandatory: topicDef.mandatory,
      });

      if (check.canRepair) {
        authorizedRepairEvidence.push({
          componentId: cs.componentId,
          topic: tc.topic,
          allowedEvidenceIds: check.authorizedRepairEvidenceIds,
        });
      } else if (check.blockingReason) {
        blockingTopics.push({
          componentId: cs.componentId,
          topic: tc.topic,
          reason: check.blockingReason,
        });
      }
      // Optional topics with no suitable evidence: IGNORE (no blocking, no repair)
    }
  }

  return { authorizedRepairEvidence, blockingTopics };
}

/* ------------------------------------------------------------------ */
/* Context scope for repair claims                                    */
/* ------------------------------------------------------------------ */

export interface RepairClaimContext {
  claimId: string;
  evidenceIds: string[];
  topicId: string;
  contextScope: string;
}

export function buildRepairClaimContext(args: {
  claimId: string;
  evidenceIds: string[];
  topicId: string;
  candidateEvidence: CandidateEvidence[];
}): RepairClaimContext {
  // Find the SUITABLE candidate(s) for this topic
  const suitable = args.candidateEvidence.filter(ce =>
    args.evidenceIds.includes(ce.evidenceId) && ce.suitability === "SUITABLE"
  );

  // Context scope derives from the supported context of the suitable evidence
  const contextScope = suitable.map(s => s.supportedContext).join("; ") || "";

  return {
    claimId: args.claimId,
    evidenceIds: args.evidenceIds,
    topicId: args.topicId,
    contextScope,
  };
}

/* ------------------------------------------------------------------ */
/* Context preservation validation                                   */
/* ------------------------------------------------------------------ */

export function validateRepairContext(args: {
  repairClaimText: string;
  candidateEvidence: CandidateEvidence[];
  usedEvidenceIds: string[];
}): { valid: boolean; violation?: string; reason?: string } {
  // For each used evidence ID, check if it was classified as SUITABLE
  for (const eid of args.usedEvidenceIds) {
    const candidate = args.candidateEvidence.find(ce => ce.evidenceId === eid);
    if (!candidate) {
      return {
        valid: false,
        violation: "FINALIZER_EVIDENCE_CONTEXT_VIOLATION",
        reason: `Repair claim uses evidence ID "${eid}" not in candidate evidence for this topic.`,
      };
    }
    if (candidate.suitability !== "SUITABLE") {
      return {
        valid: false,
        violation: "FINALIZER_EVIDENCE_CONTEXT_VIOLATION",
        reason: `Repair claim uses evidence ID "${eid}" which was classified as ${candidate.suitability}, not SUITABLE.`,
      };
    }
  }

  return { valid: true };
}
