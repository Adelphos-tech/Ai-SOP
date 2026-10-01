// ============================================================
// CV → profile merge helpers (canonical personalData shape)
// Extracted from cv-apply route for deterministic testing.
// ============================================================

const PERSONAL_KEYS = [
  "firstName", "lastName", "email", "phone",
  "currentCity", "currentCountry", "dateOfBirth", "nationality",
] as const;

/**
 * Merge parsed-CV personal data into the existing personalData.
 * Merge mode fills empty fields only; overwrite prefers parsed values.
 * IMPORTANT: every canonical key must prefer existing→parsed — fields
 * like nationality/dateOfBirth must never be dropped unconditionally.
 */
export function mergePersonalData(
  existingPd: Record<string, any> | undefined,
  parsedPd: Record<string, any> | undefined,
  overwrite: boolean,
): Record<string, any> {
  const existing = existingPd || {};
  const parsed = parsedPd || {};
  const merged: Record<string, any> = {};
  for (const k of PERSONAL_KEYS) {
    merged[k] = overwrite ? (parsed[k] || existing[k]) : (existing[k] || parsed[k]);
  }
  // Preserve any extra existing keys not in the canonical list.
  for (const [k, v] of Object.entries(existing)) {
    if (!PERSONAL_KEYS.includes(k as any)) merged[k] = v;
  }
  return merged;
}

// ============================================================
// SKILLS MERGE + PROVENANCE
// Canonical skills stay string[] per category — provenance lives in a
// companion map: skillProvenance[category][normalizedSkill] = importId
// ("cv-...") for CV-applied entries. Absent key = manual (safe default).
// ============================================================

export const SKILL_CATEGORIES = [
  "technical", "programming", "tools", "domain", "soft", "software",
] as const;

/** Conservative normalization — case/trim/whitespace only.
 *  "C" vs "C++" vs ".NET" vs "ASP.NET" stay distinct. */
export function normSkill(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Remove only skills that were imported by a prior CV apply
 * (provenance importId starts with "cv-"). Manual and
 * unknown-provenance skills are always preserved.
 */
export function removeCvDerivedSkills(
  skills: Record<string, string[] | undefined> | undefined,
  provenance: Record<string, Record<string, string>> | undefined,
): Record<string, string[] | undefined> {
  if (!skills || typeof skills !== "object") return skills || {};
  const out: Record<string, string[] | undefined> = { ...skills };
  for (const cat of SKILL_CATEGORIES) {
    const arr = out[cat];
    if (!Array.isArray(arr)) continue;
    out[cat] = arr.filter(
      (s) => !String(provenance?.[cat]?.[normSkill(s)] ?? "").startsWith("cv-"),
    );
  }
  return out;
}

/**
 * Merge parsed-CV skills into existing skills with provenance tracking.
 *  - merge mode: existing preserved; new CV skills appended (normalized
 *    dedupe); manual entries keep manual provenance even when the CV
 *    repeats the same skill.
 *  - overwrite mode: array becomes exactly the CV's skills, all tagged
 *    with this importId.
 * Provenance keys for skills no longer present are pruned.
 */
export function mergeCvSkills(
  existingSkills: Record<string, string[] | undefined> | undefined,
  priorProvenance: Record<string, Record<string, string>> | undefined,
  parsedSkills: Record<string, string[] | undefined>,
  opts: { overwrite: boolean; importId: string },
): { skills: Record<string, string[]>; skillProvenance: Record<string, Record<string, string>> } {
  const skillsOut: Record<string, string[]> = {};
  const provOut: Record<string, Record<string, string>> = {};
  for (const cat of SKILL_CATEGORIES) {
    const existingArr: string[] = Array.isArray(existingSkills?.[cat]) ? existingSkills![cat]! : [];
    const incoming: string[] = Array.isArray(parsedSkills?.[cat]) ? parsedSkills[cat]! : [];
    const catProv: Record<string, string> = { ...(priorProvenance?.[cat] || {}) };

    if (opts.overwrite) {
      const seen = new Set<string>();
      const arr: string[] = [];
      for (const s of incoming) {
        const k = normSkill(s);
        if (!k || seen.has(k)) continue;
        seen.add(k); arr.push(String(s).trim());
      }
      skillsOut[cat] = arr;
      provOut[cat] = Object.fromEntries(arr.map(s => [normSkill(s), opts.importId]));
    } else {
      const seen = new Set(existingArr.map(normSkill));
      const arr = [...existingArr];
      for (const s of incoming) {
        const k = normSkill(s);
        if (!k || seen.has(k)) continue;
        seen.add(k); arr.push(String(s).trim()); catProv[k] = opts.importId;
      }
      // prune provenance for skills no longer present
      for (const k of Object.keys(catProv)) if (!seen.has(k)) delete catProv[k];
      skillsOut[cat] = arr;
      provOut[cat] = catProv;
    }
  }
  return { skills: skillsOut, skillProvenance: provOut };
}
