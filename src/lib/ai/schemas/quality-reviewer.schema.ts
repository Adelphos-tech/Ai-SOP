// ============================================================
// QUALITY REVIEWER — canonical structural schema (quality-reviewer-v2)
// ============================================================
// Compact contract: factualRiskClaims contains only non-SUPPORTED
// claims; SUPPORTED claims are reported as IDs in verifiedClaimIds.
// Advisory prose fields (feedback, overall_feedback, majorIssues,
// recommendedEdits) are optional — never consumed downstream.
// ============================================================

import { z } from "zod";
import { componentArray, componentId, looseObject, nonEmptyText } from "./common";

export const CLAIM_RISK_STATUSES = ["SUPPORTED", "POTENTIALLY_UNSUPPORTED", "SEMANTIC_EXPANSION", "AMBIGUOUS"] as const;
export const EVIDENCE_SUITABILITIES = ["SUITABLE", "INSUFFICIENT", "AMBIGUOUS"] as const;
export const COMPLIANCE_STATUSES = ["PASS", "FAIL", "N/A"] as const;
export const PAGE_COMPLIANCE_STATUSES = ["RENDER_VALIDATION_REQUIRED", "N/A"] as const;

// Inner topicCoverage/candidateEvidence fields were never structurally
// enforced by the legacy validator — keep them optional-but-typed so a
// partial entry doesn't introduce a NEW fatal path. The action planner
// tolerates missing values.
export const CandidateEvidenceSchema = looseObject({
  evidenceId: z.string().optional(),
  suitability: z.enum(EVIDENCE_SUITABILITIES).optional(),
  supportedContext: z.string().optional(),
  reason: z.string().optional(),
  requiredContext: z.string().optional(),
});

export const TopicCoverageSchema = looseObject({
  topic: z.string().optional(),
  covered: z.boolean().optional(),
  candidateEvidence: z.array(CandidateEvidenceSchema).optional(),
});

export const FactualRiskClaimSchema = looseObject({
  claimId: z.string(),
  claim: z.string(),
  status: z.enum(CLAIM_RISK_STATUSES),
  supportingEvidenceIds: z.array(z.string()),
  reason: z.string(),
  // Optional diagnostic flags.
  claimType: z.string().optional(),
  unsupportedMotivation: z.boolean().optional(),
  novelSpecificity: z.boolean().optional(),
  contextShift: z.boolean().optional(),
});

export const QualityComponentScoreSchema = looseObject({
  componentId,
  score: z.number().min(1).max(10),
  feedback: z.string().optional(),
  topicCoverage: z.array(TopicCoverageSchema),
  factualRiskClaims: z.array(FactualRiskClaimSchema),
  verifiedClaimIds: z.array(z.string()).optional(),
  wordCompliance: z.enum(COMPLIANCE_STATUSES),
  characterCompliance: z.enum(COMPLIANCE_STATUSES),
  pageCompliance: z.enum(PAGE_COMPLIANCE_STATUSES).optional(),
});

export const RequirementComplianceSchema = looseObject({
  documentStructure: z.enum(COMPLIANCE_STATUSES).optional(),
  responseComponentCount: z.enum(COMPLIANCE_STATUSES).optional(),
  componentPromptCoverage: z.enum(COMPLIANCE_STATUSES).optional(),
  requiredTopics: z.enum(COMPLIANCE_STATUSES).optional(),
  facultyRequirement: z.enum(COMPLIANCE_STATUSES).optional(),
  pageLimit: z.enum(PAGE_COMPLIANCE_STATUSES).optional(),
  wordLimit: z.enum(COMPLIANCE_STATUSES).optional(),
  characterLimit: z.enum(COMPLIANCE_STATUSES).optional(),
});

export const QualityReviewerOutputSchema = looseObject({
  componentScores: componentArray(QualityComponentScoreSchema),
  overall_score: z.number(),
  requirementCompliance: RequirementComplianceSchema,
  // Optional advisory — never consumed downstream.
  overall_feedback: z.string().optional(),
  majorIssues: z.array(z.unknown()).optional(),
  recommendedEdits: z.array(z.unknown()).optional(),
});

export type QualityReviewerOutputZ = z.infer<typeof QualityReviewerOutputSchema>;
