/**
 * @file fact-taxonomy.ts
 * @description
 * Strict fact classification taxonomy for application document review.
 *
 * An item cannot simultaneously be INVENTED_FACT and "not fabricated."
 */

export type FactClassification =
  | "SUPPORTED_STUDENT_FACT"
  | "SUPPORTED_PROGRAM_FACT"
  | "SUPPORTED_FACULTY_FACT"
  | "INTERPRETIVE_ELABORATION"
  | "ALTERED_FACT"
  | "INVENTED_FACT"
  | "AMBIGUOUS";

export interface FactClaim {
  claim: string;
  componentId: string;
  classification: FactClassification;
  supportingFactIds: string[];
  supportingSourceIds: string[];
  severity: "INFO" | "WARNING" | "BLOCKING";
}

export interface ComponentFactReview {
  componentId: string;
  pass: boolean;
  claims: FactClaim[];
  supportedStudentFacts: string[];
  supportedProgramFacts: string[];
  supportedFacultyFacts: string[];
  interpretiveElaborations: string[];
  alteredFacts: string[];
  inventedFacts: string[];
  ambiguousClaims: string[];
  inventedCount: number;
  alteredCount: number;
  elaborationCount: number;
}

export interface FinalFactReview {
  components: ComponentFactReview[];
  totalInventedFacts: number;
  totalAlteredFacts: number;
  totalAmbiguousClaims: number;
  totalInterpretiveElaborations: number;
  overallPass: boolean;
  blockingReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Taxonomy decision rules                                             */
/* ------------------------------------------------------------------ */

/**
 * Determine if a claim is an interpretive elaboration vs an invented fact.
 *
 * INTERPRETIVE_ELABORATION = narrative interpretation that does not introduce a new specific fact.
 * Example: "This experience strengthened my interest in structural engineering."
 *   when the underlying experience and stated interest are supported.
 *
 * INVENTED_FACT = a new specific factual assertion with no approved supporting source.
 * Examples: new software used, new award, new project result, new employer,
 *           new grade, new date, new research activity.
 */
export function isInventedFact(claim: {
  text: string;
  hasDirectEvidence: boolean;
  hasSpecificNewValue: boolean;
  hasSpecificNewEntity: boolean;
}): boolean {
  // A claim is INVENTED if it introduces a specific factual assertion
  // (a new value, entity, or detail) that has no approved supporting source.
  return claim.hasSpecificNewValue && !claim.hasDirectEvidence;
}

/**
 * Determine if a claim is an interpretive elaboration.
 */
export function isInterpretiveElaboration(claim: {
  text: string;
  hasDirectEvidence: boolean;
  hasSpecificNewValue: boolean;
}): boolean {
  // Elaboration = reasonable narrative extension of a supported fact
  // that does NOT introduce a new specific value or entity.
  return claim.hasDirectEvidence && !claim.hasSpecificNewValue;
}
