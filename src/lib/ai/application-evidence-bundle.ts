/**
 * @file application-evidence-bundle.ts
 * @description
 * ApplicationEvidenceBundle — the ONE canonical server-side factual world
 * for all AI stages.
 *
 * Every stage (Planner, Writer, Quality Reviewer, Language Calibrator,
 * Bounded Finalizer, Final Fact Reviewer) derives its evidence from this
 * same bundle. No stage may build its own independent flattened student-fact
 * representation that can silently omit a supported fact category.
 *
 * Phase SOP-AI-19.
 */

import { createHash } from "node:crypto";
import type { StudentProfile } from "@/types";
import type { FacultyAlignment } from "@/lib/requirements/generation-contract-types";
import { buildEvidenceLedger, type EvidenceLedger, type EvidenceEntry } from "./evidence-ledger";

export interface ApplicationEvidenceBundle {
  /** The canonical evidence ledger (all categories) */
  ledger: EvidenceLedger;
  /** Student facts as structured text for prompt injection */
  studentFactsText: string;
  /** Program facts text */
  programFactsText: string;
  /** Approved faculty alignments */
  facultyAlignment: FacultyAlignment[];
  /** All evidence entries flattened (same as ledger.allEntries) */
  allEntries: EvidenceEntry[];
  /** Canonical bundle hash for checkpoint validity */
  bundleHash: string;
  /** Schema version */
  schemaVersion: string;
}

/**
 * Build the ONE canonical ApplicationEvidenceBundle from persisted state.
 *
 * All stages must call this (or receive its output) — never build a
 * separate studentFactsText that can omit projectClarifications or other
 * categories.
 */
export function buildApplicationEvidenceBundle(args: {
  profile: StudentProfile;
  programContextText?: string;
  facultyAlignment: FacultyAlignment[];
  applicationSpecificFacts?: unknown;
}): ApplicationEvidenceBundle {
  // Build the evidence ledger (includes projectClarifications since Phase 17)
  const ledger = buildEvidenceLedger({
    studentFacts: args.profile as any,
    programContextText: args.programContextText,
    facultyAlignment: args.facultyAlignment,
    applicationSpecificFacts: args.applicationSpecificFacts,
  });

  // Build the canonical studentFactsText from the ledger entries
  // This ensures every category (including projectClarifications) is visible
  const studentFactsText = formatStudentFactsForPrompt(ledger);
  const programFactsText = args.programContextText || "";

  // Compute bundle hash from all entries + schema version
  const hashInput = JSON.stringify({
    entries: ledger.allEntries,
    schema: "evidence-bundle-v1",
  });
  const bundleHash = createHash("sha256").update(hashInput).digest("hex").substring(0, 16);

  return {
    ledger,
    studentFactsText,
    programFactsText,
    facultyAlignment: args.facultyAlignment,
    allEntries: ledger.allEntries,
    bundleHash,
    schemaVersion: "evidence-bundle-v1",
  };
}

/**
 * Format student facts from the evidence ledger into a text representation
 * for prompt injection. This includes ALL categories — especially
 * projectClarifications which were previously omitted by buildAiInput.
 */
function formatStudentFactsForPrompt(ledger: EvidenceLedger): string {
  const lines: string[] = [];

  if (ledger.studentFacts.length > 0) {
    lines.push("STUDENT FACTS:");
    for (const entry of ledger.studentFacts) {
      lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
    }
  }

  if (ledger.programFacts.length > 0) {
    lines.push("");
    lines.push("PROGRAM FACTS:");
    for (const entry of ledger.programFacts) {
      lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
    }
  }

  if (ledger.facultyFacts.length > 0) {
    lines.push("");
    lines.push("FACULTY FACTS (student-approved):");
    for (const entry of ledger.facultyFacts) {
      lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
    }
  }

  if (ledger.applicationSpecificFacts.length > 0) {
    lines.push("");
    lines.push("APPLICATION-SPECIFIC FACTS:");
    for (const entry of ledger.applicationSpecificFacts) {
      lines.push(`  [${entry.id}] (${entry.source}): ${entry.canonicalText}`);
    }
  }

  return lines.join("\n");
}

/**
 * Verify that a specific evidence ID is visible in the bundle.
 * Used by the evidence parity test.
 */
export function isEvidenceVisible(bundle: ApplicationEvidenceBundle, evidenceId: string): boolean {
  return bundle.allEntries.some(e => e.id === evidenceId);
}

/**
 * Get an evidence entry by ID from the bundle.
 */
export function getEvidenceById(bundle: ApplicationEvidenceBundle, evidenceId: string): EvidenceEntry | undefined {
  return bundle.allEntries.find(e => e.id === evidenceId);
}
