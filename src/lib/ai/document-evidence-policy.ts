/**
 * @file document-evidence-policy.ts
 * @description
 * Document-Specific Evidence Selection — ONE central policy layer that
 * derives a document-specific evidence packet from the canonical evidence
 * ledger, WITHOUT duplicating canonical facts or adding an AI stage.
 *
 * Flow:
 *   Full Canonical Evidence Ledger (unchanged, canonical)
 *        ↓
 *   DocumentEvidencePolicy(documentType)
 *        ↓
 *   DocumentEvidencePacket  →  Planner / Writer / Quality Reviewer
 *
 * The Final Fact Reviewer continues to receive the FULL canonical evidence
 * ledger for factual verification (handled by the pipeline, not here).
 *
 * IMPORTANT: `requiredForQuality` is ADVISORY metadata. It is NOT a generation
 * gate. Missing HIGH/MEDIUM/LOW evidence must NEVER fail generation. Only the
 * existing legitimate minimum-data gates (e.g. no usable student information
 * at all) remain fatal — those live in the pipeline, not here.
 *
 * Phase SOP-AI: Document-Specific Evidence Selection.
 */

import type { EvidenceLedger, EvidenceEntry } from "./evidence-ledger";
import type { DocumentType } from "@/lib/application/application-types";

// ============================================================
// PRIORITY + SEMANTIC CATEGORIES
// ============================================================

export type EvidencePriority = "HIGH" | "MEDIUM" | "LOW" | "EXCLUDE";

/**
 * Semantic evidence categories used by the policy registry. These are
 * derived deterministically from the existing canonical ledger entry IDs /
 * source strings — they do NOT duplicate canonical facts. They only classify
 * existing entries so a per-document-type policy can prioritize them.
 */
export type SemanticEvidenceCategory =
  | "personalData"
  | "education"
  | "experience"
  | "projects"
  | "research"
  | "publications"
  | "skills"
  | "achievements"
  | "certifications"
  | "fieldMotivation"
  | "mastersMotivation"
  | "countryQuestionnaire"
  | "careerGoals"
  | "personalStory"
  | "recommenderContext"
  | "visaEvidence"
  | "applicationData"
  | "programEvidence"
  | "facultyEvidence"
  | "officialRequirements"
  | "documentPrompt"
  | "consultantInstruction"
  | "englishProficiency"
  | "writingPreferences"
  | "other";

// ============================================================
// POLICY TYPES
// ============================================================

export interface DocumentEvidencePolicy {
  /** Per semantic category priority. Categories not listed default to LOW. */
  categories: Partial<Record<SemanticEvidenceCategory, EvidencePriority>>;
  /** Optional max items per category (applied AFTER priority selection). */
  maxItems?: Partial<Record<SemanticEvidenceCategory, number>>;
  /** Selection strategy hint for the packet builder. */
  selectionStrategy?: "PRIORITY_THEN_ORDER" | "RELEVANCE_FIRST";
  /**
   * Advisory flags — these are NOT generation gates. They only mark which
   * categories the policy considers important for quality when present.
   * Absence of a requiredForQuality category must NOT fail generation.
   */
  requiredForQuality?: SemanticEvidenceCategory[];
}

// ============================================================
// CENTRAL POLICY REGISTRY
// ============================================================

export const DOCUMENT_EVIDENCE_POLICIES: Record<DocumentType, DocumentEvidencePolicy> = {
  // ------------------------------------------------------------
  // VISA SOP — study-purpose + post-study intentions focused.
  // Professional evidence is SELECTIVE, not exhaustive.
  // ------------------------------------------------------------
  VISA_SOP: {
    categories: {
      personalData: "HIGH",
      education: "HIGH",
      mastersMotivation: "HIGH",
      countryQuestionnaire: "HIGH",
      careerGoals: "HIGH",
      applicationData: "HIGH",
      programEvidence: "HIGH",
      facultyEvidence: "MEDIUM",
      visaEvidence: "HIGH",
      fieldMotivation: "MEDIUM",
      experience: "MEDIUM",
      achievements: "LOW",
      skills: "EXCLUDE",
      projects: "LOW",
      research: "EXCLUDE",
      publications: "EXCLUDE",
      certifications: "EXCLUDE",
      personalStory: "EXCLUDE",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      other: "LOW",
    },
    maxItems: {
      // Prefer the most relevant 1–2 experience groups — enough to establish
      // career progression and explain why further study is needed.
      experience: 2,
      // At most 1 project, only if it helps explain a knowledge gap or study
      // motivation. Do not include projects simply because they exist.
      projects: 1,
      // At most 1 achievement, only if it establishes study rationale.
      achievements: 1,
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [
      "education", "mastersMotivation", "countryQuestionnaire",
      "careerGoals", "visaEvidence",
    ],
  },

  // ------------------------------------------------------------
  // STATEMENT OF PURPOSE — broader academic/professional context.
  // Must NOT become too narrow through filtering.
  // ------------------------------------------------------------
  STATEMENT_OF_PURPOSE: {
    categories: {
      personalData: "HIGH",
      education: "HIGH",
      experience: "HIGH",
      projects: "HIGH",
      fieldMotivation: "HIGH",
      mastersMotivation: "HIGH",
      careerGoals: "HIGH",
      programEvidence: "HIGH",
      facultyEvidence: "HIGH",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      applicationData: "HIGH",
      skills: "MEDIUM",
      achievements: "MEDIUM",
      certifications: "MEDIUM",
      countryQuestionnaire: "MEDIUM",
      research: "MEDIUM",
      publications: "MEDIUM",
      personalStory: "MEDIUM",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [
      "education", "experience", "projects", "fieldMotivation",
      "mastersMotivation", "careerGoals", "programEvidence",
    ],
  },

  // ------------------------------------------------------------
  // LETTER OF MOTIVATION
  // ------------------------------------------------------------
  LETTER_OF_MOTIVATION: {
    categories: {
      personalData: "HIGH",
      fieldMotivation: "HIGH",
      mastersMotivation: "HIGH",
      education: "HIGH",
      experience: "HIGH",
      programEvidence: "HIGH",
      facultyEvidence: "HIGH",
      careerGoals: "HIGH",
      applicationData: "HIGH",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      projects: "MEDIUM",
      achievements: "MEDIUM",
      skills: "MEDIUM",
      research: "MEDIUM",
      publications: "MEDIUM",
      personalStory: "MEDIUM",
      countryQuestionnaire: "LOW",
      certifications: "LOW",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [
      "fieldMotivation", "mastersMotivation", "education",
      "experience", "careerGoals", "programEvidence",
    ],
  },

  // ------------------------------------------------------------
  // PERSONAL STATEMENT — narrative, not CV-style dumping.
  // ------------------------------------------------------------
  PERSONAL_STATEMENT: {
    categories: {
      personalData: "HIGH",
      personalStory: "HIGH",
      fieldMotivation: "HIGH",
      mastersMotivation: "HIGH",
      education: "HIGH",
      experience: "HIGH",
      careerGoals: "HIGH",
      programEvidence: "MEDIUM",
      facultyEvidence: "MEDIUM",
      applicationData: "MEDIUM",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      projects: "MEDIUM",
      achievements: "MEDIUM",
      skills: "LOW",
      research: "LOW",
      publications: "LOW",
      certifications: "LOW",
      countryQuestionnaire: "LOW",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: ["personalStory", "fieldMotivation", "mastersMotivation", "education", "careerGoals"],
  },

  // ------------------------------------------------------------
  // STATEMENT OF ACADEMIC PURPOSE — academic/research focus.
  // ------------------------------------------------------------
  STATEMENT_OF_ACADEMIC_PURPOSE: {
    categories: {
      personalData: "HIGH",
      education: "HIGH",
      research: "HIGH",
      projects: "HIGH",
      skills: "HIGH",
      programEvidence: "HIGH",
      facultyEvidence: "HIGH",
      careerGoals: "HIGH",
      mastersMotivation: "HIGH",
      fieldMotivation: "HIGH",
      applicationData: "HIGH",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      publications: "MEDIUM",
      experience: "MEDIUM",
      achievements: "MEDIUM",
      personalStory: "LOW",
      countryQuestionnaire: "LOW",
      certifications: "LOW",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [
      "education", "research", "projects", "skills",
      "programEvidence", "careerGoals",
    ],
  },

  // ------------------------------------------------------------
  // LETTER OF RECOMMENDATION — recommender-known evidence ONLY.
  // Visa/country/private motivations EXCLUDED by default.
  // ------------------------------------------------------------
  LETTER_OF_RECOMMENDATION: {
    categories: {
      personalData: "HIGH",
      recommenderContext: "HIGH",
      education: "MEDIUM",
      experience: "MEDIUM",
      projects: "MEDIUM",
      achievements: "MEDIUM",
      applicationData: "MEDIUM",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      programEvidence: "LOW",
      facultyEvidence: "LOW",
      skills: "LOW",
      research: "LOW",
      publications: "LOW",
      certifications: "LOW",
      personalStory: "LOW",
      englishProficiency: "EXCLUDE",
      writingPreferences: "EXCLUDE",
      fieldMotivation: "EXCLUDE",
      mastersMotivation: "EXCLUDE",
      countryQuestionnaire: "EXCLUDE",
      careerGoals: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "LOW",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: ["recommenderContext"],
  },

  // ------------------------------------------------------------
  // ESSAY — question-focused. General profile evidence only when relevant.
  // ------------------------------------------------------------
  ESSAY: {
    categories: {
      personalData: "MEDIUM",
      personalStory: "HIGH",
      experience: "MEDIUM",
      projects: "MEDIUM",
      achievements: "MEDIUM",
      education: "MEDIUM",
      careerGoals: "MEDIUM",
      fieldMotivation: "MEDIUM",
      mastersMotivation: "LOW",
      countryQuestionnaire: "LOW",
      programEvidence: "LOW",
      facultyEvidence: "LOW",
      applicationData: "MEDIUM",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      skills: "LOW",
      research: "LOW",
      publications: "LOW",
      certifications: "LOW",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [],
  },

  // ------------------------------------------------------------
  // SUPPLEMENTAL QUESTION — narrowest packet.
  // ------------------------------------------------------------
  SUPPLEMENTAL_QUESTION: {
    categories: {
      personalData: "LOW",
      personalStory: "MEDIUM",
      experience: "MEDIUM",
      projects: "MEDIUM",
      achievements: "MEDIUM",
      education: "LOW",
      careerGoals: "LOW",
      fieldMotivation: "LOW",
      mastersMotivation: "EXCLUDE",
      countryQuestionnaire: "EXCLUDE",
      programEvidence: "LOW",
      facultyEvidence: "LOW",
      applicationData: "MEDIUM",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      skills: "LOW",
      research: "LOW",
      publications: "LOW",
      certifications: "LOW",
      englishProficiency: "EXCLUDE",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "LOW",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [],
  },

  // ------------------------------------------------------------
  // COVER LETTER — job-relevant. No masters/visa/country.
  // ------------------------------------------------------------
  COVER_LETTER: {
    categories: {
      personalData: "HIGH",
      experience: "HIGH",
      skills: "HIGH",
      achievements: "HIGH",
      projects: "HIGH",
      careerGoals: "HIGH",
      education: "MEDIUM",
      certifications: "MEDIUM",
      applicationData: "MEDIUM",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      fieldMotivation: "EXCLUDE",
      mastersMotivation: "EXCLUDE",
      countryQuestionnaire: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      programEvidence: "EXCLUDE",
      facultyEvidence: "EXCLUDE",
      research: "EXCLUDE",
      publications: "EXCLUDE",
      personalStory: "EXCLUDE",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: ["experience", "skills", "achievements", "projects"],
  },

  // ------------------------------------------------------------
  // MOA — Memorandum of Agreement (per existing product meaning).
  // ------------------------------------------------------------
  MOA: {
    categories: {
      personalData: "HIGH",
      education: "HIGH",
      careerGoals: "HIGH",
      applicationData: "HIGH",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      programEvidence: "MEDIUM",
      experience: "LOW",
      projects: "LOW",
      skills: "LOW",
      achievements: "LOW",
      research: "EXCLUDE",
      publications: "EXCLUDE",
      certifications: "LOW",
      fieldMotivation: "EXCLUDE",
      mastersMotivation: "EXCLUDE",
      countryQuestionnaire: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      facultyEvidence: "LOW",
      personalStory: "EXCLUDE",
      englishProficiency: "EXCLUDE",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      other: "LOW",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [],
  },

  // ------------------------------------------------------------
  // CUSTOM — flexible; conservative broader packet, not blind dump.
  // ------------------------------------------------------------
  CUSTOM: {
    categories: {
      personalData: "HIGH",
      education: "HIGH",
      experience: "HIGH",
      projects: "HIGH",
      research: "MEDIUM",
      publications: "MEDIUM",
      achievements: "HIGH",
      skills: "HIGH",
      certifications: "MEDIUM",
      fieldMotivation: "HIGH",
      mastersMotivation: "HIGH",
      countryQuestionnaire: "MEDIUM",
      careerGoals: "HIGH",
      personalStory: "MEDIUM",
      applicationData: "HIGH",
      programEvidence: "HIGH",
      facultyEvidence: "HIGH",
      officialRequirements: "HIGH",
      documentPrompt: "HIGH",
      consultantInstruction: "HIGH",
      englishProficiency: "LOW",
      writingPreferences: "EXCLUDE",
      recommenderContext: "EXCLUDE",
      visaEvidence: "EXCLUDE",
      other: "MEDIUM",
    },
    selectionStrategy: "PRIORITY_THEN_ORDER",
    requiredForQuality: [],
  },
};

export function getDocumentEvidencePolicy(documentType: string): DocumentEvidencePolicy {
  return DOCUMENT_EVIDENCE_POLICIES[documentType as DocumentType]
    || DOCUMENT_EVIDENCE_POLICIES.CUSTOM;
}

// ============================================================
// DETERMINISTIC CLASSIFIER
// Maps existing canonical ledger entries → semantic category.
// No new facts, no schema change to EvidenceEntry.
// ============================================================

/**
 * Classify a canonical ledger entry into a semantic category using its
 * stable ID prefix and source string. This is deterministic and never
 * duplicates facts — it only labels existing entries.
 */
export function classifyEvidenceEntry(entry: EvidenceEntry): SemanticEvidenceCategory {
  const id = entry.id;
  const source = entry.source || "";

  // Program / faculty / application-specific facts bypass student-fact
  // priority filtering — they are document/program requirements, not
  // applicant evidence, and must still reach stages per existing contract.
  if (id === "PF-CONTEXT" || source.startsWith("programContext")) return "programEvidence";
  if (id.startsWith("FF-") || source.startsWith("facultyAlignment")) return "facultyEvidence";
  if (id.startsWith("AF-") || source.startsWith("applicationSpecificFacts[")) return "applicationData";
  if (id.startsWith("SF-APP-") || source.startsWith("studentFacts.applicationSpecificFacts")) return "applicationData";

  // Student-fact semantic classification by stable ID prefix
  if (id.startsWith("SF-EDU-") || source.startsWith("studentFacts.education")) return "education";
  if (id.startsWith("SF-EXP-") || source.startsWith("studentFacts.experience")) return "experience";
  if (id.startsWith("SF-PROJ-") || source.startsWith("studentFacts.projects")) return "projects";
  if (id.startsWith("SF-RES-") || source.startsWith("studentFacts.research")) return "research";
  if (id.startsWith("SF-PUB-") || source.startsWith("studentFacts.publications")) return "publications";
  if (id.startsWith("SF-ACH-") || source.startsWith("studentFacts.achievements")) return "achievements";
  if (id.startsWith("SF-CHALLENGE-PROJECT-") || id.startsWith("SF-PROJECT-MOTIVATION-") || source.startsWith("studentFacts.projectClarifications")) return "projects";
  if (id.startsWith("SF-MOTIVATION-") || source.startsWith("studentFacts.mastersMotivation")) return "mastersMotivation";
  if (id.startsWith("SF-COUNTRY-") || source.startsWith("studentFacts.countryQuestionnaire")) return "countryQuestionnaire";
  if (id.startsWith("SF-CAREER-") || source.startsWith("studentFacts.careerGoalsStructured")) return "careerGoals";
  if (id === "SF-CAREER" || source.startsWith("studentFacts.careerGoals")) return "careerGoals";
  if (id === "SF-PERSONAL" || source.startsWith("studentFacts.personalDetails")) return "personalData";
  if (id === "SF-STORY" || source.startsWith("studentFacts.personalStory")) return "personalStory";
  if (id === "SF-SKILLS" || source.startsWith("studentFacts.skills")) return "skills";
  if (id === "SF-ENGLISH" || source.startsWith("studentFacts.englishProficiency")) return "englishProficiency";
  if (id === "SF-WRITING-ENGLISH" || source.startsWith("studentFacts.writingPreferences")) return "writingPreferences";

  // Recommender context — detected via source/profile field, not a stable
  // SF- prefix today (the ledger does not emit a dedicated recommender entry
  // yet). When present in application-specific facts it is classified above.
  if (source.toLowerCase().includes("recommender")) return "recommenderContext";

  // Visa evidence — country questionnaire + masters motivation + return-home
  // career goals are the canonical visa-relevant signals. They are classified
  // to their primary semantic category above; "visaEvidence" is a derived
  // cross-cutting signal handled by the policy's requiredForQuality, not a
  // separate ledger entry. We do NOT invent visa facts here.
  return "other";
}

/**
 * Whether a semantic category is a "document requirement" category that
 * must bypass student-fact priority filtering (always included).
 */
function isRequirementCategory(cat: SemanticEvidenceCategory): boolean {
  return (
    cat === "programEvidence" ||
    cat === "facultyEvidence" ||
    cat === "applicationData" ||
    cat === "officialRequirements" ||
    cat === "documentPrompt" ||
    cat === "consultantInstruction"
  );
}

// ============================================================
// DOCUMENT EVIDENCE PACKET
// ============================================================

export interface DocumentEvidenceSelection {
  entry: EvidenceEntry;
  semanticCategory: SemanticEvidenceCategory;
  priority: EvidencePriority;
}

export interface DocumentEvidencePacket {
  documentType: DocumentType;
  /** Selected entries (HIGH + MEDIUM + LOW, after maxItems), preserving original IDs/text/source */
  selectedEvidence: DocumentEvidenceSelection[];
  /** Excluded entries (EXCLUDE priority, or dropped by maxItems) */
  excludedEvidence: DocumentEvidenceSelection[];
  /** Full canonical ledger reference — unchanged, for Fact Reviewer / checkpoints */
  fullLedger: EvidenceLedger;
  selectionSummary: {
    fullCount: number;
    selectedCount: number;
    excludedCount: number;
    byPriority: Record<EvidencePriority, number>;
    byCategory: Partial<Record<SemanticEvidenceCategory, number>>;
  };
  /** Stable hash of the selected entry IDs (for checkpoint validity) */
  packetHash: string;
  policyVersion: string;
}

// ============================================================
// PACKET BUILDER
// ============================================================

/**
 * Build a document-specific evidence packet from the full canonical ledger.
 *
 * - Requirement categories (program/faculty/application/official/prompt/
 *   consultant) ALWAYS pass through — they are document requirements, not
 *   applicant evidence, and must not be filtered by student-fact priority.
 * - Student-fact categories are selected by the document-type policy priority.
 * - maxItems caps the number of entries per category AFTER priority selection.
 * - Selection is deterministic: priority order, then original ledger order.
 * - Original evidence IDs / canonicalText / source are preserved verbatim.
 * - No facts are duplicated or invented.
 */
export function buildDocumentEvidencePacket(args: {
  documentType: string;
  fullEvidenceLedger: EvidenceLedger;
}): DocumentEvidencePacket {
  const policy = getDocumentEvidencePolicy(args.documentType);
  const ledger = args.fullEvidenceLedger;
  const documentType = (args.documentType as DocumentType) || "CUSTOM";

  const selected: DocumentEvidenceSelection[] = [];
  const excluded: DocumentEvidenceSelection[] = [];
  const byPriority: Record<EvidencePriority, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, EXCLUDE: 0 };
  const byCategory: Partial<Record<SemanticEvidenceCategory, number>> = {};

  // First pass: classify + assign priority
  const classified: Array<{ sel: DocumentEvidenceSelection; isRequirement: boolean }> = [];
  for (const entry of ledger.allEntries) {
    const semanticCategory = classifyEvidenceEntry(entry);
    const isRequirement = isRequirementCategory(semanticCategory);
    // Requirement categories always HIGH-equivalent pass-through; they are
    // not subject to student-fact priority filtering.
    const priority: EvidencePriority = isRequirement
      ? "HIGH"
      : (policy.categories[semanticCategory] ?? "LOW");
    classified.push({
      sel: { entry, semanticCategory, priority },
      isRequirement,
    });
  }

  // Second pass: apply maxItems per category (deterministic — original order)
  const perCategoryCount: Record<string, number> = {};
  for (const { sel, isRequirement } of classified) {
    const catKey = String(sel.semanticCategory);
    perCategoryCount[catKey] = perCategoryCount[catKey] || 0;

    if (sel.priority === "EXCLUDE") {
      excluded.push(sel);
      byPriority.EXCLUDE++;
      continue;
    }

    const cap = isRequirement ? undefined : policy.maxItems?.[sel.semanticCategory];
    if (cap !== undefined && perCategoryCount[catKey] >= cap) {
      // Dropped by maxItems — record as excluded (not EXCLUDE priority, but
      // excluded by selection cap). We keep it in excludedEvidence with its
      // original priority so diagnostics can distinguish.
      excluded.push(sel);
      continue;
    }

    perCategoryCount[catKey]++;
    selected.push(sel);
    byPriority[sel.priority]++;
    byCategory[sel.semanticCategory] = (byCategory[sel.semanticCategory] || 0) + 1;
  }

  const selectedIds = selected.map(s => s.entry.id).sort();
  const packetHash = hashPacket(documentType, selectedIds);

  return {
    documentType,
    selectedEvidence: selected,
    excludedEvidence: excluded,
    fullLedger: ledger,
    selectionSummary: {
      fullCount: ledger.allEntries.length,
      selectedCount: selected.length,
      excludedCount: excluded.length,
      byPriority,
      byCategory,
    },
    packetHash,
    policyVersion: "document-evidence-policy-v1",
  };
}

// ============================================================
// TEXT FORMATTERS (mirror application-evidence-bundle format)
// ============================================================

/**
 * Format the selected evidence into the SAME text representation used by
 * the existing `studentFactsText` formatter — but only including selected
 * entries. This is what Planner / Writer / QR receive instead of the full
 * `studentFactsText`.
 *
 * Format is intentionally identical so prompt templates need no change.
 */
export function formatDocumentEvidencePacketText(packet: DocumentEvidencePacket): string {
  const lines: string[] = [];
  const ledger = packet.fullLedger;
  const selectedIds = new Set(packet.selectedEvidence.map(s => s.entry.id));

  if (ledger.studentFacts.length > 0) {
    const visible = ledger.studentFacts.filter(e => selectedIds.has(e.id));
    if (visible.length > 0) {
      lines.push("STUDENT FACTS:");
      for (const entry of visible) {
        lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
      }
    }
  }

  if (ledger.programFacts.length > 0) {
    const visible = ledger.programFacts.filter(e => selectedIds.has(e.id));
    if (visible.length > 0) {
      lines.push("");
      lines.push("PROGRAM FACTS:");
      for (const entry of visible) {
        lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
      }
    }
  }

  if (ledger.facultyFacts.length > 0) {
    const visible = ledger.facultyFacts.filter(e => selectedIds.has(e.id));
    if (visible.length > 0) {
      lines.push("");
      lines.push("FACULTY FACTS (student-approved):");
      for (const entry of visible) {
        lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
      }
    }
  }

  if (ledger.applicationSpecificFacts.length > 0) {
    const visible = ledger.applicationSpecificFacts.filter(e => selectedIds.has(e.id));
    if (visible.length > 0) {
      lines.push("");
      lines.push("APPLICATION-SPECIFIC FACTS:");
      for (const entry of visible) {
        lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Build a filtered EvidenceLedger view containing ONLY the selected entries,
 * preserving the original EvidenceLedger shape. Used to feed
 * buildComponentEvidencePackets() so Writer packets are also filtered.
 *
 * The full ledger remains available on the packet (`fullLedger`) for the
 * Final Fact Reviewer and checkpoints.
 */
export function buildFilteredLedgerView(packet: DocumentEvidencePacket): EvidenceLedger {
  const selectedIds = new Set(packet.selectedEvidence.map(s => s.entry.id));
  const ledger = packet.fullLedger;
  const studentFacts = ledger.studentFacts.filter(e => selectedIds.has(e.id));
  const programFacts = ledger.programFacts.filter(e => selectedIds.has(e.id));
  const facultyFacts = ledger.facultyFacts.filter(e => selectedIds.has(e.id));
  const applicationSpecificFacts = ledger.applicationSpecificFacts.filter(e => selectedIds.has(e.id));
  const allEntries = [...studentFacts, ...programFacts, ...facultyFacts, ...applicationSpecificFacts];
  return {
    studentFacts,
    programFacts,
    facultyFacts,
    applicationSpecificFacts,
    allEntries,
    // Preserve the ORIGINAL canonical ledger hash — the full ledger is the
    // canonical world. The filtered view is a derived projection.
    ledgerHash: ledger.ledgerHash,
  };
}

/**
 * Build a Finalizer-specific ledger view that contains:
 *   1. The document-specific filtered packet entries (same scope as Writer/QR)
 *   2. PLUS any repair-authorized evidence IDs from the action plan's
 *      topicEvidence (explicitly needed for repair actions)
 *
 * This prevents the Finalizer PROMPT from receiving an unrestricted full-ledger
 * dump while still allowing authorized repairs. The full canonical ledger
 * remains stored internally for audit/checkpoints/provenance and is still
 * available to the Final Fact Reviewer.
 *
 * The returned ledger preserves the original canonical `ledgerHash` so the
 * Finalizer's action-plan hash check continues to pass.
 */
export function buildFinalizerLedgerView(
  packet: DocumentEvidencePacket,
  repairAuthorizedIds?: string[],
): EvidenceLedger {
  const filteredView = buildFilteredLedgerView(packet);
  const filteredIds = new Set(filteredView.allEntries.map(e => e.id));

  // Add repair-authorized IDs that are in the canonical ledger but not in
  // the filtered packet. These are explicitly needed for repair actions.
  const repairIds = repairAuthorizedIds || [];
  const additionalEntries: EvidenceEntry[] = [];
  for (const id of repairIds) {
    if (!filteredIds.has(id)) {
      const entry = packet.fullLedger.allEntries.find(e => e.id === id);
      if (entry) additionalEntries.push(entry);
    }
  }

  if (additionalEntries.length === 0) {
    return filteredView;
  }

  // Merge additional entries into the appropriate category arrays
  const studentFacts = [...filteredView.studentFacts];
  const programFacts = [...filteredView.programFacts];
  const facultyFacts = [...filteredView.facultyFacts];
  const applicationSpecificFacts = [...filteredView.applicationSpecificFacts];
  for (const entry of additionalEntries) {
    if (entry.category === "student") studentFacts.push(entry);
    else if (entry.category === "program") programFacts.push(entry);
    else if (entry.category === "faculty") facultyFacts.push(entry);
    else applicationSpecificFacts.push(entry);
  }
  const allEntries = [...studentFacts, ...programFacts, ...facultyFacts, ...applicationSpecificFacts];

  return {
    studentFacts,
    programFacts,
    facultyFacts,
    applicationSpecificFacts,
    allEntries,
    ledgerHash: packet.fullLedger.ledgerHash,
  };
}

// ============================================================
// DIAGNOSTIC RENDERER (for preflight / debugging only)
// Does NOT expose sensitive raw evidence in normal UI.
// ============================================================

export function renderDocumentEvidencePacketDiagnostics(packet: DocumentEvidencePacket): string {
  const s = packet.selectionSummary;
  const lines: string[] = [];
  lines.push("Document Evidence Packet");
  lines.push("");
  lines.push(`Document Type: ${packet.documentType}`);
  lines.push(`Full evidence: ${s.fullCount}`);
  lines.push(`Selected: ${s.selectedCount}`);
  lines.push(`Excluded: ${s.excludedCount}`);
  lines.push("");
  const byPri: Record<EvidencePriority, DocumentEvidenceSelection[]> = {
    HIGH: [], MEDIUM: [], LOW: [], EXCLUDE: [],
  };
  for (const sel of packet.selectedEvidence) byPri[sel.priority].push(sel);
  for (const sel of packet.excludedEvidence) {
    if (sel.priority === "EXCLUDE") byPri.EXCLUDE.push(sel);
  }
  for (const pri of ["HIGH", "MEDIUM", "LOW", "EXCLUDE"] as EvidencePriority[]) {
    lines.push(`${pri}:`);
    for (const sel of byPri[pri]) {
      // Show ID + category only — not raw canonical text (avoid leaking
      // sensitive evidence in diagnostics).
      lines.push(`  ${sel.entry.id} [${sel.semanticCategory}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================
// HASH
// ============================================================

import { createHash } from "node:crypto";

function hashPacket(documentType: string, selectedIds: string[]): string {
  const text = JSON.stringify({ documentType, selectedIds });
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}
