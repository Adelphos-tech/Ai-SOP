/**
 * @file generation-contract-types.ts
 * @description
 * Type definitions for the Generation Contract — the single server-side
 * object that the OpenAI writing pipeline is allowed to run from.
 *
 * The browser must NOT construct this directly. It is built server-side from:
 *   A. Approved Student Fact Sheet
 *   B. Verified Application Brief
 *   C. Verified AI Usage Policy
 *   D. Verified Program Context
 *   E. Verified Country Guidance
 *   F. Student English/Writing Preferences
 *
 * Generation is allowed ONLY when:
 *   - Fact Sheet Approved = true
 *   - Requirements Verification Gate = PASS
 *   - AI Usage Policy allows FULL AI writing
 *   - No unresolved official-source conflict
 *   - Required application identity is verified
 */

import { ApplicationIdentity, DocumentRequirement, CountryGuidance, VerificationResult, SourceRecord } from "./types";
import { AiUsagePolicy } from "./ai-policy-types";

/* ------------------------------------------------------------------ */
/* Verified Program Context                                            */
/* ------------------------------------------------------------------ */

/**
 * A single field of verified program context with provenance.
 * Every field MUST be supported by an official source.
 */
export interface ProgramContextField<T = string | string[]> {
  value: T;
  sourceId: string;
  sourceUrl: string;
  sourceQuote: string;
  verifiedAt: string;
}

/**
 * Verified program context — information extracted ONLY from approved
 * official university/program sources.
 *
 * This is NOT a requirement. It helps personalization/program fit.
 * Requirements control compliance; program context helps the writer
 * explain genuine fit.
 */
export interface VerifiedProgramContext {
  programOfficialName: ProgramContextField | null;
  school: ProgramContextField | null;
  department: ProgramContextField | null;
  programDescription: ProgramContextField | null;
  academicFocusAreas: ProgramContextField<string[]> | null;
  curriculumThemes: ProgramContextField<string[]> | null;
  specializationsOrTracks: ProgramContextField<string[]> | null;
  officiallyListedResearchAreas: ProgramContextField<string[]> | null;
  officiallyListedLabs: ProgramContextField<string[]> | null;
  officiallyListedFacilities: ProgramContextField<string[]> | null;
  officiallyListedFaculty: ProgramContextField<string[]> | null;
  otherRelevantProgramFacts: ProgramContextField<string[]> | null;
  sources: SourceRecord[];
  verifiedAt: string;
}

/* ------------------------------------------------------------------ */
/* Language profile for the contract                                  */
/* ------------------------------------------------------------------ */

/**
 * Student English/writing preferences.
 * Style only — must NEVER override official content requirements.
 */
export interface ContractLanguageProfile {
  testType: string;
  overallScore: string;
  writingScore: string;
  desiredProfile: string;
  tone: string;
  personalization: string;
  technicalDetail: string;
  openingStyle: string;
}

/* ------------------------------------------------------------------ */
/* Writing requirement (per document)                                  */
/* ------------------------------------------------------------------ */

/**
 * A single writing requirement extracted from the verified brief.
 * One per required document.
 */
export interface ContractWritingRequirement {
  documentType: string;
  documentTypeLabel: string;
  officialPrompt: string | null;
  officialPromptStatus: string;
  wordLimit: {
    min: number | null;
    max: number | null;
    status: string;
  };
  characterLimit: {
    min: number | null;
    max: number | null;
    status: string;
  };
  requiredTopics: string[];
  formatInstructions: string[];
  additionalQuestions: string[];
  sourceId: string | null;
  /**
   * Number of response components (questions) within this document.
   * 1 = single essay; >1 = multiple questions to answer separately.
   */
  responseComponentCount: number;
}


/* ------------------------------------------------------------------ */
/* Response components (multiple questions within one document)        */
/* ------------------------------------------------------------------ */

/**
 * A single response component within a document.
 * For example, MIT CEE's Statement of Objectives has 2 response components:
 *   A. Experience (max 1 page)
 *   B. Purpose (max 1 page)
 */
export interface ResponseComponent {
  componentId: string;
  label: string;
  exactPrompt: string;
  pageLimit: PageLimitConstraint;
  wordLimit: WordLimitConstraint;
  characterLimit: CharacterLimitConstraint;
  requiredTopics: ResponseComponentTopic[];
  sourceId: string;
  status: string;
  verifiedAt: string;
}

export interface ResponseComponentTopic {
  topic: string;
  status: string;
  sourceId: string;
  sourceQuote: string;
  requiresStudentSpecificFact?: boolean;
  studentFactType?: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Page limit constraint                                               */
/* ------------------------------------------------------------------ */

export type PageLimitType = "PER_DOCUMENT" | "PER_RESPONSE_COMPONENT" | "COMBINED";

export interface PageLimitConstraint {
  type: PageLimitType;
  maxPages: number | null;
  status: string;
  sourceId?: string;
  sourceQuote?: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Word/character limit constraints                                    */
/* ------------------------------------------------------------------ */

export interface WordLimitConstraint {
  min: number | null;
  max: number | null;
  status: string;
  note?: string;
}

export interface CharacterLimitConstraint {
  min: number | null;
  max: number | null;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Faculty alignment                                                    */
/* ------------------------------------------------------------------ */

export type FacultyAlignmentStatus = "PROPOSED" | "STUDENT_APPROVED" | "REJECTED";

export interface FacultyAlignment {
  facultyName: string;
  verifiedProgramFactSource: string;
  studentInterestEvidence: string[];
  alignmentReason: string;
  status: FacultyAlignmentStatus;
}

/* ------------------------------------------------------------------ */
/* Generation Contract                                                 */
/* ------------------------------------------------------------------ */

/**
 * The complete server-side Generation Contract.
 * The OpenAI writing pipeline may run ONLY from this object.
 */
export interface GenerationContract {
  contractId: string;
  createdAt: string;
  /**
   * Phase 21: Deterministic semantic hash of the contract content.
   * Excludes volatile runtime fields (contractId, createdAt).
   * Used for checkpoint validity and golden integrity.
   * Runtime instance IDs/timestamps may differ but this hash
   * must be identical for semantically identical inputs.
   */
  contractSemanticHash?: string;

  studentFacts: any; // Approved Student Fact Sheet (StudentProfile)

  application: ApplicationIdentity;

  writingRequirement: ContractWritingRequirement;

  /**
   * Response components within the writing requirement.
   * If the official prompt has multiple questions (e.g., MIT CEE A + B),
   * each question is a separate response component.
   * Do NOT merge multiple questions into one generic essay.
   */
  responseComponents: ResponseComponent[];

  /**
   * Page limit for the document or response components.
   * Page limits are NOT converted to word limits.
   */
  pageLimit: PageLimitConstraint;

  programContext: VerifiedProgramContext | null;

  countryGuidance: CountryGuidance | null;

  languageProfile: ContractLanguageProfile;

  /**
   * Faculty alignment records.
   * Only STUDENT_APPROVED alignments may be used as student preferences
   * in generated content.
   */
  facultyAlignment: FacultyAlignment[];

  verification: {
    requirementsVerified: boolean;
    aiWritingAllowed: boolean;
    aiPolicyStatus: string;
    conflicts: any[];
    factSheetApproved: boolean;
  };

  // Whether this contract is cleared for OpenAI writing
  clearedForWriting: boolean;

  // If not cleared, the blocking reasons
  blockingReasons: string[];
}

/* ------------------------------------------------------------------ */
/* Contract build result                                               */
/* ------------------------------------------------------------------ */

export type ContractBuildStatus =
  | "CLEARED"
  | "FACT_SHEET_NOT_APPROVED"
  | "APPLICATION_REQUIREMENTS_UNVERIFIED"
  | "APPLICATION_AI_POLICY_BLOCK"
  | "MISSING_REQUIRED_STUDENT_INFORMATION"
  | "APPLICATION_REQUIREMENT_CONFLICT"
  | "NO_WRITING_REQUIREMENT"
  | "PORTAL_ONLY_PROMPT"
  | "UNKNOWN_PROMPT";

export interface ContractBuildResult {
  status: ContractBuildStatus;
  contract: GenerationContract | null;
  blockingReasons: string[];
  missingRequiredInformation: MissingRequiredInfo[];
}

export interface MissingRequiredInfo {
  requiredTopic: string;
  reason: string;
  studentEvidenceFields: string[];
}

/* ------------------------------------------------------------------ */
/* Course relevance (planner)                                         */
/* ------------------------------------------------------------------ */

export type FactRelevance = "HIGH" | "MEDIUM" | "LOW" | "IRRELEVANT";

export interface FactRelevanceDecision {
  factId: string;
  factType: string;
  relevance: FactRelevance;
  reason: string;
  useInSop: boolean;
}

export interface RequiredTopicMapping {
  requiredTopic: string;
  studentEvidence: string[];
  status: "COVERED" | "INSUFFICIENT_STUDENT_DATA" | "NO_STUDENT_DATA";
  reason: string;
}

export interface PlannerRelevanceOutput {
  factRelevance: FactRelevanceDecision[];
  requiredTopicMappings: RequiredTopicMapping[];
  missingRequiredInformation: MissingRequiredInfo[];
  hasMaterialMissingInfo: boolean;
}

/* ------------------------------------------------------------------ */
/* Deterministic compliance check                                     */
/* ------------------------------------------------------------------ */

export interface ComplianceCheckResult {
  documentType: "PASS" | "FAIL" | "N/A";
  officialPrompt: "PASS" | "FAIL" | "N/A";
  requiredTopics: "PASS" | "FAIL" | "N/A";
  wordLimit: "PASS" | "FAIL" | "N/A";
  characterLimit: "PASS" | "FAIL" | "N/A";
  format: "PASS" | "FAIL" | "N/A";
  emptyOutput: "PASS" | "FAIL";
  markdownCompliance: "PASS" | "FAIL" | "N/A";
  details: string[];
}

/* ------------------------------------------------------------------ */
/* Application compliance result (final)                              */
/* ------------------------------------------------------------------ */

export interface ApplicationComplianceResult {
  factCheck: {
    pass: boolean;
    unsupportedClaims: string[];
    alteredClaims: string[];
    ambiguousClaims: string[];
  };
  requirementCompliance: ComplianceCheckResult;
  languageProfile: {
    level: string;
    tone: string;
  };
  wordCount: number;
}
