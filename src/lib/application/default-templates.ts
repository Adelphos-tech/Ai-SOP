// ============================================================
// D-VIVID DEFAULT TEMPLATES
// Phase SOP-AI-32
// ============================================================
// When no manual prompt is provided, no saved requirement exists
// in the D-Vivid Requirements DB, and official discovery finds
// no useful information, the system falls back to a D-Vivid
// default template for that document type.
//
// These templates are generic, university-agnostic, and
// evidence-constrained. They do NOT invent university-specific
// requirements. They provide a sensible starting structure
// so generation can proceed without an official prompt.
// ============================================================

import { DocumentType } from "./application-types";

export interface DefaultTemplate {
  documentType: DocumentType;
  label: string;
  promptText: string;
  wordMin?: number;
  wordMax?: number;
  pageLimit?: number;
  specialInstructions?: string;
  formattingInstructions?: string;
}

export const DVIVID_DEFAULT_TEMPLATES: Record<DocumentType, DefaultTemplate> = {
  STATEMENT_OF_PURPOSE: {
    documentType: "STATEMENT_OF_PURPOSE",
    label: "Statement of Purpose (D-Vivid Default)",
    promptText: `Write a Statement of Purpose for graduate admission.

Structure your essay around the following sections:

1. Academic Background & Motivation
   - Your undergraduate degree and key academic achievements.
   - What sparked your interest in this field.

2. Research & Professional Experience
   - Relevant projects, internships, or work experience.
   - Specific technical skills or methodologies you have applied.

3. Why This Program
   - Which aspects of the program align with your goals.
   - Specific faculty, labs, courses, or research areas of interest (if known).

4. Career Goals
   - Your short-term and long-term career objectives.
   - How this degree will help you achieve them.

5. Why You
   - Unique perspectives, challenges overcome, or contributions you bring.

Guidelines:
- Be specific and factual. Avoid vague claims.
- Use concrete examples from your experience.
- Maintain a professional, confident tone.
- Do not fabricate facts, awards, or experiences.`,
    wordMin: 800,
    wordMax: 1000,
    specialInstructions: "Focus on academic and professional fit. Avoid personal anecdotes unless directly relevant to research motivation.",
    formattingInstructions: "Standard 12pt font, 1-inch margins, double-spaced.",
  },

  ESSAY: {
    documentType: "ESSAY",
    label: "Essay (D-Vivid Default)",
    promptText: `Write an application essay responding to the following general prompt:

Describe a significant challenge you have faced and how you overcame it. What did you learn from this experience, and how will it shape your approach to graduate study?

Guidelines:
- Use a specific, real example from your experience.
- Reflect on what you learned, not just what happened.
- Connect your experience to your readiness for graduate study.
- Be honest and factual. Do not embellish or fabricate.`,
    wordMin: 500,
    wordMax: 750,
    specialInstructions: "Focus on personal growth and resilience. Connect to academic readiness.",
    formattingInstructions: "Standard 12pt font, 1-inch margins, double-spaced.",
  },

  SUPPLEMENTAL_QUESTION: {
    documentType: "SUPPLEMENTAL_QUESTION",
    label: "Supplemental Question (D-Vivid Default)",
    promptText: `Write a response to a supplemental application question.

Since no specific supplemental question was provided by the university, address the following general prompt:

Why are you applying to this specific program, and what unique perspective or experience do you bring that will enrich the cohort?

Guidelines:
- Reference specific aspects of the program (if known).
- Highlight a unique perspective, background, or experience.
- Be concise and direct.
- Do not fabricate program details.`,
    wordMin: 250,
    wordMax: 500,
    specialInstructions: "Be concise. Focus on fit and unique contribution.",
    formattingInstructions: "Standard 12pt font, 1-inch margins.",
  },

  MOA: {
    documentType: "MOA",
    label: "MOA (D-Vivid Default)",
    promptText: `Write a Memorandum of Agreement (MOA) cover letter for your application.

Address the following:
1. Your understanding of the program's requirements and expectations.
2. Your commitment to meeting academic and professional standards.
3. Your agreement to the program's policies and procedures.

Guidelines:
- Be formal and professional.
- Reference only policies you have actually reviewed.
- Do not fabricate specific program policies.`,
    wordMin: 300,
    wordMax: 500,
    specialInstructions: "Formal tone. Reference only verified policies.",
    formattingInstructions: "Standard 12pt font, 1-inch margins.",
  },

  PERSONAL_STATEMENT: {
    documentType: "PERSONAL_STATEMENT",
    label: "Personal Statement (D-Vivid Default)",
    promptText: `Write a Personal Statement for graduate admission.

Structure your statement around:

1. Your Personal Journey
   - Key experiences that shaped your academic and career path.
   - Challenges or turning points that defined your direction.

2. Your Academic Interests
   - What specific areas of study excite you.
   - How your background prepares you for these areas.

3. Your Goals
   - What you hope to achieve during and after graduate study.
   - How this program fits into your larger vision.

Guidelines:
- Be authentic and reflective.
- Use specific, real experiences.
- Balance personal narrative with academic focus.
- Do not fabricate experiences or achievements.`,
    wordMin: 500,
    wordMax: 1000,
    specialInstructions: "Balance personal narrative with academic focus. Be authentic.",
    formattingInstructions: "Standard 12pt font, 1-inch margins, double-spaced.",
  },

  STATEMENT_OF_ACADEMIC_PURPOSE: {
    documentType: "STATEMENT_OF_ACADEMIC_PURPOSE",
    label: "Statement of Academic Purpose (D-Vivid Default)",
    promptText: `Write a Statement of Academic Purpose for graduate admission.

Focus specifically on your academic and research interests:

1. Academic Background
   - Your undergraduate/graduate training and key coursework.
   - Research experience, if any.

2. Research Interests
   - Specific areas or questions you want to explore.
   - Methodologies or approaches you find compelling.

3. Fit with the Program
   - How the program's faculty, labs, or curriculum align with your interests.
   - Specific courses or research groups of interest (if known).

4. Future Academic Goals
   - What you hope to accomplish academically during the program.
   - Long-term research or academic career goals.

Guidelines:
- Be specific about research interests.
- Do not include personal biography unless directly relevant to research.
- Do not fabricate research experience or faculty connections.`,
    wordMin: 500,
    wordMax: 1000,
    specialInstructions: "Focus strictly on academic and research interests. Minimize personal narrative.",
    formattingInstructions: "Standard 12pt font, 1-inch margins, double-spaced.",
  },

  LETTER_OF_MOTIVATION: {
    documentType: "LETTER_OF_MOTIVATION",
    label: "Letter of Motivation (D-Vivid Default)",
    promptText: `Write a Letter of Motivation for your application.

Address the following:

1. Motivation for This Program
   - What specifically motivates you to apply to this program.
   - Why this field and why now.

2. Your Preparation
   - Academic and professional background that prepares you.
   - Key skills or experiences relevant to the program.

3. What You Hope to Gain
   - Specific knowledge, skills, or experiences you seek.
   - How this connects to your career aspirations.

4. What You Bring
   - Unique perspectives, experiences, or contributions.

Guidelines:
- Be enthusiastic but grounded in facts.
- Use specific examples.
- Do not fabricate experiences.`,
    wordMin: 400,
    wordMax: 800,
    specialInstructions: "Enthusiastic but factual. Focus on motivation and fit.",
    formattingInstructions: "Standard 12pt font, 1-inch margins.",
  },

  VISA_SOP: {
    documentType: "VISA_SOP",
    label: "Visa SOP (D-Vivid Default)",
    promptText: `Write a Visa Statement of Purpose for your student visa application.

Address the following:

1. Your Background
   - Brief academic and professional summary.
   - Your current status and qualifications.

2. Why This Country & Institution
   - Why you chose to study in this country.
   - Why this specific institution and program.

3. Your Study Plan
   - What you will study and for how long.
   - How this fits your career progression.

4. Ties to Home Country
   - Family, property, or career ties that demonstrate intent to return.
   - Long-term career plans in your home country.

5. Financial Support
   - How you will fund your studies (if applicable).

Guidelines:
- Be factual and honest.
- Demonstrate clear intent to return home after studies.
- Do not fabricate financial details or ties.`,
    wordMin: 800,
    wordMax: 1200,
    specialInstructions: "Demonstrate strong home-country ties. Be factual about finances and plans.",
    formattingInstructions: "Standard 12pt font, 1-inch margins, single or 1.5 spacing.",
  },

  COVER_LETTER: {
    documentType: "COVER_LETTER",
    label: "Cover Letter (D-Vivid Default)",
    promptText: `Write a Cover Letter for your application.

Address the following:

1. Introduction
   - What you are applying for.
   - Brief summary of who you are.

2. Your Qualifications
   - Key academic and professional qualifications.
   - Specific experiences relevant to the program or position.

3. Why You Are Interested
   - What draws you to this program/position.
   - How it aligns with your goals.

4. Closing
   - Reiterate your interest.
   - Express readiness for next steps.

Guidelines:
- Be concise and professional.
- Use specific examples.
- Do not fabricate qualifications or experiences.`,
    wordMin: 300,
    wordMax: 500,
    specialInstructions: "Concise and professional. Focus on qualifications and fit.",
    formattingInstructions: "Standard business letter format, 12pt font, 1-inch margins.",
  },

  LETTER_OF_RECOMMENDATION: {
    documentType: "LETTER_OF_RECOMMENDATION",
    label: "Letter of Recommendation (D-Vivid Default)",
    promptText: `Note: Letters of Recommendation are typically written by referees, not applicants.

If you are drafting a self-assessment or recommendation input document, address:

1. How long and in what capacity the referee has known you.
2. Your academic or professional performance and specific achievements.
3. Your strengths relative to peers.
4. Areas of growth or development.
5. Specific examples that illustrate your qualities.

Guidelines:
- Provide factual, specific information for your referee to use.
- Do not fabricate achievements or relationships.
- This is input for a referee, not a final recommendation letter.`,
    wordMin: 300,
    wordMax: 600,
    specialInstructions: "This is input for a referee, not a final letter. Provide factual information.",
    formattingInstructions: "Standard 12pt font, 1-inch margins.",
  },

  CUSTOM: {
    documentType: "CUSTOM",
    label: "Custom Document (D-Vivid Default)",
    promptText: `Write a custom application document.

Since no specific prompt was provided, write a general application document that:

1. Introduces your background and qualifications.
2. Explains your interest in the program.
3. Describes your relevant experience.
4. Outlines your goals.

Guidelines:
- Be specific and factual.
- Use concrete examples.
- Do not fabricate experiences or achievements.
- If you have specific instructions from the university, replace this default text with those instructions.`,
    wordMin: 500,
    wordMax: 1000,
    specialInstructions: "Replace with university-specific instructions if available.",
    formattingInstructions: "Standard 12pt font, 1-inch margins.",
  },
};

export function getDefaultTemplate(documentType: DocumentType): DefaultTemplate {
  return DVIVID_DEFAULT_TEMPLATES[documentType] || DVIVID_DEFAULT_TEMPLATES.CUSTOM;
}

export function hasDefaultTemplate(documentType: string): boolean {
  return documentType in DVIVID_DEFAULT_TEMPLATES;
}
