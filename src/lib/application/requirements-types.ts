// ============================================================
// REQUIREMENTS KNOWLEDGE BASE TYPES
// Phase SOP-AI-32
// ============================================================
// Reusable university/program/application-writing requirements.
// ============================================================

import { DocumentType } from "./application-types";

// --- Institution ---

export type InstitutionStatus = "ACTIVE" | "REVIEW_REQUIRED" | "ARCHIVED";

export interface Institution {
  id: string;
  canonicalName: string;
  country?: string;
  officialDomain?: string;
  additionalOfficialDomains?: string[];
  status: InstitutionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstitutionInput {
  canonicalName: string;
  country?: string;
  officialDomain?: string;
  additionalOfficialDomains?: string[];
  status?: InstitutionStatus;
}

// --- Program ---

export interface Program {
  id: string;
  institutionId: string;
  programName: string;
  degree: string;
  department?: string;
  school?: string;
  campus?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProgramInput {
  institutionId: string;
  programName: string;
  degree: string;
  department?: string;
  school?: string;
  campus?: string;
  country?: string;
}

// --- Application Requirement Set ---

export type RequirementSetVerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "REVIEW_REQUIRED"
  | "UNKNOWN"
  | "CONFLICT"
  | "PORTAL_ONLY_UNAVAILABLE";

export type AiPolicyStatus =
  | "AI_GENERATION_ALLOWED"
  | "AI_GENERATION_PROHIBITED"
  | "AI_ASSISTANCE_RESTRICTED"
  | "AI_POLICY_NOT_FOUND"
  | "AI_POLICY_AMBIGUOUS"
  | "AI_POLICY_CONFLICT"
  | "REVIEW_REQUIRED"
  | null;

export interface ApplicationRequirementSet {
  id: string;
  programId: string;
  intake: string;
  intakeYear: string;
  applicationCycle?: string;
  verificationStatus: RequirementSetVerificationStatus;
  aiPolicyStatus: AiPolicyStatus;
  aiPolicyData?: Record<string, unknown>;
  verifiedAt?: string;
  lastCheckedAt?: string;
  expiresAt?: string;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRequirementSetInput {
  programId: string;
  intake: string;
  intakeYear: string;
  applicationCycle?: string;
  verificationStatus?: RequirementSetVerificationStatus;
  aiPolicyStatus?: AiPolicyStatus;
  aiPolicyData?: Record<string, unknown>;
  verifiedAt?: string;
  lastCheckedAt?: string;
  expiresAt?: string;
  contentHash?: string;
}

// --- Writing Requirement ---

export type WritingRequirementVerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "REVIEW_REQUIRED"
  | "UNKNOWN"
  | "CONFLICT"
  | "NOT_SPECIFIED_BY_OFFICIAL_SOURCE";

export interface WritingRequirement {
  id: string;
  requirementSetId: string;
  documentType: string;
  officialTitle: string;
  promptText: string;
  promptSource: string;
  componentOrder: number;
  required: boolean;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  verificationStatus: WritingRequirementVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWritingRequirementInput {
  requirementSetId: string;
  documentType: string;
  officialTitle: string;
  promptText: string;
  promptSource?: string;
  componentOrder?: number;
  required?: boolean;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  verificationStatus?: WritingRequirementVerificationStatus;
}

// --- Requirement Source ---

export type SourceScope =
  | "UNIVERSITY"
  | "GRADUATE_SCHOOL"
  | "SCHOOL"
  | "DEPARTMENT"
  | "PROGRAM"
  | "APPLICATION"
  | "INTAKE_SPECIFIC";

export type SourceRecordStatus = "ACTIVE" | "STALE" | "INACCESSIBLE" | "CONFLICTING";

export interface RequirementSource {
  id: string;
  requirementSetId: string;
  writingRequirementId?: string;
  sourceUrl: string;
  officialDomain?: string;
  sourceTitle?: string;
  sourceScope: SourceScope;
  sourceType?: string;
  retrievedAt?: string;
  verifiedAt?: string;
  contentHash?: string;
  status: SourceRecordStatus;
  createdAt: string;
}

export interface CreateRequirementSourceInput {
  requirementSetId: string;
  writingRequirementId?: string;
  sourceUrl: string;
  officialDomain?: string;
  sourceTitle?: string;
  sourceScope?: SourceScope;
  sourceType?: string;
  retrievedAt?: string;
  verifiedAt?: string;
  contentHash?: string;
  status?: SourceRecordStatus;
}

// --- Lookup ---

export type RequirementLookupResult =
  | "EXACT_FRESH_MATCH"
  | "STALE_MATCH"
  | "PARTIAL_MATCH"
  | "NOT_FOUND";

export interface RequirementLookupRequest {
  university: string;
  program: string;
  degree: string;
  intake: string;
  intakeYear: string;
  country?: string;
}

export interface RequirementLookupResponse {
  result: RequirementLookupResult;
  requirementSet?: ApplicationRequirementSet;
  institution?: Institution;
  program?: Program;
  writingRequirements?: WritingRequirement[];
  sources?: RequirementSource[];
}

// --- Freshness ---

export const FRESHNESS_DAYS = 90; // 3 months

export function isRequirementSetFresh(
  set: ApplicationRequirementSet,
  now: Date = new Date(),
): boolean {
  if (set.expiresAt) {
    return new Date(set.expiresAt) > now;
  }
  if (set.lastCheckedAt) {
    const checked = new Date(set.lastCheckedAt);
    const daysSince = (now.getTime() - checked.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < FRESHNESS_DAYS;
  }
  if (set.verifiedAt) {
    const verified = new Date(set.verifiedAt);
    const daysSince = (now.getTime() - verified.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < FRESHNESS_DAYS;
  }
  return false;
}

// --- Hash ---

export function computeRequirementSetHash(data: {
  university: string;
  program: string;
  degree: string;
  intake: string;
  intakeYear: string;
  writingRequirements: Array<{
    documentType: string;
    promptText: string;
    wordMin?: number;
    wordMax?: number;
  }>;
  aiPolicyStatus?: string | null;
}): string {
  const parts = [
    data.university.toLowerCase().trim(),
    data.program.toLowerCase().trim(),
    data.degree.toLowerCase().trim(),
    data.intake.toLowerCase().trim(),
    data.intakeYear.toLowerCase().trim(),
    (data.aiPolicyStatus || "null").toLowerCase().trim(),
    ...data.writingRequirements.map(w =>
      `${w.documentType}::${w.promptText}::${w.wordMin || ""}::${w.wordMax || ""}`,
    ),
  ];
  const str = parts.join("||");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `req-${Math.abs(hash).toString(16).padStart(8, "0")}`;
}
