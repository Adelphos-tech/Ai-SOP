// ============================================================
// DOCUMENT GENERATION CONTEXT LOADER
// Phase SOP-AI-33
// ============================================================
// Loads all authoritative generation context from the persistent
// database model using only IDs. The browser sends:
//   { studentId, applicationId, documentId }
//
// The backend reconstructs:
//   - Student profile
//   - Application
//   - Document
//   - Writing requirement (if linked)
//   - Requirement set (if linked)
//   - Resolved prompt
//   - Document type configuration
//   - Merged official + default instructions
// ============================================================

import {
  getStudent,
  getStudentProfile,
  getApplication,
  getDocument,
} from "./application-repository";
import {
  getWritingRequirement,
  getRequirementSet,
  getApplicationRequirementSet,
} from "./requirements-repository";
import {
  DocumentType,
  PromptSource,
} from "./application-types";
import {
  getDefaultTemplate,
} from "./default-templates";
import {
  getDocumentTypeConfig,
  DocumentTypeConfig,
  buildWritingInstructions,
} from "./document-type-config";
import { StudentProfileData } from "./application-types";

export type RequirementFieldSource =
  | "DOCUMENT"
  | "UNIVERSITY_REQUIREMENTS"
  | "OFFICIAL_REQUIREMENT"
  | "DEFAULT_TEMPLATE";

export interface MergedPrompt {
  promptText: string;
  promptSource: PromptSource;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  /** Inherited from saved University Requirements — not per-document. */
  requiredTopics?: string[];
  additionalQuestions?: string[];
  writingRequirementId?: string;
  requirementSetId?: string;
  /** How the prompt was resolved */
  resolutionPath: "OFFICIAL_VERIFIED" | "MANUAL" | "DEFAULT_TEMPLATE";
  /** Whether official values were merged with default template */
  mergedWithDefault: boolean;
  /** Per-field provenance — where each resolved value came from.
   *  Computed inside the same resolution logic so display cannot drift
   *  from what generation receives. */
  fieldSources?: Partial<Record<
    "promptText" | "wordMin" | "wordMax" | "characterLimit" | "pageLimit"
    | "specialInstructions" | "facultyInstructions" | "formattingInstructions",
    RequirementFieldSource
  >>;
}

export interface DocumentGenerationContext {
  student: any;
  profile: StudentProfileData | null;
  application: any;
  document: any;
  documentTypeConfig: DocumentTypeConfig;
  mergedPrompt: MergedPrompt;
  /** Whether fact sheet is approved */
  factSheetApproved: boolean;
  /** Pre-generation completeness issues */
  completenessIssues: string[];
  /** Whether generation should be blocked */
  blocked: boolean;
  blockReasons: string[];
}

export interface LoadContextResult {
  ok: boolean;
  context?: DocumentGenerationContext;
  error?: string;
  statusCode?: number;
}

/**
 * Load all generation context from the persistent DB model.
 * Validates relationships and checks pre-generation completeness.
 */
export async function loadDocumentGenerationContext(
  studentId: string,
  applicationId: string,
  documentId: string,
): Promise<LoadContextResult> {
  // ===== LOAD STUDENT =====
  const student = await getStudent(studentId);
  if (!student) {
    return { ok: false, error: "Student not found", statusCode: 404 };
  }

  // ===== LOAD APPLICATION =====
  const application = await getApplication(applicationId);
  if (!application) {
    return { ok: false, error: "Application not found", statusCode: 404 };
  }

  // ===== RELATIONSHIP VALIDATION =====
  if (application.studentId !== studentId) {
    return { ok: false, error: "Application does not belong to this student", statusCode: 403 };
  }

  // ===== LOAD DOCUMENT =====
  const document = await getDocument(documentId);
  if (!document) {
    return { ok: false, error: "Document not found", statusCode: 404 };
  }

  // ===== RELATIONSHIP VALIDATION =====
  if (document.applicationId !== applicationId) {
    return { ok: false, error: "Document does not belong to this application", statusCode: 403 };
  }

  // ===== LOAD STUDENT PROFILE =====
  const profile = await getStudentProfile(studentId);

  // ===== LOAD WRITING REQUIREMENT (if linked) =====
  let writingRequirement: any = null;
  let requirementSet: any = null;

  // Check if document has writingRequirementId (from DB column)
  const pool = (await import("./db")).getDbPool();
  const [docRows] = await pool.execute(
    "SELECT writing_requirement_id FROM application_documents WHERE id = ?",
    [documentId],
  );
  const writingRequirementId = (docRows as any[])[0]?.writing_requirement_id;

  if (writingRequirementId) {
    writingRequirement = await getWritingRequirement(writingRequirementId);
    if (writingRequirement) {
      // Verify writing requirement belongs to the application's requirement set
      const appReqSet = await getApplicationRequirementSet(applicationId);
      if (appReqSet?.requirementSet) {
        requirementSet = appReqSet.requirementSet;
        if (writingRequirement.requirementSetId !== requirementSet.id) {
          return {
            ok: false,
            error: "Writing requirement does not belong to the application's requirement set",
            statusCode: 403,
          };
        }
      }
    }
  }

  // ===== RESOLVE AND MERGE PROMPT =====
  // Field-by-field: explicit document override > saved University
  // Requirements (profile.universityRequirements) > default template.
  const mergedPrompt = resolveAndMergePrompt(
    document,
    writingRequirement,
    (profile as any)?.universityRequirements || null,
  );

  // ===== LOAD DOCUMENT TYPE CONFIG =====
  const documentTypeConfig = getDocumentTypeConfig(document.documentType);

  // ===== CHECK FACT SHEET APPROVAL =====
  // Auto-approve if profile has meaningful data (no dedicated approval UI yet).
  // When a fact-sheet approval UI is added, this should check the explicit flag.
  let factSheetApproved = false;
  if (profile) {
    const anyProfile = profile as any;
    const hasExplicitApproval = anyProfile.factSheetApproval?.approved === true;
    const hasBasicData = !!(
      anyProfile.personalData?.firstName &&
      anyProfile.personalData?.lastName &&
      Array.isArray(anyProfile.education) &&
      anyProfile.education.length > 0
    );
    factSheetApproved = hasExplicitApproval || hasBasicData;
  }

  // ===== PRE-GENERATION COMPLETENESS CHECKS =====
  const completenessIssues: string[] = [];
  const blockReasons: string[] = [];

  if (!factSheetApproved) {
    blockReasons.push("FACT_SHEET_NOT_APPROVED: Student facts must be approved before generation.");
  }

  // Document-type-specific completeness
  if (documentTypeConfig.recommenderPerspectiveRequired) {
    // LOR requires recommender context
    const hasRecommenderContext = checkRecommenderContext(profile);
    if (!hasRecommenderContext) {
      completenessIssues.push("MISSING_RECOMMENDER_CONTEXT: LOR requires recommender relationship context and specific examples.");
      blockReasons.push("MISSING_REQUIRED_STUDENT_INFORMATION: Recommender context is required for LOR generation.");
    }
  }

  if (documentTypeConfig.visaSpecificEvidence) {
    // Visa SOP requires study rationale and home-country ties
    const hasVisaEvidence = checkVisaEvidence(profile);
    if (!hasVisaEvidence) {
      completenessIssues.push("MISSING_VISA_EVIDENCE: Visa SOP requires study rationale and home-country/future plans evidence.");
      blockReasons.push("MISSING_REQUIRED_STUDENT_INFORMATION: Visa-specific evidence is required for Visa SOP generation.");
    }
  }

  // Check if profile has any meaningful data
  if (profile) {
    const hasPersonalData = profile.personalData && Object.keys(profile.personalData).length > 0;
    const hasEducation = profile.education && profile.education.length > 0;
    if (!hasPersonalData && !hasEducation) {
      blockReasons.push("MISSING_REQUIRED_STUDENT_INFORMATION: Student profile has no meaningful data.");
    }
  } else {
    blockReasons.push("MISSING_REQUIRED_STUDENT_INFORMATION: No student profile found.");
  }

  const blocked = blockReasons.length > 0;

  return {
    ok: true,
    context: {
      student,
      profile,
      application,
      document,
      documentTypeConfig,
      mergedPrompt,
      factSheetApproved,
      completenessIssues,
      blocked,
      blockReasons,
    },
  };
}

/**
 * Resolve and merge the prompt from the document and writing requirement.
 *
 * Priority:
 * 1. If document has a writing requirement linked (OFFICIAL_VERIFIED), use official values
 * 2. If document has a manual prompt (USER_PROVIDED_PORTAL_PROMPT, CONSULTANT_PROVIDED, CUSTOM), use it
 * 3. If no prompt, fall back to D-Vivid default template
 *
 * When official information is partial (e.g., only word limit, no exact question),
 * merge official constraints with D-Vivid default template structure.
 */
/**
 * Saved University Requirements values arrive as strings from
 * profile_data — normalize to usable numbers/lists.
 */
function uniReqNumber(v: any): number | undefined {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function uniReqLines(v: any): string[] {
  return String(v ?? "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export function resolveAndMergePrompt(
  document: any,
  writingRequirement: any,
  universityRequirements: any = null,
): MergedPrompt {
  const documentType = document.documentType as DocumentType;
  const defaultTemplate = getDefaultTemplate(documentType);
  const uni = universityRequirements || {};
  const uniWordMin = uniReqNumber(uni.wordMin);
  const uniWordMax = uniReqNumber(uni.wordMax);
  const uniCharLimit = uniReqNumber(uni.characterLimit);
  const uniPageLimit = uniReqNumber(uni.pageLimit);
  const uniFormatting = typeof uni.formattingRules === "string" && uni.formattingRules.trim() ? uni.formattingRules.trim() : undefined;
  const uniTopics = uniReqLines(uni.mandatoryTopics);
  const uniQuestions = uniReqLines(uni.specificQuestions);

  // Value + provenance in one evaluation — the fieldSources map always
  // reflects exactly which candidate supplied the resolved value.
  const pick = <T,>(...candidates: Array<[T | undefined, RequirementFieldSource]>): { v?: T; s?: RequirementFieldSource } => {
    for (const [v, s] of candidates) if (v !== undefined) return { v, s };
    return {};
  };

  // Case 1: Document has OFFICIAL_VERIFIED prompt source (linked to writing requirement)
  if (document.promptSource === "OFFICIAL_VERIFIED" && writingRequirement) {
    const officialPrompt = writingRequirement.promptText || document.promptText;
    const officialWordMin = writingRequirement.wordMin || undefined;
    const officialWordMax = writingRequirement.wordMax || undefined;
    const officialCharLimit = writingRequirement.characterLimit || undefined;
    const officialPageLimit = writingRequirement.pageLimit || undefined;
    const officialSpecial = writingRequirement.specialInstructions || undefined;
    const officialFaculty = writingRequirement.facultyInstructions || undefined;
    const officialFormatting = writingRequirement.formattingInstructions || undefined;

    // Check if official info is partial (has constraints but no exact question)
    const hasOfficialQuestion = officialPrompt && officialPrompt.trim().length > 20;
    const hasOfficialConstraints = !!(officialWordMax || officialCharLimit || officialPageLimit);

    if (hasOfficialQuestion) {
      // Full official prompt — use as-is, but add default structure guidance if no special instructions
      const mergedSpecial = officialSpecial || (!hasOfficialConstraints ? defaultTemplate.specialInstructions : undefined);
      const wMin = pick([officialWordMin, "OFFICIAL_REQUIREMENT"], [uniWordMin, "UNIVERSITY_REQUIREMENTS"]);
      const wMax = pick([officialWordMax, "OFFICIAL_REQUIREMENT"], [uniWordMax, "UNIVERSITY_REQUIREMENTS"]);
      const ch = pick([officialCharLimit, "OFFICIAL_REQUIREMENT"], [uniCharLimit, "UNIVERSITY_REQUIREMENTS"]);
      const pg = pick([officialPageLimit, "OFFICIAL_REQUIREMENT"], [uniPageLimit, "UNIVERSITY_REQUIREMENTS"]);
      const fmt = pick([officialFormatting, "OFFICIAL_REQUIREMENT"], [uniFormatting, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.formattingInstructions, "DEFAULT_TEMPLATE"]);
      return {
        promptText: officialPrompt,
        promptSource: "OFFICIAL_VERIFIED",
        wordMin: wMin.v,
        wordMax: wMax.v,
        characterLimit: ch.v,
        pageLimit: pg.v,
        specialInstructions: mergedSpecial,
        facultyInstructions: officialFaculty,
        formattingInstructions: fmt.v,
        fieldSources: {
          promptText: "OFFICIAL_REQUIREMENT",
          wordMin: wMin.s, wordMax: wMax.s, characterLimit: ch.s, pageLimit: pg.s,
          specialInstructions: mergedSpecial ? (officialSpecial ? "OFFICIAL_REQUIREMENT" : "DEFAULT_TEMPLATE") : undefined,
          facultyInstructions: officialFaculty ? "OFFICIAL_REQUIREMENT" : undefined,
          formattingInstructions: fmt.s,
        },
        requiredTopics: uniTopics.length ? uniTopics : undefined,
        additionalQuestions: uniQuestions.length ? uniQuestions : undefined,
        writingRequirementId: writingRequirement.id,
        requirementSetId: writingRequirement.requirementSetId,
        resolutionPath: "OFFICIAL_VERIFIED",
        mergedWithDefault: !!(mergedSpecial && !officialSpecial),
      };
    } else if (hasOfficialConstraints) {
      // Partial official: constraints but no question — merge with default template
      const wMin = pick([officialWordMin, "OFFICIAL_REQUIREMENT"], [uniWordMin, "UNIVERSITY_REQUIREMENTS"]);
      const wMax = pick([officialWordMax, "OFFICIAL_REQUIREMENT"], [uniWordMax, "UNIVERSITY_REQUIREMENTS"]);
      const ch = pick([officialCharLimit, "OFFICIAL_REQUIREMENT"], [uniCharLimit, "UNIVERSITY_REQUIREMENTS"]);
      const pg = pick([officialPageLimit, "OFFICIAL_REQUIREMENT"], [uniPageLimit, "UNIVERSITY_REQUIREMENTS"]);
      const fmt = pick([officialFormatting, "OFFICIAL_REQUIREMENT"], [uniFormatting, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.formattingInstructions, "DEFAULT_TEMPLATE"]);
      return {
        promptText: defaultTemplate.promptText,
        promptSource: "OFFICIAL_VERIFIED",
        wordMin: wMin.v,
        wordMax: wMax.v,
        characterLimit: ch.v,
        pageLimit: pg.v,
        specialInstructions: officialSpecial || defaultTemplate.specialInstructions,
        facultyInstructions: officialFaculty,
        formattingInstructions: fmt.v,
        fieldSources: {
          promptText: "DEFAULT_TEMPLATE",
          wordMin: wMin.s, wordMax: wMax.s, characterLimit: ch.s, pageLimit: pg.s,
          specialInstructions: officialSpecial ? "OFFICIAL_REQUIREMENT" : "DEFAULT_TEMPLATE",
          facultyInstructions: officialFaculty ? "OFFICIAL_REQUIREMENT" : undefined,
          formattingInstructions: fmt.s,
        },
        requiredTopics: uniTopics.length ? uniTopics : undefined,
        additionalQuestions: uniQuestions.length ? uniQuestions : undefined,
        writingRequirementId: writingRequirement.id,
        requirementSetId: writingRequirement.requirementSetId,
        resolutionPath: "OFFICIAL_VERIFIED",
        mergedWithDefault: true,
      };
    } else {
      // Official but no useful info — use default template
      const wMin = pick([uniWordMin, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.wordMin, "DEFAULT_TEMPLATE"]);
      const wMax = pick([uniWordMax, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.wordMax, "DEFAULT_TEMPLATE"]);
      const ch = pick([uniCharLimit, "UNIVERSITY_REQUIREMENTS"]);
      const pg = pick([uniPageLimit, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.pageLimit, "DEFAULT_TEMPLATE"]);
      const fmt = pick([uniFormatting, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.formattingInstructions, "DEFAULT_TEMPLATE"]);
      return {
        promptText: defaultTemplate.promptText,
        promptSource: "OFFICIAL_VERIFIED",
        wordMin: wMin.v,
        wordMax: wMax.v,
        characterLimit: ch.v,
        pageLimit: pg.v,
        specialInstructions: defaultTemplate.specialInstructions,
        formattingInstructions: fmt.v,
        fieldSources: {
          promptText: "DEFAULT_TEMPLATE",
          wordMin: wMin.s, wordMax: wMax.s, characterLimit: ch.s, pageLimit: pg.s,
          specialInstructions: "DEFAULT_TEMPLATE",
          formattingInstructions: fmt.s,
        },
        requiredTopics: uniTopics.length ? uniTopics : undefined,
        additionalQuestions: uniQuestions.length ? uniQuestions : undefined,
        writingRequirementId: writingRequirement.id,
        requirementSetId: writingRequirement.requirementSetId,
        resolutionPath: "OFFICIAL_VERIFIED",
        mergedWithDefault: true,
      };
    }
  }

  // Case 2: Document has DVIVID_DEFAULT_TEMPLATE
  // Always resolve against the CURRENT canonical default template, not the
  // text persisted at creation time. The persisted promptText is a snapshot
  // from when the document was created — it must NOT override the current
  // default template, otherwise template updates never reach existing
  // documents. The promptSource stays DVIVID_DEFAULT_TEMPLATE so the
  // display/generation knows this is a default-template document.
  if (document.promptSource === "DVIVID_DEFAULT_TEMPLATE") {
    const wMin = pick([document.wordMin, "DOCUMENT"], [uniWordMin, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.wordMin, "DEFAULT_TEMPLATE"]);
    const wMax = pick([document.wordMax, "DOCUMENT"], [uniWordMax, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.wordMax, "DEFAULT_TEMPLATE"]);
    const ch = pick([document.characterLimit, "DOCUMENT"], [uniCharLimit, "UNIVERSITY_REQUIREMENTS"]);
    const pg = pick([document.pageLimit, "DOCUMENT"], [uniPageLimit, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.pageLimit, "DEFAULT_TEMPLATE"]);
    const sp = pick([document.specialInstructions, "DOCUMENT"], [defaultTemplate.specialInstructions, "DEFAULT_TEMPLATE"]);
    const fmt = pick([document.formattingInstructions, "DOCUMENT"], [uniFormatting, "UNIVERSITY_REQUIREMENTS"], [defaultTemplate.formattingInstructions, "DEFAULT_TEMPLATE"]);
    return {
      promptText: defaultTemplate.promptText,
      promptSource: "DVIVID_DEFAULT_TEMPLATE",
      wordMin: wMin.v,
      wordMax: wMax.v,
      characterLimit: ch.v,
      pageLimit: pg.v,
      specialInstructions: sp.v,
      formattingInstructions: fmt.v,
      fieldSources: {
        promptText: "DEFAULT_TEMPLATE",
        wordMin: wMin.s, wordMax: wMax.s, characterLimit: ch.s, pageLimit: pg.s,
        specialInstructions: sp.s,
        formattingInstructions: fmt.s,
      },
      requiredTopics: uniTopics.length ? uniTopics : undefined,
      additionalQuestions: uniQuestions.length ? uniQuestions : undefined,
      resolutionPath: "DEFAULT_TEMPLATE",
      mergedWithDefault: false,
    };
  }

  // Case 3: Document has a manual prompt (USER_PROVIDED_PORTAL_PROMPT, CONSULTANT_PROVIDED, CUSTOM).
  // A consultant-provided PROMPT overrides the prompt only — limits,
  // mandatory topics, questions and formatting still inherit from the
  // saved University Requirements field-by-field.
  const wMin = pick([document.wordMin, "DOCUMENT"], [uniWordMin, "UNIVERSITY_REQUIREMENTS"]);
  const wMax = pick([document.wordMax, "DOCUMENT"], [uniWordMax, "UNIVERSITY_REQUIREMENTS"]);
  const ch = pick([document.characterLimit, "DOCUMENT"], [uniCharLimit, "UNIVERSITY_REQUIREMENTS"]);
  const pg = pick([document.pageLimit, "DOCUMENT"], [uniPageLimit, "UNIVERSITY_REQUIREMENTS"]);
  const fmt = pick([document.formattingInstructions, "DOCUMENT"], [uniFormatting, "UNIVERSITY_REQUIREMENTS"]);
  return {
    promptText: document.promptText,
    promptSource: document.promptSource,
    wordMin: wMin.v,
    wordMax: wMax.v,
    characterLimit: ch.v,
    pageLimit: pg.v,
    specialInstructions: document.specialInstructions || undefined,
    facultyInstructions: document.facultyInstructions || undefined,
    formattingInstructions: fmt.v,
    fieldSources: {
      promptText: "DOCUMENT",
      wordMin: wMin.s, wordMax: wMax.s, characterLimit: ch.s, pageLimit: pg.s,
      specialInstructions: document.specialInstructions ? "DOCUMENT" : undefined,
      facultyInstructions: document.facultyInstructions ? "DOCUMENT" : undefined,
      formattingInstructions: fmt.s,
    },
    requiredTopics: uniTopics.length ? uniTopics : undefined,
    additionalQuestions: uniQuestions.length ? uniQuestions : undefined,
    resolutionPath: "MANUAL",
    mergedWithDefault: false,
  };
}

/**
 * Read-only resolved requirements for display (document Review page).
 * Reuses the canonical resolveAndMergePrompt — the same function the
 * generation contract consumes — but without generation gates, so the
 * UI can show effective values even when generation is blocked.
 */
export async function loadDocumentRequirementsForDisplay(
  documentId: string,
): Promise<MergedPrompt | null> {
  const document = await getDocument(documentId);
  if (!document) return null;
  const application = await getApplication(document.applicationId);
  const profile = application ? await getStudentProfile(application.studentId) : null;

  let writingRequirement: any = null;
  const pool = (await import("./db")).getDbPool();
  const [rows] = await pool.execute(
    "SELECT writing_requirement_id FROM application_documents WHERE id = ?",
    [documentId],
  );
  const writingRequirementId = (rows as any[])[0]?.writing_requirement_id;
  if (writingRequirementId) {
    writingRequirement = await getWritingRequirement(writingRequirementId);
  }

  return resolveAndMergePrompt(
    document,
    writingRequirement,
    (profile as any)?.universityRequirements || null,
  );
}

/**
 * Check if the profile has recommender context for LOR.
 */
function checkRecommenderContext(profile: StudentProfileData | null): boolean {
  if (!profile) return false;
  // Check for recommender-related fields in the profile
  const anyProfile = profile as any;
  return !!(
    anyProfile.recommenderContext ||
    anyProfile.recommender ||
    (anyProfile.experience && anyProfile.experience.length > 0)
  );
}

/**
 * Check if the profile has visa-specific evidence.
 * Reads canonical intake keys (careerGoals.longTerm.*, countryQuestions,
 * mastersMotivation) with legacy keys as fallback.
 */
function checkVisaEvidence(profile: StudentProfileData | null): boolean {
  if (!profile) return false;
  const anyProfile = profile as any;
  const careerGoals = anyProfile.careerGoals;
  const longTerm = careerGoals?.longTerm;
  const countryQ = anyProfile.countryQuestions || anyProfile.countryQuestionnaire;
  const mastersMotivation = anyProfile.mastersMotivation;
  return !!(
    // Canonical keys written by the 9-section intake
    (longTerm && (longTerm.homeCountryPlans || longTerm.vision)) ||
    (countryQ && Object.values(countryQ).some((v: any) => typeof v === "string" && v.trim().length > 0)) ||
    (mastersMotivation && Object.values(mastersMotivation).some((v: any) => typeof v === "string" && v.trim().length > 0)) ||
    // Legacy keys (fallback only)
    (careerGoals &&
      (careerGoals.whyField || careerGoals.whyProgram || careerGoals.returnHomeCountry || careerGoals.returnPlans))
  );
}

/**
 * Build the writing instructions string for the pipeline.
 * Combines document-type config with merged prompt.
 */
export function buildPipelineWritingInstructions(ctx: DocumentGenerationContext): string {
  const config = ctx.documentTypeConfig;
  const merged = ctx.mergedPrompt;

  const parts: string[] = [];
  parts.push(buildWritingInstructions(config));

  if (merged.mergedWithDefault) {
    parts.push("\nNOTE: Official constraints are combined with D-Vivid default structural guidance. Official values take precedence. D-Vivid guidance is NOT university requirement.");
  }

  if (merged.specialInstructions) {
    parts.push(`\nSPECIAL INSTRUCTIONS: ${merged.specialInstructions}`);
  }

  if (merged.facultyInstructions) {
    parts.push(`\nFACULTY/RESEARCH INSTRUCTIONS: ${merged.facultyInstructions}`);
  }

  if (merged.formattingInstructions) {
    parts.push(`\nFORMATTING INSTRUCTIONS: ${merged.formattingInstructions}`);
  }

  return parts.join("\n");
}
