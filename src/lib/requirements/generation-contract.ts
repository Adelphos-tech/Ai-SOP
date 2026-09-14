/**
 * @file generation-contract.ts
 * @description
 * Server-side Generation Contract builder.
 *
 * The OpenAI writing pipeline may run ONLY from a Generation Contract
 * produced by this module. The browser must NOT construct it directly.
 *
 * Hard generation conditions — contract creation fails unless:
 *   - Fact Sheet Approved = true
 *   - Requirements Verification Gate = PASS
 *   - AI Usage Policy allows FULL AI writing
 *   - No unresolved official-source conflict
 *   - Required application identity is verified
 *
 * PHASE SOP-AI-4 additions:
 *   - Response components (multiple questions within one document)
 *   - Page limit metadata (NOT converted to word limits)
 *   - Faculty alignment approval model
 *   - Per-component required topic mapping
 *   - Faculty requirement materiality check
 */

import {
  GenerationContract,
  ContractBuildResult,
  ContractBuildStatus,
  ContractWritingRequirement,
  ContractLanguageProfile,
  MissingRequiredInfo,
  VerifiedProgramContext,
  ResponseComponent,
  PageLimitConstraint,
  FacultyAlignment,
  FacultyAlignmentStatus,
} from "./generation-contract-types";
import { VerifiedApplicationBrief, DocumentRequirement } from "./types";
import { AiUsagePolicy } from "./ai-policy-types";
import { mapRequiredTopicsToStudentFacts, hasMaterialMissingInfo } from "./planner-relevance";
import * as crypto from "crypto";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function generateContractId(): string {
  return "GC-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);
}

/**
 * Phase 21: Compute a deterministic semantic hash of the contract.
 * Excludes volatile runtime fields (contractId, createdAt, contractSemanticHash).
 * This hash is used for checkpoint validity and golden integrity —
 * it must be identical for semantically identical inputs regardless
 * of when the contract was built or what random ID was assigned.
 *
 * Semantic content includes:
 *   - student facts
 *   - application identity
 *   - writing requirement
 *   - response components (ORDERED — sequence is semantically meaningful)
 *   - page limit
 *   - program context
 *   - country guidance
 *   - language profile
 *   - faculty alignment (SET-LIKE — sorted by facultyName for determinism)
 *   - verification status
 *   - clearedForWriting
 *   - blockingReasons (ORDERED — sequence matters for error reporting)
 *
 * Excluded volatile fields:
 *   - contractId (Date.now + Math.random)
 *   - createdAt (ISO timestamp)
 *   - contractSemanticHash (self-reference)
 */
export function computeContractSemanticHash(contract: GenerationContract): string {
  const { contractId, createdAt, contractSemanticHash, ...semantic } = contract;
  // Sort facultyAlignment by facultyName for determinism (SET-LIKE collection)
  const normalized = {
    ...semantic,
    facultyAlignment: [...semantic.facultyAlignment].sort((a, b) =>
      a.facultyName.localeCompare(b.facultyName)
    ),
  };
  const canonical = (item: any): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  };
  return crypto.createHash("sha256").update(canonical(JSON.parse(JSON.stringify(normalized)))).digest("hex");
}

function extractWritingRequirement(
  brief: VerifiedApplicationBrief,
  responseComponents?: ResponseComponent[]
): ContractWritingRequirement | null {
  const doc = brief.documents.find(d => d.required);
  if (!doc) return null;

  return {
    documentType: doc.documentType,
    documentTypeLabel: doc.documentTypeLabel,
    officialPrompt: doc.officialPrompt.rawText,
    officialPromptStatus: doc.officialPrompt.status,
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
    requiredTopics: doc.requiredTopics.map(t => t.value as string).filter(Boolean),
    formatInstructions: doc.formatInstructions.map(f => f.value as string).filter(Boolean),
    additionalQuestions: doc.additionalQuestions.map(q => q.value as string).filter(Boolean),
    sourceId: doc.officialPrompt.provenance?.sourceId || null,
    responseComponentCount: responseComponents?.length || 1,
  };
}

function extractLanguageProfile(profile: any): ContractLanguageProfile {
  const wp = profile?.writingPreferences?.sopWritingProfile || {};
  const ep = profile?.englishProficiency || {};
  return {
    testType: ep.testType || "",
    overallScore: ep.overallScore || "",
    writingScore: ep.writing || "",
    desiredProfile: wp.level || "Natural Professional",
    tone: wp.tone || "Professional & Personal",
    personalization: wp.personalization || "Balanced",
    technicalDetail: wp.technicalDetail || "Medium",
    openingStyle: wp.openingStyle || "Let AI Choose Best Opening",
  };
}

/* ------------------------------------------------------------------ */
/* Faculty alignment check                                            */
/* ------------------------------------------------------------------ */

/**
 * Check if any response component requires student-specific faculty alignment.
 * Returns the list of components that require it.
 */
function getComponentsRequiringFacultyAlignment(
  responseComponents: ResponseComponent[]
): ResponseComponent[] {
  return responseComponents.filter(rc =>
    rc.requiredTopics.some(t =>
      t.requiresStudentSpecificFact === true && t.studentFactType === "FACULTY_ALIGNMENT"
    )
  );
}

/**
 * Check if the student has approved faculty alignment.
 * Only STUDENT_APPROVED alignments count as student preferences.
 */
function hasApprovedFacultyAlignment(
  facultyAlignment: FacultyAlignment[]
): boolean {
  return facultyAlignment.some(fa => fa.status === "STUDENT_APPROVED");
}

/**
 * Check if the student has research interests that could support faculty alignment.
 */
function hasStudentResearchInterests(profile: any): boolean {
  const cg = profile?.careerGoals;
  if (!cg) return false;
  // Check if the student has expressed research interests
  const whyField = cg.whyField || "";
  const whyProgram = cg.whyProgram || "";
  return whyField.trim().length > 10 || whyProgram.trim().length > 10;
}

/* ------------------------------------------------------------------ */
/* Check for missing faculty alignment (material)                      */
/* ------------------------------------------------------------------ */
function checkFacultyAlignmentMissing(
  responseComponents: ResponseComponent[],
  facultyAlignment: FacultyAlignment[],
  profile: any
): { missing: boolean; reason: string; missingFields: string[] } {
  const componentsNeedingFaculty = getComponentsRequiringFacultyAlignment(responseComponents);

  if (componentsNeedingFaculty.length === 0) {
    return { missing: false, reason: "", missingFields: [] };
  }

  // Check if student has approved faculty alignment
  if (hasApprovedFacultyAlignment(facultyAlignment)) {
    return { missing: false, reason: "", missingFields: [] };
  }

  // Faculty alignment is required but not approved
  const missingFields: string[] = [];

  if (!hasStudentResearchInterests(profile)) {
    missingFields.push("research interests");
  }
  missingFields.push("preferred research areas");
  missingFields.push("faculty/lab preferences");
  missingFields.push("student-approved faculty alignment");

  return {
    missing: true,
    reason: "Faculty alignment required: The official prompt requires the applicant to name faculty members with whom they would like to work. No student-approved faculty alignment exists.",
    missingFields,
  };
}

/* ------------------------------------------------------------------ */
/* Build Generation Contract                                           */
/* ------------------------------------------------------------------ */

export interface BuildContractOptions {
  responseComponents?: ResponseComponent[];
  pageLimit?: PageLimitConstraint;
  facultyAlignment?: FacultyAlignment[];
  programContext?: VerifiedProgramContext | null;
}

export function buildGenerationContract(
  profile: any,
  brief: VerifiedApplicationBrief | null,
  aiPolicy: AiUsagePolicy | null,
  optionsOrProgramContext?: VerifiedProgramContext | null | BuildContractOptions
): ContractBuildResult {
  // Handle both old signature (programContext) and new (options)
  let programContext: VerifiedProgramContext | null = null;
  let responseComponents: ResponseComponent[] = [];
  let pageLimit: PageLimitConstraint = {
    type: "PER_DOCUMENT",
    maxPages: null,
    status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
  };
  let facultyAlignment: FacultyAlignment[] = [];

  if (optionsOrProgramContext && typeof optionsOrProgramContext === "object" && "responseComponents" in optionsOrProgramContext) {
    const opts = optionsOrProgramContext as BuildContractOptions;
    programContext = opts.programContext || null;
    responseComponents = opts.responseComponents || [];
    pageLimit = opts.pageLimit || pageLimit;
    facultyAlignment = opts.facultyAlignment || [];
  } else {
    programContext = optionsOrProgramContext as VerifiedProgramContext | null;
  }

  const blockingReasons: string[] = [];
  const now = new Date().toISOString();

  // ===== CHECK 1: Fact Sheet Approved =====
  if (!profile?.factSheetApproval?.approved) {
    return {
      status: "FACT_SHEET_NOT_APPROVED",
      contract: null,
      blockingReasons: ["Fact sheet has not been approved."],
      missingRequiredInformation: [],
    };
  }

  // ===== CHECK 2: Requirements Verification Gate =====
  if (!brief) {
    return {
      status: "APPLICATION_REQUIREMENTS_UNVERIFIED",
      contract: null,
      blockingReasons: ["Official application requirements have not been verified."],
      missingRequiredInformation: [],
    };
  }

  if (brief.verification.status === "UNVERIFIED" || brief.verification.status === "BLOCKED") {
    return {
      status: "APPLICATION_REQUIREMENTS_UNVERIFIED",
      contract: null,
      blockingReasons: ["Official application requirements could not be verified."],
      missingRequiredInformation: [],
    };
  }

  if (brief.verification.status === "CONFLICT") {
    return {
      status: "APPLICATION_REQUIREMENT_CONFLICT",
      contract: null,
      blockingReasons: ["Unresolved official-source conflict in application requirements."],
      missingRequiredInformation: [],
    };
  }

  // ===== CHECK 3: AI Usage Policy Gate =====
  if (!aiPolicy) {
    return {
      status: "APPLICATION_AI_POLICY_BLOCK",
      contract: null,
      blockingReasons: ["AI usage policy has not been verified. Generation blocked."],
      missingRequiredInformation: [],
    };
  }

  if (!aiPolicy.generationAllowed) {
    return {
      status: "APPLICATION_AI_POLICY_BLOCK",
      contract: null,
      blockingReasons: aiPolicy.blockingReasons.length > 0
        ? aiPolicy.blockingReasons
        : ["AI usage policy blocks generation."],
      missingRequiredInformation: [],
    };
  }

  // ===== CHECK 4: Writing requirement exists =====
  const writingReq = extractWritingRequirement(brief, responseComponents);
  if (!writingReq) {
    return {
      status: "NO_WRITING_REQUIREMENT",
      contract: null,
      blockingReasons: ["No required writing document found in the verified application brief."],
      missingRequiredInformation: [],
    };
  }

  // ===== CHECK 5: Official prompt is verified =====
  if (writingReq.officialPromptStatus === "PORTAL_ONLY_UNAVAILABLE") {
    return {
      status: "PORTAL_ONLY_PROMPT",
      contract: null,
      blockingReasons: ["Official prompt is only available in the application portal."],
      missingRequiredInformation: [],
    };
  }

  if (writingReq.officialPromptStatus === "UNKNOWN") {
    return {
      status: "UNKNOWN_PROMPT",
      contract: null,
      blockingReasons: ["Official prompt is unknown."],
      missingRequiredInformation: [],
    };
  }

  // ===== CHECK 6: Missing required student information =====
  const topicMappings = mapRequiredTopicsToStudentFacts(writingReq.requiredTopics, profile);
  const missingInfo = topicMappings
    .filter(m => m.status !== "COVERED")
    .map(m => ({
      requiredTopic: m.requiredTopic,
      reason: m.reason,
      studentEvidenceFields: m.studentEvidence,
    }));

  const materialMissing = hasMaterialMissingInfo(topicMappings);

  // ===== CHECK 7: Faculty alignment check (PHASE SOP-AI-4) =====
  const facultyCheck = checkFacultyAlignmentMissing(responseComponents, facultyAlignment, profile);

  // Build the contract (even if missing info — but mark not cleared)
  const contract: GenerationContract = {
    contractId: generateContractId(),
    createdAt: now,
    contractSemanticHash: "", // Set below after full construction
    studentFacts: profile,
    application: brief.applicationIdentity,
    writingRequirement: writingReq,
    responseComponents,
    pageLimit,
    programContext,
    countryGuidance: brief.countryGuidance,
    languageProfile: extractLanguageProfile(profile),
    facultyAlignment,
    verification: {
      requirementsVerified: true,
      aiWritingAllowed: true,
      aiPolicyStatus: aiPolicy.status,
      conflicts: brief.verification.conflicts,
      factSheetApproved: true,
    },
    clearedForWriting: !materialMissing && !facultyCheck.missing,
    blockingReasons: [],
  };

  const allBlockingReasons: string[] = [];
  const allMissingInfo: MissingRequiredInfo[] = [...missingInfo];

  if (materialMissing) {
    allBlockingReasons.push("MISSING_REQUIRED_STUDENT_INFORMATION: Material required topics lack student evidence.");
  }

  if (facultyCheck.missing) {
    allBlockingReasons.push(`MISSING_REQUIRED_STUDENT_INFORMATION: ${facultyCheck.reason}`);
    allMissingInfo.push({
      requiredTopic: "Faculty alignment",
      reason: facultyCheck.reason,
      studentEvidenceFields: facultyCheck.missingFields,
    });
  }

  contract.blockingReasons = allBlockingReasons;
  contract.contractSemanticHash = computeContractSemanticHash(contract);

  if (allBlockingReasons.length > 0) {
    return {
      status: "MISSING_REQUIRED_STUDENT_INFORMATION",
      contract,
      blockingReasons: allBlockingReasons,
      missingRequiredInformation: allMissingInfo,
    };
  }

  // ===== CLEARED =====
  contract.contractSemanticHash = computeContractSemanticHash(contract);
  return {
    status: "CLEARED",
    contract,
    blockingReasons: [],
    missingRequiredInformation: [],
  };
}

/* ------------------------------------------------------------------ */
/* Validate contract (pre-flight check before OpenAI)                  */
/* ------------------------------------------------------------------ */

export function validateContractForWriting(contract: GenerationContract | null): {
  valid: boolean;
  reason: string | null;
} {
  if (!contract) {
    return { valid: false, reason: "No generation contract provided." };
  }
  if (!contract.clearedForWriting) {
    return {
      valid: false,
      reason: contract.blockingReasons[0] || "Contract not cleared for writing.",
    };
  }
  if (!contract.verification.requirementsVerified) {
    return { valid: false, reason: "Requirements not verified." };
  }
  if (!contract.verification.aiWritingAllowed) {
    return { valid: false, reason: "AI writing not allowed by policy." };
  }
  if (!contract.verification.factSheetApproved) {
    return { valid: false, reason: "Fact sheet not approved." };
  }
  // Check faculty alignment: any used must be STUDENT_APPROVED
  for (const fa of contract.facultyAlignment) {
    if (fa.status !== "STUDENT_APPROVED") {
      return {
        valid: false,
        reason: `Faculty alignment for ${fa.facultyName} is not student-approved (status: ${fa.status}).`,
      };
    }
  }
  return { valid: true, reason: null };
}
