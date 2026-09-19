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
