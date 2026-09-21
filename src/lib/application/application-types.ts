// ============================================================
// APPLICATION DOCUMENT FOUNDATION TYPES
// Phase SOP-AI-29
// ============================================================
// Canonical types for the Student → Application → Document → Version
// product hierarchy. These are the permanent data model.
// ============================================================

// ============================================================
// DOCUMENT TYPES
// ============================================================

export type DocumentType =
  | "STATEMENT_OF_PURPOSE"
  | "ESSAY"
  | "SUPPLEMENTAL_QUESTION"
  | "MOA"
  | "PERSONAL_STATEMENT"
  | "STATEMENT_OF_ACADEMIC_PURPOSE"
  | "LETTER_OF_MOTIVATION"
  | "VISA_SOP"
  | "COVER_LETTER"
  | "LETTER_OF_RECOMMENDATION"
  | "CUSTOM";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  STATEMENT_OF_PURPOSE: "Statement of Purpose",
  ESSAY: "Essay",
  SUPPLEMENTAL_QUESTION: "Supplemental Question",
  MOA: "MOA",
  PERSONAL_STATEMENT: "Personal Statement",
  STATEMENT_OF_ACADEMIC_PURPOSE: "Statement of Academic Purpose",
  LETTER_OF_MOTIVATION: "Letter of Motivation",
  VISA_SOP: "Visa SOP",
  COVER_LETTER: "Cover Letter",
  LETTER_OF_RECOMMENDATION: "Letter of Recommendation",
  CUSTOM: "Custom Document",
};

export const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: "STATEMENT_OF_PURPOSE", label: "Statement of Purpose" },
  { value: "ESSAY", label: "Essay" },
  { value: "SUPPLEMENTAL_QUESTION", label: "Supplemental Question" },
  { value: "MOA", label: "MOA" },
  { value: "PERSONAL_STATEMENT", label: "Personal Statement" },
  { value: "STATEMENT_OF_ACADEMIC_PURPOSE", label: "Statement of Academic Purpose" },
  { value: "LETTER_OF_MOTIVATION", label: "Letter of Motivation" },
  { value: "VISA_SOP", label: "Visa SOP" },
  { value: "COVER_LETTER", label: "Cover Letter" },
  { value: "LETTER_OF_RECOMMENDATION", label: "Letter of Recommendation" },
  { value: "CUSTOM", label: "Custom Document" },
];

// ============================================================
// PROMPT SOURCES
// ============================================================

export type PromptSource =
  | "OFFICIAL_VERIFIED"
  | "USER_PROVIDED_PORTAL_PROMPT"
  | "CONSULTANT_PROVIDED"
  | "DVIVID_DEFAULT_TEMPLATE"
  | "CUSTOM";

export const PROMPT_SOURCE_LABELS: Record<PromptSource, string> = {
  OFFICIAL_VERIFIED: "Official Verified",
  USER_PROVIDED_PORTAL_PROMPT: "Application Portal",
  CONSULTANT_PROVIDED: "Consultant Provided",
  DVIVID_DEFAULT_TEMPLATE: "D-Vivid Default Template",
  CUSTOM: "Custom",
};

export const PROMPT_SOURCE_OPTIONS: { value: PromptSource; label: string; description: string }[] = [
  {
    value: "OFFICIAL_VERIFIED",
    label: "Official Verified",
    description: "Verified from official university/program source (server-controlled)",
  },
  {
    value: "USER_PROVIDED_PORTAL_PROMPT",
    label: "Application Portal",
    description: "Copied from an application portal that D-Vivid cannot publicly verify",
  },
  {
    value: "CONSULTANT_PROVIDED",
    label: "Consultant Provided",
    description: "D-Vivid consultant manually provides application instructions",
  },
  {
    value: "DVIVID_DEFAULT_TEMPLATE",
    label: "D-Vivid Default Template",
    description: "Generic D-Vivid template used when no official or manual prompt is available",
  },
  {
    value: "CUSTOM",
    label: "Custom",
    description: "D-Vivid consultant creates a custom writing task",
  },
];

/**
 * Prompt sources that can be set by the user (consultant/student).
 * OFFICIAL_VERIFIED is server-controlled only.
 * DVIVID_DEFAULT_TEMPLATE is server-controlled (applied by resolve-prompt flow).
 */
export const USER_SETTABLE_PROMPT_SOURCES: PromptSource[] = [
  "USER_PROVIDED_PORTAL_PROMPT",
  "CONSULTANT_PROVIDED",
  "CUSTOM",
];

// ============================================================
// APPLICATION STATUS
// ============================================================

export type ApplicationStatus =
  | "DRAFT"
  | "REQUIREMENTS_PENDING"
  | "REQUIREMENTS_VERIFIED"
  | "DOCUMENTS_IN_PROGRESS"
  | "DOCUMENTS_COMPLETE"
  | "SUBMITTED"
  | "ARCHIVED";

// ============================================================
// DOCUMENT STATUS
// ============================================================

export type RequirementsStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "VERIFIED"
  | "REVIEW_REQUIRED";

export type GenerationStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "GENERATING"
  | "GENERATED"
  | "FAILED"
  | "REVIEWED"
  | "FINALIZED";

// Phase SOP-AI-34: Document review lifecycle
export type ReviewStatus = "DRAFT" | "IN_REVIEW" | "APPROVED";

// ============================================================
// VERSION TYPES
// ============================================================

export type CreatedByType =
  | "AI_GENERATED"
  | "CONSULTANT_EDITED"
  | "STUDENT_EDITED"
  | "SYSTEM";

export type ContentFormat = "MARKDOWN" | "PLAIN_TEXT" | "HTML";

// ============================================================
// ENTITY TYPES
// ============================================================

export interface Student {
  id: string;
  externalRefId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  profileData?: StudentProfileData;
  createdAt: string;
  updatedAt: string;
}

export interface StudentProfileData {
  personalData?: Record<string, unknown>;
  education?: Record<string, unknown>[];
  englishTesting?: Record<string, unknown>;
  experience?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  achievements?: Record<string, unknown>[];
  careerGoals?: Record<string, unknown>;
  stories?: Record<string, unknown>[];
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Application {
  id: string;
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  department?: string;
  country: string;
  intake: string;
  intakeYear: string;
  applicationContextId?: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDocument {
  id: string;
  applicationId: string;
  documentType: DocumentType;
  documentTitle: string;
  promptText: string;
  promptSource: PromptSource;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  mandatoryTopics?: string;
  additionalQuestions?: string;
  useLegacyRequirements?: boolean;
  requirementsStatus: RequirementsStatus;
  generationStatus: GenerationStatus;
  reviewStatus: ReviewStatus;
  currentVersionId?: string;
  approvedVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  contentFormat: ContentFormat;
  createdByType: CreatedByType;
  parentVersionId?: string;
  model?: string;
  generationId?: string;
  studentFactsHash?: string;
  requirementsHash?: string;
  costUsd?: number;
  costInr?: number;
  createdAt: string;
}

// ============================================================
// API INPUT TYPES
// ============================================================

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  externalRefId?: string;
  profileData?: StudentProfileData;
}

export interface CreateApplicationInput {
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  department?: string;
  country: string;
  intake: string;
  intakeYear: string;
}

export interface CreateDocumentInput {
  applicationId: string;
  documentType: DocumentType;
  documentTitle: string;
  promptText: string;
  promptSource: PromptSource;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  mandatoryTopics?: string;
  additionalQuestions?: string;
}

export interface CreateDocumentVersionInput {
  documentId: string;
  content: string;
  contentFormat?: ContentFormat;
  createdByType: CreatedByType;
  model?: string;
  generationId?: string;
  studentFactsHash?: string;
  requirementsHash?: string;
  costUsd?: number;
  costInr?: number;
  parentVersionId?: string;
}

// Phase SOP-AI-34: Consultant-edited version input
export interface SaveConsultantVersionInput {
  documentId: string;
  content: string;
  baseVersionId?: string;
  contentFormat?: ContentFormat;
}

// ============================================================
// VALIDATION
// ============================================================

export function isValidDocumentType(value: string): value is DocumentType {
  return value in DOCUMENT_TYPE_LABELS;
}

export function isValidPromptSource(value: string): value is PromptSource {
  return value in PROMPT_SOURCE_LABELS;
}

export function isUserSettablePromptSource(value: string): boolean {
  return USER_SETTABLE_PROMPT_SOURCES.includes(value as PromptSource);
}
