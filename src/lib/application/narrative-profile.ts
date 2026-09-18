/**
 * @file narrative-profile.ts
 * @description
 * DocumentNarrativeProfile — deterministic, per-document-type narrative
 * strategy. NOT an AI call. Resolved in code and injected as short
 * guidance rules into the Planner and Writer prompts.
 *
 * Phase COST-OPT: document-aware writing optimization.
 */

export type NarrativeStructureStyle =
  | "thematic"          // arc-driven, experiences serve the arc
  | "chronological"     // evidence-ordered progression
  | "question-first"    // answer the prompt immediately, support after
  | "perspective"       // written in another person's voice (LOR)
  | "conservative";     // prompt-led, minimal structure assumptions

export interface DocumentNarrativeProfile {
  structureStyle: NarrativeStructureStyle;
  /** experiences allowed full paragraph weight */
  maxAnchorExperiences: number;
  /** how much interpretive reflection is wanted */
  reflectionLevel: "high" | "medium" | "low" | "none";
  /** whether chronological ordering is preferred over thematic */
  chronologicalPreference: boolean;
  /** max named tools/technologies per paragraph */
  technicalEnumerationLimit: number;
  requireProgramFit: boolean;
  requireCareerGoals: boolean;
  /** visa-style return-home / funding logic */
  requireReturnHomeLogic: boolean;
  /** answer the question before providing context */
  directAnswerPriority: boolean;
  /** short planning rules for the Planner */
  plannerRules: string[];
  /** short writing rules for the Writer */
  writerRules: string[];
}

const SOP_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "thematic",
  maxAnchorExperiences: 3,
  reflectionLevel: "high",
  chronologicalPreference: false,
  technicalEnumerationLimit: 3,
  requireProgramFit: true,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Plan a thematic progression (motivation -> experimentation -> realization -> production experience -> knowledge gap -> program -> goals), not a chronological inventory.",
    "Select at most 3 anchor experiences for full development; demote the rest to single supporting mentions or omit.",
  ],
  writerRules: [
    "Select at most 2-3 anchor experiences. Do not convert every CV item into a paragraph.",
    "Mention tools only when they explain meaningful work. No skill-list or technology-enumeration paragraphs.",
    "Major experiences must contain significance or reflection, not a formulaic closing phrase.",
    "Prefer thematic continuity over chronological inventory.",
    "Avoid repeating the same abstract takeaway words (e.g., scalability, deployment, reliability, production) more than twice.",
  ],
};

const PERSONAL_STATEMENT_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "thematic",
  maxAnchorExperiences: 2,
  reflectionLevel: "high",
  chronologicalPreference: false,
  technicalEnumerationLimit: 1,
  requireProgramFit: false,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Center personal development: motivations, turning points, and growth. Technical details only where they carry the personal story.",
    "Select at most 2 anchor experiences.",
  ],
  writerRules: [
    "Emphasize personal growth, motivations, and turning points over technical inventory.",
    "Include at most 1 named tool/technology per paragraph, and only where meaningful.",
    "Each major experience must show what changed in the student's thinking or direction.",
  ],
};

const ACADEMIC_PURPOSE_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "thematic",
  maxAnchorExperiences: 3,
  reflectionLevel: "high",
  chronologicalPreference: false,
  technicalEnumerationLimit: 3,
  requireProgramFit: true,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Plan an intellectual progression: academic preparation -> research/technical interests -> deepening questions -> future academic direction.",
    "Prioritize research and technically substantive experiences as anchors.",
  ],
  writerRules: [
    "Emphasize academic preparation, research interests, and intellectual progression.",
    "Connect experiences to the questions they raised, not just the tasks performed.",
    "No skill-list paragraphs; tools appear only inside meaningful technical work.",
  ],
};

const MOTIVATION_LETTER_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "thematic",
  maxAnchorExperiences: 2,
  reflectionLevel: "medium",
  chronologicalPreference: false,
  technicalEnumerationLimit: 2,
  requireProgramFit: true,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Structure around: motivation -> preparation -> program fit -> future goals.",
    "Select at most 2 anchor experiences.",
  ],
  writerRules: [
    "Keep motivation and program fit central; experiences exist to support them.",
    "At most 2 named tools per paragraph.",
  ],
};

const VISA_SOP_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "chronological",
  maxAnchorExperiences: 3,
  reflectionLevel: "medium",
  chronologicalPreference: true,
  technicalEnumerationLimit: 2,
  requireProgramFit: true,
  requireCareerGoals: true,
  requireReturnHomeLogic: true,
  directAnswerPriority: true,
  plannerRules: [
    "Plan a clear evidence-based progression: study rationale -> country/program rationale -> preparation -> career and return-home logic.",
    "Clarity and verifiable logic matter more than literary storytelling.",
  ],
  writerRules: [
    "State study rationale and program fit plainly and early.",
    "Where supported by evidence, include career and return-home logic explicitly.",
    "Prioritize clarity and logical progression over narrative flourish.",
    "At most 2 named tools per paragraph.",
  ],
};

const LOR_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "perspective",
  maxAnchorExperiences: 3,
  reflectionLevel: "none",
  chronologicalPreference: false,
  technicalEnumerationLimit: 2,
  requireProgramFit: false,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Write from the recommender's perspective: observed traits, concrete examples, comparative judgment.",
    "No applicant-style introspection or first-person motivation.",
  ],
  writerRules: [
    "Maintain the recommender's voice throughout. The recommender observes; the applicant does not narrate feelings.",
    "Ground every trait claim in a concrete observed example from the evidence.",
    "Do not write applicant introspection (\"I felt\", \"I realized\") — describe observable behavior.",
  ],
};

const COVER_LETTER_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "question-first",
  maxAnchorExperiences: 2,
  reflectionLevel: "low",
  chronologicalPreference: false,
  technicalEnumerationLimit: 3,
  requireProgramFit: true,
  requireCareerGoals: false,
  requireReturnHomeLogic: false,
  directAnswerPriority: true,
  plannerRules: [
    "Lead with professional fit for the role; support with the 1-2 strongest relevant achievements.",
  ],
  writerRules: [
    "Open with the fit for the role/organization, not biography.",
    "Use only the strongest relevant achievements; concise over comprehensive.",
  ],
};

const ESSAY_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "question-first",
  maxAnchorExperiences: 2,
  reflectionLevel: "medium",
  chronologicalPreference: false,
  technicalEnumerationLimit: 2,
  requireProgramFit: false,
  requireCareerGoals: false,
  requireReturnHomeLogic: false,
  directAnswerPriority: true,
  plannerRules: [
    "Answer the exact question first; use only relevant background and normally 1-2 examples.",
  ],
  writerRules: [
    "Answer the question in the opening sentences, then support it.",
    "Use at most 1-2 examples. Do not provide full academic history unless relevant.",
  ],
};

const SUPPLEMENTAL_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "question-first",
  maxAnchorExperiences: 1,
  reflectionLevel: "low",
  chronologicalPreference: false,
  technicalEnumerationLimit: 1,
  requireProgramFit: false,
  requireCareerGoals: false,
  requireReturnHomeLogic: false,
  directAnswerPriority: true,
  plannerRules: [
    "The answer to the question comes first; minimal context; strict prompt compliance.",
  ],
  writerRules: [
    "Answer the question immediately. Use at most 1 supporting example.",
    "No full academic/professional history. No preamble.",
  ],
};

const MOA_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "conservative",
  maxAnchorExperiences: 2,
  reflectionLevel: "medium",
  chronologicalPreference: false,
  technicalEnumerationLimit: 2,
  requireProgramFit: true,
  requireCareerGoals: true,
  requireReturnHomeLogic: false,
  directAnswerPriority: false,
  plannerRules: [
    "Follow the existing MOA document structure; do not force an SOP-style narrative arc.",
  ],
  writerRules: [
    "Follow the MOA structure supplied in the writing instructions; do not invent an SOP arc.",
  ],
};

const CUSTOM_PROFILE: DocumentNarrativeProfile = {
  structureStyle: "conservative",
  maxAnchorExperiences: 2,
  reflectionLevel: "medium",
  chronologicalPreference: false,
  technicalEnumerationLimit: 3,
  requireProgramFit: false,
  requireCareerGoals: false,
  requireReturnHomeLogic: false,
  directAnswerPriority: true,
  plannerRules: [
    "Follow the supplied prompt exactly; keep structure conservative and prompt-led.",
  ],
  writerRules: [
    "Follow the supplied prompt exactly. Answer what is asked; avoid an assumed narrative structure.",
  ],
};

export const DOCUMENT_NARRATIVE_PROFILES: Record<string, DocumentNarrativeProfile> = {
  STATEMENT_OF_PURPOSE: SOP_PROFILE,
  PERSONAL_STATEMENT: PERSONAL_STATEMENT_PROFILE,
  STATEMENT_OF_ACADEMIC_PURPOSE: ACADEMIC_PURPOSE_PROFILE,
  LETTER_OF_MOTIVATION: MOTIVATION_LETTER_PROFILE,
  VISA_SOP: VISA_SOP_PROFILE,
  LETTER_OF_RECOMMENDATION: LOR_PROFILE,
  COVER_LETTER: COVER_LETTER_PROFILE,
  ESSAY: ESSAY_PROFILE,
  SUPPLEMENTAL_QUESTION: SUPPLEMENTAL_PROFILE,
  MOA: MOA_PROFILE,
  CUSTOM: CUSTOM_PROFILE,
};

export function getNarrativeProfile(documentType: string): DocumentNarrativeProfile {
  return DOCUMENT_NARRATIVE_PROFILES[documentType] || CUSTOM_PROFILE;
}

/* ------------------------------------------------------------------ */
/* VISA_SOP conditional return-home requirement                        */
/* ------------------------------------------------------------------ */

/** Values that mean "student provided no return-home information". */
const EMPTY_RETURN_HOME = /^\s*(nothing|none|no|n\/a|na|not applicable|-|\.)\s*$/i;

function hasValue(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && !EMPTY_RETURN_HOME.test(v);
}

/**
 * Deterministically detect whether the student's approved evidence
 * supports return-home content. Checks every field the intake and
 * adapter can populate — profile.careerGoals.returnPlans /
 * returnHomeCountry, structured longTerm.homeCountryPlans, the country
 * questionnaire, and explicit return statements inside career-goal text.
 *
 * Returns false for absent, empty, or negation values ("nothing") —
 * in that case return-home content must NOT be required or invented.
 */
export function detectReturnHomeEvidence(profile: any): boolean {
  if (!profile) return false;
  const cg = profile.careerGoals || {};
  const cgLong = (profile.careerGoalsStructured || cg).longTerm || {};
  const cq = profile.countryQuestionnaire || {};

  if (hasValue(cg.returnPlans)) return true;
  if (hasValue(cg.returnHomeCountry)) return true;
  if (hasValue(cgLong.homeCountryPlans)) return true;
  if (hasValue(cgLong.returnPlan)) return true;

  // Explicit return-home statements inside free-text career fields
  const returnIntent = /return\s+(to|home)|go\s+back|back\s+to\s+(india|my home|home country)|home.?country (career|plan|goal|ties)|plans?.{0,30}home country/i;
  for (const field of [cgLong.vision, cgLong.goals, cg.longTermGoals, cq.returnHomePlans, cq.homeCountryTies, cq.postStudyPlans]) {
    if (typeof field === "string" && returnIntent.test(field)) return true;
  }
  return false;
}

export const VISA_RETURN_HOME_TOPIC =
  "Post-study return-home plan or home-country career plan";

/**
 * Resolved profile for a concrete generation. For VISA_SOP the
 * return-home requirement is conditional on supported evidence:
 *   evidence present  -> requirement injected, stronger rules
 *   evidence absent   -> explicitly NOT required (prevents invention)
 * Other document types resolve to their static profile unchanged.
 */
export interface ResolvedNarrativeProfile {
  profile: DocumentNarrativeProfile;
  returnHomeRequired: boolean;
}

export function resolveNarrativeProfile(
  documentType: string,
  profile?: any
): ResolvedNarrativeProfile {
  const base = getNarrativeProfile(documentType);
  if (documentType !== "VISA_SOP") {
    return { profile: base, returnHomeRequired: false };
  }
  const supported = detectReturnHomeEvidence(profile);
  if (!supported) {
    return {
      profile: {
        ...base,
        requireReturnHomeLogic: false,
        writerRules: [
          ...base.writerRules,
          "Do NOT include a return-home or home-country plan — no supported evidence exists for it.",
        ],
      },
      returnHomeRequired: false,
    };
  }
  return {
    profile: {
      ...base,
      requireReturnHomeLogic: true,
      plannerRules: [
        ...base.plannerRules,
        `REQUIRED: plan coverage of the return-home/home-country plan — it is supported by approved evidence.`,
      ],
      writerRules: [
        ...base.writerRules,
        "REQUIRED: include the return-home/home-country career plan using ONLY the approved evidence. Do not omit it during any stage.",
      ],
    },
    returnHomeRequired: true,
  };
}

/**
 * Inject the return-home required topic into a response component list.
 * Status "RECOMMENDED" is deliberate: it flows through Planner prompts,
 * Writer rcDesc, Quality Reviewer topicCoverage, and the Finalizer's
 * requiredTopics, but is NOT a mandatory official topic — so the
 * pre-generation mandatory-topic evidence gate marks it NOT_APPLICABLE
 * and never blocks generation on it.
 */
export function applyVisaReturnHomeRequirement(
  responseComponents: Array<{ requiredTopics: Array<{ topic: string; status: string; sourceId: string; sourceQuote: string }> & Record<string, any> } & Record<string, any>>
): void {
  for (const rc of responseComponents) {
    if (!rc.requiredTopics.some(t => t.topic === VISA_RETURN_HOME_TOPIC)) {
      rc.requiredTopics.push({
        topic: VISA_RETURN_HOME_TOPIC,
        status: "RECOMMENDED",
        sourceId: "narrative-profile",
        sourceQuote: "Visa SOP narrative profile — supported return-home evidence detected",
      } as any);
    }
  }
}

/** Compact planner guidance — only the rules, not the whole profile. */
export function buildNarrativePlannerGuidance(profile: DocumentNarrativeProfile): string {
  return `NARRATIVE STRUCTURE PROFILE (${profile.structureStyle}):\n${profile.plannerRules.map(r => `- ${r}`).join("\n")}`;
}

/** Compact writer rules — only the rules, not the whole profile. */
export function buildNarrativeWriterRules(profile: DocumentNarrativeProfile): string {
  return `NARRATIVE QUALITY RULES:\n${profile.writerRules.map(r => `- ${r}`).join("\n")}`;
}
