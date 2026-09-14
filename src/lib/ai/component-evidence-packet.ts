/**
 * @file component-evidence-packet.ts
 * @description
 * Phase 14: Component Evidence Packets.
 *
 * After the Planner selects evidence per component, build a deterministic
 * evidence packet PER response component. The Writer receives ONLY the
 * evidence approved for that component — not the entire student profile.
 *
 * This is the core of the closed-world Writer constraint.
 */

import { createHash } from "node:crypto";
import type { EvidenceLedger, EvidenceEntry } from "./evidence-ledger";
import type { ResponseComponent } from "@/lib/requirements/generation-contract-types";

export interface ComponentEvidencePacket {
  componentId: string;
  requiredTopics: string[];
  studentEvidence: EvidenceEntry[];
  programEvidence: EvidenceEntry[];
  facultyEvidence: EvidenceEntry[];
  applicationSpecificEvidence: EvidenceEntry[];
  /** All entries combined for lookup */
  allEntries: EvidenceEntry[];
  /** Hash of the packet for checkpoint validity */
  packetHash: string;
  /** Authorized evidence IDs (the closed world for this component) */
  authorizedEvidenceIds: string[];
}

export interface PlannerEvidenceSelection {
  componentId: string;
  primaryEvidenceIds: string[];
  secondaryEvidenceIds: string[];
}

/**
 * Build per-component evidence packets from the Evidence Ledger and
 * the Planner's evidence selection.
 *
 * If the Planner does not provide explicit evidence selection, all
 * relevant ledger entries for that component's required topics are included.
 */
export function buildComponentEvidencePackets(args: {
  evidenceLedger: EvidenceLedger;
  responseComponents: ResponseComponent[];
  plannerEvidenceSelection?: PlannerEvidenceSelection[];
}): ComponentEvidencePacket[] {
  const packets: ComponentEvidencePacket[] = [];
  const ledger = args.evidenceLedger;
  const selectionMap = new Map(
    (args.plannerEvidenceSelection ?? []).map(s => [s.componentId, s])
  );

  for (const rc of args.responseComponents) {
    const requiredTopics = rc.requiredTopics.map(t => t.topic);
    const selection = selectionMap.get(rc.componentId);

    // Determine authorized evidence IDs
    let authorizedIds: string[];

    if (selection && (selection.primaryEvidenceIds.length > 0 || selection.secondaryEvidenceIds.length > 0)) {
      // Use Planner's explicit selection (primary + secondary)
      authorizedIds = [
        ...selection.primaryEvidenceIds,
        ...selection.secondaryEvidenceIds,
      ];
    } else {
      // No explicit selection — include all student + program + faculty + app-specific
      // entries as the default closed world for this component
      authorizedIds = ledger.allEntries.map(e => e.id);
    }

    // Filter ledger entries to only authorized IDs
    const authorizedSet = new Set(authorizedIds);
    const studentEvidence = ledger.studentFacts.filter(e => authorizedSet.has(e.id));
    const programEvidence = ledger.programFacts.filter(e => authorizedSet.has(e.id));
    const facultyEvidence = ledger.facultyFacts.filter(e => authorizedSet.has(e.id));
    const applicationSpecificEvidence = ledger.applicationSpecificFacts.filter(e => authorizedSet.has(e.id));
    const allEntries = [...studentEvidence, ...programEvidence, ...facultyEvidence, ...applicationSpecificEvidence];

    const packetHash = hashPacket(rc.componentId, allEntries);

    packets.push({
      componentId: rc.componentId,
      requiredTopics,
      studentEvidence,
      programEvidence,
      facultyEvidence,
      applicationSpecificEvidence,
      allEntries,
      packetHash,
      authorizedEvidenceIds: allEntries.map(e => e.id),
    });
  }

  return packets;
}

/**
 * Validate that a Writer's reported evidence IDs are all authorized
 * for that component.
 */
export function validateWriterEvidenceReferences(args: {
  packets: ComponentEvidencePacket[];
  writerOutput: { responses: Array<{ componentId: string; usedEvidenceIds?: string[]; factualClaims?: Array<{ claim: string; evidenceIds: string[] }> }> };
}): { valid: boolean; violations: WriterEvidenceViolation[] } {
  const violations: WriterEvidenceViolation[] = [];
  const packetMap = new Map(args.packets.map(p => [p.componentId, p]));

  for (const resp of args.writerOutput.responses || []) {
    const packet = packetMap.get(resp.componentId);
    if (!packet) {
      violations.push({
        componentId: resp.componentId,
        code: "UNKNOWN_COMPONENT",
        message: "Writer referenced an unknown component.",
      });
      continue;
    }

    const authorizedSet = new Set(packet.authorizedEvidenceIds);

    // Check usedEvidenceIds
    const usedIds = resp.usedEvidenceIds || [];
    for (const id of usedIds) {
      if (!authorizedSet.has(id)) {
        violations.push({
          componentId: resp.componentId,
          code: "WRITER_EVIDENCE_REFERENCE_VIOLATION",
          evidenceId: id,
          message: `Writer referenced evidence ID "${id}" not authorized for component ${resp.componentId}.`,
        });
      }
    }

    // Check factualClaims evidence IDs
    for (const claim of resp.factualClaims || []) {
      for (const id of claim.evidenceIds || []) {
        if (!authorizedSet.has(id)) {
          violations.push({
            componentId: resp.componentId,
            code: "WRITER_EVIDENCE_REFERENCE_VIOLATION",
            evidenceId: id,
            claim: claim.claim,
            message: `Writer factual claim references evidence ID "${id}" not authorized for component ${resp.componentId}.`,
          });
        }
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export interface WriterEvidenceViolation {
  componentId: string;
  code: "WRITER_EVIDENCE_REFERENCE_VIOLATION" | "UNKNOWN_COMPONENT";
  evidenceId?: string;
  claim?: string;
  message: string;
}

function hashPacket(componentId: string, entries: EvidenceEntry[]): string {
  const text = JSON.stringify({ componentId, entries });
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}
