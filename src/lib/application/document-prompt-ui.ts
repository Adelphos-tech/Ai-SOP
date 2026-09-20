// ============================================================
// DOCUMENT PROMPT UI CONFIG — single source for Add Document form
// ============================================================
// Prompt terminology varies by document type: a Visa SOP does not have a
// "university prompt", an Essay always needs an explicit question, etc.
// This config drives the label, placeholder, required rule, and which
// prompt-lookup actions are shown.
//
// Lookup capability note: the resolve-prompt backend ONLY searches
// university/program pages. Types whose prompts come from elsewhere
// (embassy, employer, consultant) get no lookup buttons — the UI must not
// pretend the university crawler covers their sources.
// ============================================================

import { DocumentType } from "./application-types";

export interface DocumentPromptUiConfig {
  label: string;
  placeholder: string;
  /** Whether an explicit prompt is required to create the document.
   *  When false and the prompt is blank, the server applies the existing
   *  D-Vivid default template for the type (unchanged resolution chain). */
  required: boolean;
  /** Label for the DB+auto-resolve lookup button, or null to hide it. */
  primaryLookupLabel: string | null;
  /** Label for the official-page discovery button, or null to hide it. */
  secondaryLookupLabel: string | null;
}

export const DOCUMENT_PROMPT_UI_CONFIG: Record<DocumentType, DocumentPromptUiConfig> = {
  STATEMENT_OF_PURPOSE: {
    label: "University / Application Prompt",
    placeholder: "Paste the exact prompt or question provided by the university or application portal.",
    required: true,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  VISA_SOP: {
    label: "Visa / Embassy Prompt",
    placeholder: "Paste any question or instructions provided by the embassy, consulate, visa portal, or consultant. Leave blank if no specific prompt was provided.",
    required: false,
    primaryLookupLabel: null,
    secondaryLookupLabel: null,
  },
  LETTER_OF_RECOMMENDATION: {
    label: "Recommendation Prompt / Instructions",
    placeholder: "Paste any recommendation-letter instructions or questions provided by the university, employer, or application portal.",
    required: false,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  LETTER_OF_MOTIVATION: {
    label: "Motivation Letter Prompt",
    placeholder: "Paste the exact motivation-letter prompt or instructions if provided.",
    required: false,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  PERSONAL_STATEMENT: {
    label: "Personal Statement Prompt",
    placeholder: "Paste the personal-statement prompt or question if one was provided.",
    required: false,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  STATEMENT_OF_ACADEMIC_PURPOSE: {
    label: "Academic Purpose Prompt",
    placeholder: "Paste the academic-purpose prompt or instructions provided by the institution.",
    required: false,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  ESSAY: {
    label: "Essay Question / Prompt",
    placeholder: "Paste the exact essay question.",
    required: true,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  SUPPLEMENTAL_QUESTION: {
    label: "Supplemental Question",
    placeholder: "Paste the exact supplemental question.",
    required: true,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
  COVER_LETTER: {
    label: "Job / Employer Requirements",
    placeholder: "Paste the job description, employer instructions, or cover-letter requirements.",
    required: false,
    primaryLookupLabel: null,
    secondaryLookupLabel: null,
  },
  CUSTOM: {
    label: "Document Prompt / Instructions",
    placeholder: "Describe what this document should address.",
    required: true,
    primaryLookupLabel: null,
    secondaryLookupLabel: null,
  },
  MOA: {
    label: "Memorandum of Agreement Instructions",
    placeholder: "Paste any MOA-related instructions provided by the institution, or leave blank to use the standard MOA cover-letter guidance.",
    required: false,
    primaryLookupLabel: "Find university prompt",
    secondaryLookupLabel: "Search official pages",
  },
};

export function getDocumentPromptUi(documentType: DocumentType): DocumentPromptUiConfig {
  return DOCUMENT_PROMPT_UI_CONFIG[documentType];
}

export function isPromptRequired(documentType: DocumentType): boolean {
  return DOCUMENT_PROMPT_UI_CONFIG[documentType].required;
}
