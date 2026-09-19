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
/* Quality Reviewer Output Types                                      */
/* ------------------------------------------------------------------ */

export type ClaimRiskStatus = "SUPPORTED" | "POTENTIALLY_UNSUPPORTED" | "SEMANTIC_EXPANSION" | "AMBIGUOUS";
export type EvidenceSuitability = "SUITABLE" | "INSUFFICIENT" | "AMBIGUOUS";
export type ComplianceStatus = "PASS" | "FAIL" | "N/A";
export type FacultyComplianceStatus = "PASS" | "FAIL" | "N/A";
export type PageComplianceStatus = "RENDER_VALIDATION_REQUIRED" | "N/A";

export interface CandidateEvidence {
  evidenceId: string;
  suitability: EvidenceSuitability;
  /** reason/requiredContext are optional diagnostics — supportedContext
   * is consumed by the action planner's context scope. */
  reason?: string;
  supportedContext: string;
  requiredContext?: string;
}

export interface TopicCoverage {
  topic: string;
  covered: boolean;
  candidateEvidence: CandidateEvidence[];
}

export interface FactualRiskClaim {
  claimId: string;
  claim: string;
  claimType?: string;
  status: ClaimRiskStatus;
  supportingEvidenceIds: string[];
  reason: string;
  unsupportedMotivation?: boolean;
  novelSpecificity?: boolean;
  contextShift?: boolean;
}

export interface QualityComponentScore {
  componentId: string;
  score: number;
  /** Optional prose — never consumed downstream. */
  feedback?: string;
  topicCoverage: TopicCoverage[];
  /** Compact contract: only claims needing action (status !== SUPPORTED).
   * SUPPORTED claims are reported as IDs in verifiedClaimIds. */
  factualRiskClaims: FactualRiskClaim[];
  /** IDs of claims verified SUPPORTED — provenance without restating text. */
  verifiedClaimIds?: string[];
  wordCompliance: ComplianceStatus;
  characterCompliance: ComplianceStatus;
  pageCompliance: PageComplianceStatus;
}

export interface RequirementCompliance {
  documentStructure: ComplianceStatus;
  responseComponentCount: ComplianceStatus;
  componentPromptCoverage: ComplianceStatus;
  requiredTopics: ComplianceStatus;
  facultyRequirement: FacultyComplianceStatus;
  pageLimit: PageComplianceStatus;
  wordLimit: ComplianceStatus;
  characterLimit: ComplianceStatus;
}

export interface QualityReviewOutput {
  componentScores: QualityComponentScore[];
  overall_score: number;
  /** Optional prose — never consumed downstream. */
  overall_feedback?: string;
  requirementCompliance: RequirementCompliance;
  /** Optional advisory lists — never consumed downstream. */
  majorIssues?: string[];
  recommendedEdits?: string[];
}

/* ------------------------------------------------------------------ */
/* Final Fact Reviewer Output Types                                     */
/* ------------------------------------------------------------------ */

export type FactClassification =
  | "SUPPORTED_STUDENT_FACT"
  | "SUPPORTED_PROGRAM_FACT"
  | "SUPPORTED_FACULTY_FACT"
  | "INTERPRETIVE_ELABORATION"
  | "ALTERED_FACT"
  | "INVENTED_FACT"
  | "AMBIGUOUS";

export type FactSeverity = "INFO" | "WARNING" | "BLOCKING";

export interface FactClaim {
  claim: string;
  /** Optional alias — some model outputs use "text" instead of "claim" */
  text?: string;
  classification: FactClassification;
  supportingFactIds: string[];
  /** Unused downstream — optional (compact contract drops it). */
  supportingSourceIds?: string[];
  severity: FactSeverity;
}

export interface FactReviewComponent {
  componentId: string;
  pass: boolean;
  claims: FactClaim[];
  /** Derived server-side by deriveFactReviewTotals — model may omit. */
  inventedCount?: number;
  alteredCount?: number;
  elaborationCount?: number;
  ambiguousCount?: number;
}

export interface FactReviewOutput {
  components: FactReviewComponent[];
  /** Derived server-side by deriveFactReviewTotals — model may omit. */
  totalInventedFacts?: number;
  totalAlteredFacts?: number;
  totalInterpretiveElaborations?: number;
  totalAmbiguousClaims?: number;
  overallPass: boolean;
  blockingReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Runtime Validators                                                  */
/* ------------------------------------------------------------------ */

const VALID_RISK_STATUSES: ClaimRiskStatus[] = ["SUPPORTED", "POTENTIALLY_UNSUPPORTED", "SEMANTIC_EXPANSION", "AMBIGUOUS"];
const VALID_SUITABILITY: EvidenceSuitability[] = ["SUITABLE", "INSUFFICIENT", "AMBIGUOUS"];
const VALID_COMPLIANCE: ComplianceStatus[] = ["PASS", "FAIL", "N/A"];
const VALID_FACT_CLASSIFICATIONS: FactClassification[] = [
  "SUPPORTED_STUDENT_FACT", "SUPPORTED_PROGRAM_FACT", "SUPPORTED_FACULTY_FACT",
  "INTERPRETIVE_ELABORATION", "ALTERED_FACT", "INVENTED_FACT", "AMBIGUOUS",
];
const VALID_SEVERITY: FactSeverity[] = ["INFO", "WARNING", "BLOCKING"];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isString(v: unknown): v is string { return typeof v === "string"; }
function isNumber(v: unknown): v is number { return typeof v === "number" && !isNaN(v); }
function isBoolean(v: unknown): v is boolean { return typeof v === "boolean"; }
function isArray(v: unknown): v is unknown[] { return Array.isArray(v); }
function isStringArray(v: unknown): v is string[] { return isArray(v) && v.every(isString); }

/**
 * Validate Quality Reviewer output against the typed contract.
 */
export function validateQualityReviewOutput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const o = raw as Record<string, unknown>;

  if (!o || typeof o !== "object") { errors.push("Output is not an object"); return { valid: false, errors }; }

  if (!isArray(o.componentScores)) errors.push("componentScores must be an array");
  else {
    for (let i = 0; i < o.componentScores.length; i++) {
      const cs = o.componentScores[i] as Record<string, unknown>;
      if (!isString(cs?.componentId)) errors.push(`componentScores[${i}].componentId must be string`);
      if (!isNumber(cs?.score)) errors.push(`componentScores[${i}].score must be number`);
      // feedback is optional — never consumed downstream.
      if (cs?.feedback !== undefined && !isString(cs.feedback)) errors.push(`componentScores[${i}].feedback must be string`);
      if (!isArray(cs?.topicCoverage)) errors.push(`componentScores[${i}].topicCoverage must be array`);
      if (cs?.verifiedClaimIds !== undefined && !isStringArray(cs.verifiedClaimIds))
        errors.push(`componentScores[${i}].verifiedClaimIds must be string[]`);
      if (!isArray(cs?.factualRiskClaims)) errors.push(`componentScores[${i}].factualRiskClaims must be array`);
      else {
        for (let j = 0; j < (cs.factualRiskClaims as unknown[]).length; j++) {
          const fc = (cs.factualRiskClaims as Record<string, unknown>[])[j];
          if (!isString(fc?.claimId)) errors.push(`componentScores[${i}].factualRiskClaims[${j}].claimId must be string`);
          if (!isString(fc?.claim)) errors.push(`componentScores[${i}].factualRiskClaims[${j}].claim must be string`);
          if (!isString(fc?.status) || !VALID_RISK_STATUSES.includes(fc.status as ClaimRiskStatus))
            errors.push(`componentScores[${i}].factualRiskClaims[${j}].status must be one of ${VALID_RISK_STATUSES.join("|")}`);
          if (!isStringArray(fc?.supportingEvidenceIds)) errors.push(`componentScores[${i}].factualRiskClaims[${j}].supportingEvidenceIds must be string[]`);
          if (!isString(fc?.reason)) errors.push(`componentScores[${i}].factualRiskClaims[${j}].reason must be string`);
          // claimType + expansion booleans are optional diagnostic flags.
          if (fc?.claimType !== undefined && !isString(fc.claimType)) errors.push(`componentScores[${i}].factualRiskClaims[${j}].claimType must be string`);
          for (const flag of ["unsupportedMotivation", "novelSpecificity", "contextShift"] as const) {
            if (fc?.[flag] !== undefined && !isBoolean(fc[flag])) errors.push(`componentScores[${i}].factualRiskClaims[${j}].${flag} must be boolean`);
          }
        }
      }
      if (!isString(cs?.wordCompliance) || !VALID_COMPLIANCE.includes(cs.wordCompliance as ComplianceStatus))
        errors.push(`componentScores[${i}].wordCompliance must be one of ${VALID_COMPLIANCE.join("|")}`);
      if (!isString(cs?.characterCompliance) || !VALID_COMPLIANCE.includes(cs.characterCompliance as ComplianceStatus))
        errors.push(`componentScores[${i}].characterCompliance must be one of ${VALID_COMPLIANCE.join("|")}`);
    }
  }

  if (!isNumber(o.overall_score)) errors.push("overall_score must be number");
  // overall_feedback / majorIssues / recommendedEdits — optional advisory
  // fields never consumed downstream.
  if (o.overall_feedback !== undefined && !isString(o.overall_feedback)) errors.push("overall_feedback must be string");
  if (!o.requirementCompliance || typeof o.requirementCompliance !== "object") errors.push("requirementCompliance must be object");
  if (o.majorIssues !== undefined && !isArray(o.majorIssues)) errors.push("majorIssues must be array");
  if (o.recommendedEdits !== undefined && !isArray(o.recommendedEdits)) errors.push("recommendedEdits must be array");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Final Fact Reviewer output against the typed contract.
 */
export function validateFactReviewOutput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const o = raw as Record<string, unknown>;

  if (!o || typeof o !== "object") { errors.push("Output is not an object"); return { valid: false, errors }; }

  if (!isArray(o.components)) errors.push("components must be an array");
  else {
    for (let i = 0; i < o.components.length; i++) {
      const comp = o.components[i] as Record<string, unknown>;
      if (!isString(comp?.componentId)) errors.push(`components[${i}].componentId must be string`);
      if (!isBoolean(comp?.pass)) errors.push(`components[${i}].pass must be boolean`);
      // Per-component counts are derived server-side — model may omit.
      for (const cnt of ["inventedCount", "alteredCount", "elaborationCount", "ambiguousCount"] as const) {
        if (comp?.[cnt] !== undefined && !isNumber(comp[cnt])) errors.push(`components[${i}].${cnt} must be number`);
      }
      if (!isArray(comp?.claims)) errors.push(`components[${i}].claims must be array`);
      else {
        for (let j = 0; j < (comp.claims as unknown[]).length; j++) {
          const cl = (comp.claims as Record<string, unknown>[])[j];
          // `claim` is canonical; `text` is a tolerated alias (normalized upstream).
          if (!isString(cl?.claim) && !isString(cl?.text)) errors.push(`components[${i}].claims[${j}].claim must be string`);
          if (!isString(cl?.classification) || !VALID_FACT_CLASSIFICATIONS.includes(cl.classification as FactClassification))
            errors.push(`components[${i}].claims[${j}].classification must be one of ${VALID_FACT_CLASSIFICATIONS.join("|")}`);
          if (!isStringArray(cl?.supportingFactIds)) errors.push(`components[${i}].claims[${j}].supportingFactIds must be string[]`);
          // supportingSourceIds is unused downstream — optional.
          if (cl?.supportingSourceIds !== undefined && !isStringArray(cl.supportingSourceIds))
            errors.push(`components[${i}].claims[${j}].supportingSourceIds must be string[]`);
          if (!isString(cl?.severity) || !VALID_SEVERITY.includes(cl.severity as FactSeverity))
            errors.push(`components[${i}].claims[${j}].severity must be one of ${VALID_SEVERITY.join("|")}`);
        }
      }
    }
  }

  // Totals are derived server-side — model-reported values optional.
  for (const t of ["totalInventedFacts", "totalAlteredFacts", "totalInterpretiveElaborations", "totalAmbiguousClaims"] as const) {
    if (o[t] !== undefined && !isNumber(o[t])) errors.push(`${t} must be number`);
  }
  if (!isBoolean(o.overallPass)) errors.push("overallPass must be boolean");
  // blockingReason may be omitted (undefined) or null — both mean "none".
  if (o.blockingReason !== null && o.blockingReason !== undefined && !isString(o.blockingReason)) errors.push("blockingReason must be string or null");

  return { valid: errors.length === 0, errors };
}

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
