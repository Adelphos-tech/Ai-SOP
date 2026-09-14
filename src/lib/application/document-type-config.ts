// ============================================================
// DOCUMENT TYPE CONFIGURATION
// Phase SOP-AI-33
// ============================================================
// Lightweight configuration layer for document-writing behavior.
// Different document types change: instructions, structure,
// rubric, tone, required evidence, format constraints.
// NOT the number of AI stages.
// ============================================================

import { DocumentType } from "./application-types";

export type WritingPerspective =
  | "FIRST_PERSON_STUDENT"
  | "FIRST_PERSON_APPLICANT"
  | "FIRST_PERSON_RECOMMENDER"
  | "PROMPT_DEPENDENT";

export interface DocumentTypeConfig {
  documentType: DocumentType;
  displayName: string;
  writingPerspective: WritingPerspective;
  /** Default structural guidance when no official prompt is available */
  defaultStructure: string;
  /** Quality rubric items specific to this document type */
  qualityRubric: string[];
  /** Student evidence categories relevant to this document type */
  studentEvidenceCategories: string[];
  /** Tone guidance */
  toneGuidance: string;
  /** Whether program-fit discussion is normally relevant */
  programFitRelevant: boolean;
  /** Whether recommender perspective is required (LOR) */
  recommenderPerspectiveRequired: boolean;
  /** Whether visa-specific evidence is relevant */
  visaSpecificEvidence: boolean;
  /** Whether the document should primarily answer the supplied question */
  promptFirst: boolean;
  /** Special safety notes for the writer */
  safetyNotes: string[];
}

export const DOCUMENT_TYPE_CONFIGS: Record<DocumentType, DocumentTypeConfig> = {
  STATEMENT_OF_PURPOSE: {
    documentType: "STATEMENT_OF_PURPOSE",
    displayName: "Statement of Purpose",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Academic Background & Motivation\n2. Research & Professional Experience\n3. Why This Program\n4. Career Goals\n5. Why You",
    qualityRubric: [
      "Academic preparation and motivation",
      "Research/professional experience relevance",
      "Program fit (specific, not generic)",
      "Career goal clarity and feasibility",
      "Personal voice and authenticity",
      "Factual discipline (no invented claims)",
    ],
    studentEvidenceCategories: ["education", "experience", "projects", "research", "careerGoals", "personalStory"],
    toneGuidance: "Professional, confident, and personal. Balance academic focus with authentic voice.",
    programFitRelevant: true,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Do not invent faculty relationships not in the evidence",
      "Do not fabricate research outcomes or publications",
    ],
  },

  ESSAY: {
    documentType: "ESSAY",
    displayName: "Essay",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "Answer the supplied question directly with specific, real examples.",
    qualityRubric: [
      "Direct response to the supplied question",
      "Specific, real examples (not generic)",
      "Reflection and insight",
      "Personal voice",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["personalStory", "experience", "projects", "achievements"],
    toneGuidance: "Reflective, authentic, and direct. Answer the question asked.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: true,
    safetyNotes: [
      "Answer the specific question asked — do not default to SOP structure",
      "Do not fabricate experiences or challenges",
    ],
  },

  SUPPLEMENTAL_QUESTION: {
    documentType: "SUPPLEMENTAL_QUESTION",
    displayName: "Supplemental Question",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "Answer the supplied question concisely with specific evidence.",
    qualityRubric: [
      "Direct response to the question",
      "Specific evidence and examples",
      "Conciseness",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["experience", "projects", "achievements", "careerGoals"],
    toneGuidance: "Concise and direct. Focus on answering the specific question.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: true,
    safetyNotes: [
      "Answer the specific question — do not write a full SOP",
      "Do not fabricate experiences",
    ],
  },

  MOA: {
    documentType: "MOA",
    displayName: "MOA",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Understanding of program requirements\n2. Commitment to standards\n3. Agreement to policies",
    qualityRubric: [
      "Understanding of program requirements",
      "Commitment clarity",
      "Professional tone",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["education", "careerGoals"],
    toneGuidance: "Formal and professional.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Reference only policies that have been verified",
      "Do not fabricate specific program policies",
    ],
  },

  PERSONAL_STATEMENT: {
    documentType: "PERSONAL_STATEMENT",
    displayName: "Personal Statement",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Personal journey\n2. Academic interests\n3. Goals and vision",
    qualityRubric: [
      "Personal narrative authenticity",
      "Academic interest clarity",
      "Goal articulation",
      "Balance of personal and academic",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["personalStory", "education", "experience", "careerGoals"],
    toneGuidance: "Authentic, reflective, and personal. Balance narrative with academic focus.",
    programFitRelevant: true,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Do not fabricate personal experiences or challenges",
      "Do not invent life events",
    ],
  },

  STATEMENT_OF_ACADEMIC_PURPOSE: {
    documentType: "STATEMENT_OF_ACADEMIC_PURPOSE",
    displayName: "Statement of Academic Purpose",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Academic background\n2. Research interests\n3. Fit with program\n4. Future academic goals",
    qualityRubric: [
      "Academic and research focus",
      "Research interest specificity",
      "Program fit (academic, not personal)",
      "Future academic goal clarity",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["education", "research", "projects", "publications", "careerGoals"],
    toneGuidance: "Academic and focused. Minimize personal narrative unless directly relevant to research.",
    programFitRelevant: true,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Focus on academic/research interests, not personal biography",
      "Do not fabricate research experience or faculty connections",
    ],
  },

  LETTER_OF_MOTIVATION: {
    documentType: "LETTER_OF_MOTIVATION",
    displayName: "Letter of Motivation",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Motivation for this program\n2. Your preparation\n3. What you hope to gain\n4. What you bring",
    qualityRubric: [
      "Motivation clarity and specificity",
      "Preparation evidence",
      "Goal articulation",
      "Unique contribution",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["education", "experience", "projects", "careerGoals", "personalStory"],
    toneGuidance: "Enthusiastic but grounded in facts. Professional and motivated.",
    programFitRelevant: true,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Do not fabricate motivation that isn't supported by evidence",
      "Do not invent experiences",
    ],
  },

  VISA_SOP: {
    documentType: "VISA_SOP",
    displayName: "Visa SOP",
    writingPerspective: "FIRST_PERSON_STUDENT",
    defaultStructure: "1. Background\n2. Why this country & institution\n3. Study plan\n4. Ties to home country\n5. Financial support",
    qualityRubric: [
      "Coherent study rationale",
      "Factual consistency",
      "Home-country ties demonstration",
      "Financial clarity (if applicable)",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["education", "careerGoals", "personalStory"],
    toneGuidance: "Factual, clear, and honest. Demonstrate genuine intent to study and return home.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: true,
    promptFirst: false,
    safetyNotes: [
      "Do not manufacture financial assets or family obligations",
      "Do not fabricate property, employment guarantees, or immigration intent",
      "Do not invent home-country ties not in the evidence",
    ],
  },

  COVER_LETTER: {
    documentType: "COVER_LETTER",
    displayName: "Cover Letter",
    writingPerspective: "FIRST_PERSON_APPLICANT",
    defaultStructure: "1. Introduction\n2. Qualifications\n3. Why interested\n4. Closing",
    qualityRubric: [
      "Qualification relevance",
      "Specific experience examples",
      "Interest articulation",
      "Professional tone",
      "Factual discipline",
    ],
    studentEvidenceCategories: ["experience", "achievements", "education", "careerGoals"],
    toneGuidance: "Professional, concise, and confident. Business letter tone.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Do not fabricate job achievements or employer relationships",
      "Do not invent metrics or outcomes not in the evidence",
    ],
  },

  LETTER_OF_RECOMMENDATION: {
    documentType: "LETTER_OF_RECOMMENDATION",
    displayName: "Letter of Recommendation",
    writingPerspective: "FIRST_PERSON_RECOMMENDER",
    defaultStructure: "1. Relationship context\n2. Academic/professional performance\n3. Specific qualities with examples\n4. Comparative assessment\n5. Recommendation strength",
    qualityRubric: [
      "Relationship credibility",
      "Specific examples (not generic)",
      "Candidate qualities articulation",
      "Recommendation strength justification",
      "Recommender voice authenticity",
      "Factual discipline (no fabricated observations)",
    ],
    studentEvidenceCategories: ["education", "experience", "projects", "achievements"],
    toneGuidance: "Professional, specific, and credible. Written from the recommender's perspective.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: true,
    visaSpecificEvidence: false,
    promptFirst: false,
    safetyNotes: [
      "Do NOT fabricate recommender opinions or observations",
      "Do not invent relationship duration, courses taught, performance rankings, or personal observations",
      "Do not invent recommendation strength not supported by evidence",
      "If insufficient recommender context exists, return MISSING_REQUIRED_STUDENT_INFORMATION",
    ],
  },

  CUSTOM: {
    documentType: "CUSTOM",
    displayName: "Custom Document",
    writingPerspective: "PROMPT_DEPENDENT",
    defaultStructure: "Follow the consultant's instructions.",
    qualityRubric: [
      "Adherence to supplied instructions",
      "Factual discipline",
      "Professional tone",
    ],
    studentEvidenceCategories: ["education", "experience", "projects", "research", "achievements", "careerGoals", "personalStory"],
    toneGuidance: "Follow the supplied instructions. Professional tone.",
    programFitRelevant: false,
    recommenderPerspectiveRequired: false,
    visaSpecificEvidence: false,
    promptFirst: true,
    safetyNotes: [
      "Follow the consultant's instructions precisely",
      "Do not fabricate experiences or achievements",
    ],
  },
};

export function getDocumentTypeConfig(documentType: string): DocumentTypeConfig {
  return DOCUMENT_TYPE_CONFIGS[documentType as DocumentType] || DOCUMENT_TYPE_CONFIGS.CUSTOM;
}

export function getWritingPerspectiveLabel(perspective: WritingPerspective): string {
  switch (perspective) {
    case "FIRST_PERSON_STUDENT": return "First person (student)";
    case "FIRST_PERSON_APPLICANT": return "First person (applicant)";
    case "FIRST_PERSON_RECOMMENDER": return "First person (recommender)";
    case "PROMPT_DEPENDENT": return "Depends on prompt";
  }
}

/**
 * Build the writing instructions string for the pipeline prompts.
 * This is injected into the Writer prompt's writingInstructions field.
 */
export function buildWritingInstructions(config: DocumentTypeConfig): string {
  const parts: string[] = [];

  parts.push(`DOCUMENT TYPE: ${config.displayName}`);
  parts.push(`WRITING PERSPECTIVE: ${getWritingPerspectiveLabel(config.writingPerspective)}`);

  if (config.writingPerspective === "FIRST_PERSON_RECOMMENDER") {
    parts.push("CRITICAL: This document is written from the RECOMMENDER's perspective, NOT the student's. Use 'I' to refer to the recommender, not the student.");
  }

  if (config.promptFirst) {
    parts.push("CRITICAL: Answer the supplied prompt/question directly. Do NOT default to a Statement of Purpose structure.");
  }

  if (!config.programFitRelevant) {
    parts.push("NOTE: Program fit discussion is NOT required for this document type. Do not force it unless the prompt explicitly asks.");
  }

  if (config.visaSpecificEvidence) {
    parts.push("VISA SAFETY: Use only approved evidence regarding study rationale, academic history, program selection, career plans, financial/support context, and home-country/future plans. Do not manufacture financial assets, family obligations, property, employment guarantees, or immigration intent.");
  }

  if (config.recommenderPerspectiveRequired) {
    parts.push("RECOMMENDER SAFETY: Do NOT fabricate recommender opinions, relationship duration, courses taught, performance rankings, personal observations, or recommendation strength. If insufficient recommender context exists, indicate MISSING_REQUIRED_STUDENT_INFORMATION.");
  }

  if (config.safetyNotes.length > 0) {
    parts.push("SAFETY NOTES:");
    for (const note of config.safetyNotes) {
      parts.push(`- ${note}`);
    }
  }

  parts.push(`DEFAULT STRUCTURE (when no official prompt specifies otherwise): ${config.defaultStructure}`);

  return parts.join("\n");
}

/**
 * Build the quality rubric string for the Quality Reviewer prompt.
 */
export function buildQualityRubricInstructions(config: DocumentTypeConfig): string {
  const rubricItems = config.qualityRubric.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return `DOCUMENT-TYPE-SPECIFIC RUBRIC (${config.displayName}):\n${rubricItems}\n\nEvaluate the document against this rubric, NOT a generic SOP rubric.`;
}
