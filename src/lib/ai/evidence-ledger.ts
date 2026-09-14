/**
 * @file evidence-ledger.ts
 * @description
 * Evidence Ledger — the compact, server-side factual boundary for Finalizer.
 *
 * The Evidence Ledger is the ONLY factual evidence available to the Finalizer.
 * It is built from the Generation Contract's student facts, program facts,
 * faculty facts, and application-specific facts.
 *
 * The Finalizer may NOT create a factual proposition that is not supported by:
 *   - existing component text
 *   - Evidence Ledger
 */

import { createHash } from "node:crypto";
import type { StudentProfile } from "@/types";
import type { FacultyAlignment } from "@/lib/requirements/generation-contract-types";

export type EvidenceCategory =
  | "student"
  | "program"
  | "faculty"
  | "application_specific";

export interface EvidenceEntry {
  id: string;
  canonicalText: string;
  category: EvidenceCategory;
  source?: string;
}

export interface EvidenceLedger {
  studentFacts: EvidenceEntry[];
  programFacts: EvidenceEntry[];
  facultyFacts: EvidenceEntry[];
  applicationSpecificFacts: EvidenceEntry[];
  /** All entries combined for lookup */
  allEntries: EvidenceEntry[];
  /** Hash of the ledger for checkpoint validity */
  ledgerHash: string;
}

export type StudentFactsInput = {
  [K in keyof StudentProfile]?: StudentProfile[K] extends Array<infer R> ? Partial<R>[] : Partial<StudentProfile[K]>;
} & { applicationSpecificFacts?: unknown; projectClarifications?: unknown[] };

function approvedValue(value: unknown, key = ""): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (["faculty", "facultyalignment", "facultypreferences"].includes(key.toLowerCase()) && typeof value !== "object") return undefined;
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    const items = value.map(item => approvedValue(item, key)).filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if ((key.toLowerCase().includes("faculty") || "facultyName" in record) && record.status !== "STUDENT_APPROVED") return undefined;
  if (record.status === "PROPOSED" || record.status === "REJECTED") return undefined;
  const fields = Object.keys(record).sort().flatMap(field => {
    const cleaned = approvedValue(record[field], field);
    return cleaned === undefined ? [] : [[field, cleaned]];
  });
  return fields.length ? Object.fromEntries(fields) : undefined;
}

function appendEntry(entries: EvidenceEntry[], id: string, value: unknown, category: EvidenceCategory, source: string): void {
  const cleaned = approvedValue(value);
  if (cleaned === undefined || cleaned === null) return;
  if (typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).every(key => key === "id")) return;
  entries.push({ id, canonicalText: typeof cleaned === "string" ? cleaned : JSON.stringify(cleaned), category, source });
}

/**
 * Build an Evidence Ledger from the Generation Contract's student facts
 * and verified sources.
 */
export function buildEvidenceLedger(args: {
  studentFacts: StudentFactsInput;
  programContextText?: string;
  facultyAlignment: FacultyAlignment[];
  applicationSpecificFacts?: unknown;
}): EvidenceLedger {
  const studentEntries: EvidenceEntry[] = [];
  const programEntries: EvidenceEntry[] = [];
  const facultyEntries: EvidenceEntry[] = [];
  const appSpecificEntries: EvidenceEntry[] = [];

  // Extract student facts
  const sf = args.studentFacts;
  if (sf) {
    const records = [
      ["education", "EDU"], ["experience", "EXP"], ["projects", "PROJ"],
      ["research", "RES"], ["publications", "PUB"], ["achievements", "ACH"],
    ] as const;
    for (const [field, prefix] of records) {
      if (Array.isArray(sf[field])) {
        sf[field]!.forEach((value, index) => appendEntry(studentEntries, `SF-${prefix}-${index}`, value, "student", `studentFacts.${field}[${index}]`));
      }
    }
    const singletons = [
      ["personalDetails", "PERSONAL"], ["careerGoals", "CAREER"],
      ["personalStory", "STORY"], ["englishProficiency", "ENGLISH"],
    ] as const;
    for (const [field, suffix] of singletons) {
      appendEntry(studentEntries, `SF-${suffix}`, sf[field], "student", `studentFacts.${field}`);
    }
    // Phase 17: Project-specific clarifications (student-approved, benchmark-only)
    // Phase 23: Use the fact's own ID (e.g., SF-CHALLENGE-PROJECT-001, SF-PROJECT-MOTIVATION-001)
    if (Array.isArray(sf.projectClarifications)) {
      sf.projectClarifications.forEach((value: any, index: number) => {
        const factId = value.id || `SF-CHALLENGE-PROJECT-${String(index + 1).padStart(3, "0")}`;
        appendEntry(studentEntries, factId, value, "student", `studentFacts.projectClarifications[${index}]`);
      });
    }
    appendEntry(studentEntries, "SF-WRITING-ENGLISH", sf.writingPreferences?.actualEnglishProficiency, "student", "studentFacts.writingPreferences.actualEnglishProficiency");
    if (sf.applicationSpecificFacts) {
      const appFacts = sf.applicationSpecificFacts;
      if (Array.isArray(appFacts)) {
        appFacts.forEach((value, index) => appendEntry(appSpecificEntries, `SF-APP-${index}`, value, "application_specific", `studentFacts.applicationSpecificFacts[${index}]`));
      } else if (typeof appFacts === "object") {
        // Handle object-style applicationSpecificFacts (e.g., { facultyAlignment: [...] })
        for (const [key, value] of Object.entries(appFacts)) {
          if (Array.isArray(value)) {
            value.forEach((item, index) => appendEntry(appSpecificEntries, `SF-APP-${key}-${index}`, approvedValue(item, key), "application_specific", `studentFacts.applicationSpecificFacts.${key}[${index}]`));
          } else {
            appendEntry(appSpecificEntries, `SF-APP-${key}`, approvedValue(value, key), "application_specific", `studentFacts.applicationSpecificFacts.${key}`);
          }
        }
      }
    }
  }

  // Extract program facts
  appendEntry(programEntries, "PF-CONTEXT", args.programContextText, "program", "programContext");

  // Extract faculty facts
  args.facultyAlignment.forEach((fa, i) => {
    if (fa.status === "STUDENT_APPROVED") {
      appendEntry(facultyEntries, `FF-${i}`, fa, "faculty", fa.verifiedProgramFactSource || `facultyAlignment[${i}]`);
    }
  });

  // Application-specific facts from args
  const appFacts = args.applicationSpecificFacts;
  if (Array.isArray(appFacts)) {
    appFacts.forEach((value, index) => appendEntry(appSpecificEntries, `AF-${index}`, value, "application_specific", `applicationSpecificFacts[${index}]`));
  } else if (appFacts && typeof appFacts === "object") {
    for (const [key, value] of Object.entries(appFacts)) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => appendEntry(appSpecificEntries, `AF-${key}-${index}`, approvedValue(item, key), "application_specific", `applicationSpecificFacts.${key}[${index}]`));
      } else {
        appendEntry(appSpecificEntries, `AF-${key}`, approvedValue(value, key), "application_specific", `applicationSpecificFacts.${key}`);
      }
    }
  }

  const allEntries = [...studentEntries, ...programEntries, ...facultyEntries, ...appSpecificEntries];
  const ledgerHash = hashLedger(allEntries);

  return {
    studentFacts: studentEntries,
    programFacts: programEntries,
    facultyFacts: facultyEntries,
    applicationSpecificFacts: appSpecificEntries,
    allEntries,
    ledgerHash,
  };
}

function hashLedger(entries: EvidenceEntry[]): string {
  const text = JSON.stringify(entries);
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}

/**
 * Check if a factual claim is supported by the Evidence Ledger.
 * Returns the supporting fact IDs if found, or null if unsupported.
 */
export function checkClaimSupport(claim: string, ledger: EvidenceLedger): string[] | null {
  const supportingIds: string[] = [];

  for (const entry of ledger.allEntries) {
    // Check for key phrase overlap (simplified deterministic check)
    if (claim.trim().length > 0 && claim === entry.canonicalText) {
      supportingIds.push(entry.id);
    }
  }

  return supportingIds.length > 0 ? supportingIds : null;
}
