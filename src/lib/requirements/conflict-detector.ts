import {
  SourceRecord, ConflictRecord, VerifiedApplicationBrief,
  DocumentRequirement, FieldProvenance, RequirementStatus
} from "./types";

/**
 * Resolve source precedence: program-specific > graduate/undergrad > university-wide > country
 */
export function resolvePrecedence(sources: SourceRecord[]): SourceRecord[] {
  const priorityOrder: Record<string, number> = { PRIMARY: 0, SECONDARY: 1, TERTIARY: 2 };
  return [...sources].sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
}

/**
 * Detect conflicts between official sources for a given field.
 * If approved official sources disagree and deterministic precedence cannot resolve:
 *   status = CONFLICT → BLOCK GENERATION
 */
export function detectFieldConflict(
  field: string,
  provenances: FieldProvenance[]
): ConflictRecord | null {
  const verified = provenances.filter(p => p.status === "VERIFIED" && p.value !== null && p.value !== undefined);
  if (verified.length < 2) return null;

  // Check if values differ (compare JSON serialization)
  const values = verified.map(v => JSON.stringify(v.value));
  const uniqueValues = new Set(values);
  if (uniqueValues.size === 1) return null; // All agree

  // Try precedence resolution:
  // If exactly one source is program+intake matched (PRIMARY) and others are not,
  // the PRIMARY value wins — not a conflict
  const primarySources = verified.filter(p => p.programMatch && p.intakeMatch);
  const secondarySources = verified.filter(p => !p.programMatch || !p.intakeMatch);

  if (primarySources.length === 1 && secondarySources.length > 0) {
    // Program-specific source overrides — not a conflict
    return null;
  }

  // If ALL sources are primary and disagree, or multiple primary sources disagree
  // Check if all primary sources agree among themselves
  if (primarySources.length >= 2) {
    const primaryValues = primarySources.map(v => JSON.stringify(v.value));
    const uniquePrimary = new Set(primaryValues);
    if (uniquePrimary.size > 1) {
      // Multiple primary sources disagree — CONFLICT
      return {
        field,
        sources: verified.map(v => v.sourceId),
        values: verified.map(v => v.value),
        description: `Conflicting values for ${field} from ${verified.length} official sources (multiple primary sources disagree)`,
      };
    }
    // Primary sources agree — use primary value, secondary disagreement is overridden
    return null;
  }

  // No primary sources, or only secondary sources disagree
  if (primarySources.length === 0 && secondarySources.length >= 2) {
    return {
      field,
      sources: verified.map(v => v.sourceId),
      values: verified.map(v => v.value),
      description: `Conflicting values for ${field} from ${verified.length} official sources (no program-specific source to resolve)`,
    };
  }

  // Default: conflict
  return {
    field,
    sources: verified.map(v => v.sourceId),
    values: verified.map(v => v.value),
    description: `Conflicting values for ${field} from ${verified.length} official sources`,
  };
}

/**
 * Detect all conflicts in a verified application brief.
 */
export function detectConflicts(brief: VerifiedApplicationBrief): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  for (const doc of brief.documents) {
    // Collect all provenances for word limit
    const wordLimitProvenances: FieldProvenance[] = [];
    if (doc.wordLimit.provenance) wordLimitProvenances.push(doc.wordLimit.provenance);

    const wlConflict = detectFieldConflict("wordLimit", wordLimitProvenances);
    if (wlConflict) conflicts.push(wlConflict);

    // Collect all provenances for character limit
    const charLimitProvenances: FieldProvenance[] = [];
    if (doc.characterLimit.provenance) charLimitProvenances.push(doc.characterLimit.provenance);

    const clConflict = detectFieldConflict("characterLimit", charLimitProvenances);
    if (clConflict) conflicts.push(clConflict);

    // Collect all provenances for official prompt
    const promptProvenances: FieldProvenance[] = [];
    if (doc.officialPrompt.provenance) promptProvenances.push(doc.officialPrompt.provenance);

    const pConflict = detectFieldConflict("officialPrompt", promptProvenances);
    if (pConflict) conflicts.push(pConflict);
  }

  return conflicts;
}

/**
 * Apply program-specific override.
 * Program-specific official instructions have priority over generic university-wide instructions.
 */
export function applyProgramOverride(
  sources: SourceRecord[],
  fieldProvenances: FieldProvenance[]
): FieldProvenance | null {
  const sorted = resolvePrecedence(sources);

  // Find the highest-priority source that has a provenance for this field
  for (const source of sorted) {
    const match = fieldProvenances.find(p => p.sourceId === source.sourceId && p.status === "VERIFIED");
    if (match) {
      return match;
    }
  }

  return null;
}
