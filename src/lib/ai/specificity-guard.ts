/**
 * @file specificity-guard.ts
 * @description
 * Deterministic specificity guard for Writer claims.
 *
 * Detects clearly novel specificity that the Writer added beyond what
 * the approved evidence supports. This is a deterministic pre-check
 * that feeds into the Quality Reviewer and Action Planner.
 *
 * Phase SOP-AI-19.
 */

import type { EvidenceEntry } from "./evidence-ledger";
import { detectNovelSpecificity, containsMotivationAssertion } from "./writer-claim-types";

export interface SpecificityViolation {
  claimId: string;
  componentId: string;
  code: "WRITER_NOVEL_SPECIFICITY" | "WRITER_UNSAFE_MOTIVATION";
  attribute?: string;
  pattern: string;
  claimText: string;
  sourceText: string;
  message: string;
}

/**
 * Run deterministic specificity checks on Writer claims against their
 * supporting evidence.
 *
 * For each claim:
 * 1. If the claim contains a motivation assertion, check that the supporting
 *    evidence explicitly states a motivation/purpose. If not, flag as
 *    WRITER_UNSAFE_MOTIVATION.
 * 2. If the claim adds specificity (frequency, location, quantity, tool, etc.)
 *    not present in the supporting evidence text, flag as
 *    WRITER_NOVEL_SPECIFICITY.
 *
 * This does NOT attempt to solve all semantic entailment — Stage 6
 * (Final Fact Reviewer) remains the semantic authority.
 */
export function runSpecificityGuard(args: {
  writerClaims: Array<{
    claimId: string;
    componentId: string;
    claim: string;
    evidenceIds: string[];
  }>;
  evidenceEntries: EvidenceEntry[];
}): SpecificityViolation[] {
  const violations: SpecificityViolation[] = [];
  const evidenceMap = new Map<string, EvidenceEntry>();
  for (const entry of args.evidenceEntries) {
    evidenceMap.set(entry.id, entry);
  }

  for (const claim of args.writerClaims) {
    // Get the supporting evidence text
    const sourceTexts = claim.evidenceIds
      .map(id => evidenceMap.get(id)?.canonicalText || "")
      .filter(t => t.length > 0);
    const combinedSource = sourceTexts.join(" ");

    // Check 1: Motivation assertion without motivation evidence
    if (containsMotivationAssertion(claim.claim)) {
      // Check if any supporting evidence explicitly states motivation/purpose
      const hasMotivationEvidence = sourceTexts.some(text =>
        /\b(motivat|purpose|goal|aim|intent|wanted\s+to|hoped\s+to|sought\s+to|undertook|chose\s+to|decided\s+to)\b/i.test(text)
      );
      if (!hasMotivationEvidence) {
        violations.push({
          claimId: claim.claimId,
          componentId: claim.componentId,
          code: "WRITER_UNSAFE_MOTIVATION",
          pattern: "motivation assertion without supporting motivation evidence",
          claimText: claim.claim,
          sourceText: combinedSource,
          message: `Claim "${claim.claim.substring(0, 80)}..." asserts student motivation/intent not supported by approved evidence. Project activity evidence alone cannot authorize why the student undertook the project.`,
        });
      }
    }

    // Check 2: Novel specificity
    if (combinedSource.length > 0) {
      const novel = detectNovelSpecificity(claim.claim, combinedSource);
      for (const n of novel) {
        violations.push({
          claimId: claim.claimId,
          componentId: claim.componentId,
          code: "WRITER_NOVEL_SPECIFICITY",
          attribute: n.attribute,
          pattern: n.pattern,
          claimText: claim.claim,
          sourceText: combinedSource,
          message: `Claim adds novel ${n.attribute} "${n.pattern}" not present in supporting evidence.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Conservative paraphrase validation.
 *
 * A CONSERVATIVE_PARAPHRASE may rephrase but must not add:
 * - frequency, time, location, named setting, sequence, quantity,
 *   tool, method, causality, purpose, relationship, result
 */
export function validateConservativeParaphrase(
  claimText: string,
  sourceText: string
): { valid: boolean; violations: string[] } {
  const novel = detectNovelSpecificity(claimText, sourceText);
  if (novel.length === 0) {
    return { valid: true, violations: [] };
  }
  return {
    valid: false,
    violations: novel.map(n => `Added ${n.attribute}: "${n.pattern}"`),
  };
}
