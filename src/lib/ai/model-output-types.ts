/**
 * @file model-output-types.ts
 * @description
 * Phase 38A: Explicit TypeScript types and runtime validators for
 * Quality Reviewer and Final Fact Reviewer structured outputs.
 *
 * Replaces `any` with typed contracts. Runtime validators verify
 * required fields and enum values.
 *
 * Prompt schema = TypeScript type = runtime validator
 */

/* ------------------------------------------------------------------ */
/* Stage Output Types — inferred from the Zod schemas                 */
/* ------------------------------------------------------------------ */
/* Types are derived from src/lib/ai/schemas/ — required/optional/
   nullability is declared ONCE in the schema, not duplicated here. */

import type { z } from "zod";
import {
  CLAIM_RISK_STATUSES, EVIDENCE_SUITABILITIES, COMPLIANCE_STATUSES, PAGE_COMPLIANCE_STATUSES,
  CandidateEvidenceSchema, TopicCoverageSchema, FactualRiskClaimSchema,
  QualityComponentScoreSchema, RequirementComplianceSchema, QualityReviewerOutputSchema,
} from "./schemas/quality-reviewer.schema";
import {
  FACT_CLASSIFICATIONS, FACT_SEVERITIES,
  FactClaimSchema, FactReviewComponentSchema, FactReviewerOutputSchema,
} from "./schemas/fact-reviewer.schema";

export type ClaimRiskStatus = (typeof CLAIM_RISK_STATUSES)[number];
export type EvidenceSuitability = (typeof EVIDENCE_SUITABILITIES)[number];
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];
export type FacultyComplianceStatus = ComplianceStatus;
export type PageComplianceStatus = (typeof PAGE_COMPLIANCE_STATUSES)[number];

export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;
export type TopicCoverage = z.infer<typeof TopicCoverageSchema>;
export type FactualRiskClaim = z.infer<typeof FactualRiskClaimSchema>;
export type QualityComponentScore = z.infer<typeof QualityComponentScoreSchema>;
export type RequirementCompliance = z.infer<typeof RequirementComplianceSchema>;
export type QualityReviewOutput = z.infer<typeof QualityReviewerOutputSchema>;

export type FactClassification = (typeof FACT_CLASSIFICATIONS)[number];
export type FactSeverity = (typeof FACT_SEVERITIES)[number];

export type FactClaim = z.infer<typeof FactClaimSchema>;
export type FactReviewComponent = z.infer<typeof FactReviewComponentSchema>;
export type FactReviewOutput = z.infer<typeof FactReviewerOutputSchema>;

/* ------------------------------------------------------------------ */
/* Runtime Validators                                                  */
/* ------------------------------------------------------------------ */
/* Structural validation delegates to the Zod schemas — the single
   source of truth in src/lib/ai/schemas/. */

import { normalizeStageOutput } from "./pipeline/stage-contracts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate Quality Reviewer output — delegates to the Zod structural
 * schema (single source of truth in src/lib/ai/schemas/).
 */
export function validateQualityReviewOutput(raw: unknown): ValidationResult {
  const result = QualityReviewerOutputSchema.safeParse(normalizeStageOutput("qualityReviewer", raw));
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * Validate Final Fact Reviewer output against the typed contract.
 */
export function validateFactReviewOutput(raw: unknown): ValidationResult {
  const result = FactReviewerOutputSchema.safeParse(normalizeStageOutput("factReviewer", raw));
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/* Legacy hand-rolled checks removed — Zod schema is authoritative.
   Kept below only deriveFactReviewTotals (deterministic server-side
   derivation — NOT model contract validation). */

/**
 * Phase 38A: Derive Final Fact Reviewer totals deterministically from components[].claims[].
 * Does NOT trust model-reported totals.
 */
export function deriveFactReviewTotals(raw: unknown): {
  totalInventedFacts: number;
  totalAlteredFacts: number;
  totalInterpretiveElaborations: number;
  totalAmbiguousClaims: number;
  hasBlockingAmbiguous: boolean;
  overallPass: boolean;
} {
  const o = raw as Record<string, unknown>;
  const components = (o?.components || []) as FactReviewComponent[];

  let totalInvented = 0;
  let totalAltered = 0;
  let totalElaborations = 0;
  let totalAmbiguous = 0;
  let hasBlockingAmbiguous = false;

  for (const comp of components) {
    let compInvented = 0;
    let compAltered = 0;
    let compElaborations = 0;
    let compAmbiguous = 0;

    for (const claim of comp.claims || []) {
      switch (claim.classification) {
        case "INVENTED_FACT": totalInvented++; compInvented++; break;
        case "ALTERED_FACT": totalAltered++; compAltered++; break;
        case "INTERPRETIVE_ELABORATION": totalElaborations++; compElaborations++; break;
        case "AMBIGUOUS":
          totalAmbiguous++; compAmbiguous++;
          if (claim.severity === "BLOCKING") hasBlockingAmbiguous = true;
          break;
      }
    }

    // Overwrite component counts with derived values
    comp.inventedCount = compInvented;
    comp.alteredCount = compAltered;
    comp.elaborationCount = compElaborations;
    comp.ambiguousCount = compAmbiguous;
  }

  const overallPass = totalInvented === 0 && totalAltered === 0 && !hasBlockingAmbiguous;

  return {
    totalInventedFacts: totalInvented,
    totalAlteredFacts: totalAltered,
    totalInterpretiveElaborations: totalElaborations,
    totalAmbiguousClaims: totalAmbiguous,
    hasBlockingAmbiguous,
    overallPass,
  };
}
