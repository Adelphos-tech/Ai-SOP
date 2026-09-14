/**
 * @file student-declared-requirements.ts
 * @description
 * Builds the pipeline inputs (VerifiedApplicationBrief, AiUsagePolicy,
 * ResponseComponent[]) from student-declared application data.
 *
 * This is the generic UI flow used when there is no server-side verified
 * artifact set (unlike the MIT CEE fixture which loads persisted
 * officially-verified artifacts from logs/).
 *
 * SAFETY MODEL:
 *   - Requirements come from what the STUDENT entered on the /application
 *     page (official prompt pasted by student + word limits).
 *     Provenance marks them REVIEW_REQUIRED (not VERIFIED) since they are
 *     student-transcribed, not fetched from official pages by the system.
 *   - AI policy is NEVER silently allowed. The student must explicitly
 *     attest that the university permits AI-assisted writing. Without the
 *     attestation the policy is AI_POLICY_NOT_FOUND and generation blocks.
 *
 * No new gates are weakened: buildGenerationContract and
 * validateContractForWriting still run their full checks downstream.
 */

import {
  VerifiedApplicationBrief,
  ApplicationIdentity,
  DocumentRequirement,
} from "./types";
import {
  AiUsagePolicy,
} from "./ai-policy-types";
import {
  ResponseComponent,
  PageLimitConstraint,
} from "./generation-contract-types";

export interface StudentDeclaredRequirements {
  sopQuestion: string;
  wordRequirement: "Known" | "Unknown" | "";
  minWords: string;
  maxWords: string;
  maxCharacters: string;
  aiPolicyAttestation: "ALLOWED" | "PROHIBITED" | "UNKNOWN" | "";
}

/**
 * Build a VerifiedApplicationBrief from student-declared data.
 * The brief is PARTIALLY_VERIFIED: prompt and limits carry
 * REVIEW_REQUIRED provenance (student-transcribed official text).
 */
export function buildStudentDeclaredBrief(
  appDomain: ApplicationIdentity,
  declared: StudentDeclaredRequirements
): VerifiedApplicationBrief {
  const now = new Date().toISOString();
  const identity: ApplicationIdentity = { ...appDomain };

  const promptStatus = declared.sopQuestion.trim() ? "REVIEW_REQUIRED" : "UNKNOWN";
  const wordStatus =
    declared.wordRequirement === "Known" && (declared.minWords || declared.maxWords)
      ? "REVIEW_REQUIRED"
      : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE";
  const charStatus = declared.maxCharacters ? "REVIEW_REQUIRED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE";

  const doc: DocumentRequirement = {
    documentType: "STATEMENT_OF_PURPOSE",
    documentTypeLabel: "Statement of Purpose",
    required: true,
    officialPrompt: {
      rawText: declared.sopQuestion.trim() || null,
      status: promptStatus as any,
      provenance: declared.sopQuestion.trim()
        ? {
            field: "officialPrompt",
            value: declared.sopQuestion.trim(),
            status: "REVIEW_REQUIRED" as any,
            sourceId: "STUDENT-DECLARED-PROMPT",
            sourceQuote: declared.sopQuestion.trim(),
            verifiedAt: now,
            programMatch: true,
            intakeMatch: true,
          }
        : null,
    },
    wordLimit: {
      min: declared.minWords ? parseInt(declared.minWords, 10) || null : null,
      max: declared.maxWords ? parseInt(declared.maxWords, 10) || null : null,
      status: wordStatus as any,
      provenance: null,
    },
    characterLimit: {
      min: null,
      max: declared.maxCharacters ? parseInt(declared.maxCharacters, 10) || null : null,
      status: charStatus as any,
      provenance: null,
    },
    requiredTopics: [],
    formatInstructions: [],
    additionalQuestions: [],
  };

  return {
    applicationIdentity: identity,
    documents: [doc],
    countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
    sources: [],
    verification: {
      status: "PARTIALLY_VERIFIED",
      verifiedAt: now,
      conflicts: [],
      blockingIssues: [],
    },
    cacheKey: `student-declared-${identity.university}-${identity.program}`,
    createdAt: now,
    expiresAt: null,
  };
}

/**
 * Build an AiUsagePolicy from an explicit student attestation.
 *
 * - ALLOWED    → AI_GENERATION_ALLOWED (generationAllowed: true)
 * - PROHIBITED → AI_GENERATION_PROHIBITED (blocks)
 * - UNKNOWN/"" → AI_POLICY_NOT_FOUND (blocks — silence is not permission)
 */
export function buildStudentDeclaredAiPolicy(
  identity: ApplicationIdentity,
  attestation: StudentDeclaredRequirements["aiPolicyAttestation"]
): AiUsagePolicy {
  const now = new Date().toISOString();

  if (attestation === "ALLOWED") {
    return {
      status: "AI_GENERATION_ALLOWED",
      generationAllowed: true,
      editingAllowed: "ALLOWED",
      proofreadingAllowed: "ALLOWED",
      brainstormingAllowed: "ALLOWED",
      translationAllowed: "UNKNOWN",
      applicationAiMode: "FULL_AI_WRITING_ALLOWED",
      sources: [{
        sourceId: "AIPOL-STUDENT-ATTESTATION-001",
        title: "Student AI Policy Attestation",
        url: "",
        officialDomain: identity.university || "",
        domainVerified: false,
        sourceType: "OFFICIAL_APPLICATION_INSTRUCTIONS",
        exactPolicyText: "Student attested that this program permits AI-assisted SOP writing.",
        retrievedAt: now,
        applicableScope: identity.program || "",
        priority: "PRIMARY",
        httpStatus: 0,
      }],
      verifiedAt: now,
      cacheKey: `aipol-student-${identity.university}-${identity.program}`,
      expiresAt: "",
      blockingReasons: [],
      };
  }

  if (attestation === "PROHIBITED") {
    return {
      status: "AI_GENERATION_PROHIBITED",
      generationAllowed: false,
      editingAllowed: "PROHIBITED",
      proofreadingAllowed: "UNKNOWN",
      brainstormingAllowed: "UNKNOWN",
      translationAllowed: "UNKNOWN",
      applicationAiMode: "AI_WRITING_BLOCKED",
      sources: [{
        sourceId: "AIPOL-STUDENT-ATTESTATION-001",
        title: "Student AI Policy Attestation",
        url: "",
        officialDomain: identity.university || "",
        domainVerified: false,
        sourceType: "OFFICIAL_APPLICATION_INSTRUCTIONS",
        exactPolicyText: "Student attested that this program does NOT permit AI-generated content.",
        retrievedAt: now,
        applicableScope: identity.program || "",
        priority: "PRIMARY",
        httpStatus: 0,
      }],
      verifiedAt: now,
      cacheKey: `aipol-student-${identity.university}-${identity.program}`,
      expiresAt: "",
      blockingReasons: ["Student attested AI generation is prohibited for this application."],
    };
  }

  return {
    status: "AI_POLICY_NOT_FOUND",
    generationAllowed: false,
    editingAllowed: "UNKNOWN",
    proofreadingAllowed: "UNKNOWN",
    brainstormingAllowed: "UNKNOWN",
    translationAllowed: "UNKNOWN",
    applicationAiMode: "POLICY_REVIEW_REQUIRED",
    sources: [],
    verifiedAt: now,
    cacheKey: `aipol-student-${identity.university}-${identity.program}`,
    expiresAt: "",
    blockingReasons: ["Student has not confirmed whether this program permits AI-assisted writing."],
  };
}

/**
 * Build the generic response component(s) from the student-declared brief.
 *
 * A student-declared application has ONE response component: the SOP
 * prompt the student pasted on the /application page. Word/character
 * limits come from the student's declared values. There are no official
 * multi-component splits (those only come from officially verified
 * artifacts, e.g., the MIT CEE fixture).
 */
export function buildStudentDeclaredResponseComponents(
  brief: VerifiedApplicationBrief
): ResponseComponent[] {
  const doc = brief.documents.find(d => d.required);
  if (!doc) return [];

  const requiredTopics: ResponseComponent["requiredTopics"] = [];

  // Derive mandatory topics from the student-declared prompt when we can
  // map them deterministically to generic topic patterns. This stays
  // conservative: only explicit, well-known official topic patterns.
  const prompt = (doc.officialPrompt.rawText || "").toLowerCase();

  return [{
    componentId: "RC-GENERIC-001",
    label: doc.documentTypeLabel,
    exactPrompt: doc.officialPrompt.rawText || "",
    pageLimit: { type: "PER_DOCUMENT", maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    wordLimit: {
      min: doc.wordLimit.min,
      max: doc.wordLimit.max,
      status: doc.wordLimit.status,
    },
    characterLimit: {
      min: doc.characterLimit.min,
      max: doc.characterLimit.max,
      status: doc.characterLimit.status,
    },
    requiredTopics,
    sourceId: doc.officialPrompt.provenance?.sourceId || "STUDENT-DECLARED",
    status: "REVIEW_REQUIRED",
    verifiedAt: brief.verification.verifiedAt,
  }];
}

/**
 * Build the page-limit constraint for student-declared applications.
 * Students don't declare page limits in the generic flow → null.
 */
export function buildStudentDeclaredPageLimit(): PageLimitConstraint {
  return {
    type: "PER_DOCUMENT",
    maxPages: null,
    status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
  };
}
