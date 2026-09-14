// ============================================================
// APPLICATION REQUIREMENTS ENGINE — TYPE DEFINITIONS
// HARD RULE: No generic fallback. Requirements come ONLY from
// official university/program/country sources.
// ============================================================

export type SourceClass =
  | "OFFICIAL_UNIVERSITY_WEBPAGE"
  | "OFFICIAL_UNIVERSITY_DOCUMENT"
  | "OFFICIAL_COUNTRY_SOURCE";

export type SourceStatus =
  | "ACTIVE"
  | "STALE"
  | "INACCESSIBLE"
  | "CONFLICTING"
  | "NOT_APPLICABLE";

export type RequirementStatus =
  | "VERIFIED"
  | "UNKNOWN"
  | "NOT_SPECIFIED_BY_OFFICIAL_SOURCE"
  | "PORTAL_ONLY_UNAVAILABLE"
  | "CONFLICT"
  | "REVIEW_REQUIRED";

export type DocumentType =
  | "STATEMENT_OF_PURPOSE"
  | "PERSONAL_STATEMENT"
  | "MOTIVATION_LETTER"
  | "STUDY_PLAN"
  | "ACADEMIC_STATEMENT"
  | "PERSONAL_HISTORY_STATEMENT"
  | "SUPPLEMENTAL_ESSAY"
  | "SCHOLARSHIP_ESSAY"
  | "SHORT_ANSWER_QUESTION"
  | "OTHER";

export type SourcePriority = "PRIMARY" | "SECONDARY" | "TERTIARY";

export interface SourceRecord {
  sourceId: string;
  sourceClass: SourceClass;
  title: string;
  officialOrganization: string;
  officialDomain: string;
  url: string;
  retrievedAt: string;
  publishedOrUpdatedAt: string | null;
  programMatch: boolean;
  degreeLevelMatch: boolean;
  intakeMatch: boolean;
  countryMatch: boolean;
  httpStatus: number;
  contentHash: string;
  status: SourceStatus;
  priority: SourcePriority;
}

export interface FieldProvenance {
  field: string;
  value: any;
  status: RequirementStatus;
  sourceId: string;
  sourceQuote: string;
  verifiedAt: string;
  programMatch: boolean;
  intakeMatch: boolean;
}

export interface DocumentRequirement {
  documentType: DocumentType;
  documentTypeLabel: string;
  required: boolean;
  officialPrompt: {
    rawText: string | null;
    status: RequirementStatus;
    provenance: FieldProvenance | null;
  };
  wordLimit: {
    min: number | null;
    max: number | null;
    status: RequirementStatus;
    provenance: FieldProvenance | null;
  };
  characterLimit: {
    min: number | null;
    max: number | null;
    status: RequirementStatus;
    provenance: FieldProvenance | null;
  };
  requiredTopics: FieldProvenance[];
  formatInstructions: FieldProvenance[];
  additionalQuestions: FieldProvenance[];
}

export interface CountryGuidance {
  items: FieldProvenance[];
  priority: "SECONDARY";
  sourceId: string | null;
}

export interface ApplicationIdentity {
  country: string;
  university: string;
  program: string;
  degreeLevel: string;
  intake: string;
  intakeYear: string;
}

export type VerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "UNVERIFIED"
  | "BLOCKED"
  | "CONFLICT";

export interface ConflictRecord {
  field: string;
  sources: string[];
  values: any[];
  description: string;
}

export interface BlockingIssue {
  field: string;
  issue: string;
  severity: "BLOCK" | "WARN";
}

export interface VerificationResult {
  status: VerificationStatus;
  verifiedAt: string;
  conflicts: ConflictRecord[];
  blockingIssues: BlockingIssue[];
}

export interface VerifiedApplicationBrief {
  applicationIdentity: ApplicationIdentity;
  documents: DocumentRequirement[];
  countryGuidance: CountryGuidance;
  sources: SourceRecord[];
  verification: VerificationResult;
  cacheKey: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface RequirementsResolutionRequest {
  applicationIdentity: ApplicationIdentity;
  forceRefresh?: boolean;
  /** Student-provided official requirements page URL (fallback when not in registry) */
  studentProvidedRequirementsUrl?: string;
  /** Student-provided official AI policy page URL (fallback when not in registry) */
  studentProvidedAiPolicyUrl?: string;
}

export interface RequirementsResolutionResult {
  status: "RESOLVED" | "PARTIALLY_RESOLVED" | "BLOCKED" | "CONFLICT";
  brief: VerifiedApplicationBrief | null;
  aiPolicy: any | null;
  error: string | null;
  costUsd: number;
  costInr: number;
  duration: number;
  fromCache: boolean;
}

export interface OfficialDomainMapping {
  organization: string;
  officialDomains: string[];
  verifiedAt: string;
  sourceClass: SourceClass;
  /** Optional: known official requirements page URLs for this organization */
  requirementsPageUrls?: string[];
  /** Optional: known official AI policy page URLs for this organization */
  aiPolicyPageUrls?: string[];
}

export interface RequirementsCost {
  requirementsResolutionCostUsd: number;
  requirementsResolutionCostInr: number;
  sopWritingCostUsd: number;
  sopWritingCostInr: number;
}
