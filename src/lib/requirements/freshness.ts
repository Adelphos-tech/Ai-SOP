import { ApplicationIdentity, VerifiedApplicationBrief } from "./types";

const DEFAULT_FRESHNESS_HOURS = 168; // 7 days

/**
 * Generate a cache key for a specific application identity.
 * Keyed by: country, university, program, degreeLevel, intake, intakeYear
 * Never mix programs (MS Data Science ≠ MS Computer Science even at same university).
 */
export function generateCacheKey(identity: ApplicationIdentity): string {
  const parts = [
    identity.country,
    identity.university,
    identity.program,
    identity.degreeLevel,
    identity.intake,
    identity.intakeYear,
  ].map(p => (p || "").toLowerCase().trim().replace(/\s+/g, "_"));

  return parts.join("__");
}

/**
 * Check if a cached brief is still fresh.
 */
export function isFresh(brief: VerifiedApplicationBrief, maxAgeHours?: number): boolean {
  const ttl = maxAgeHours ?? getIntFreshnessHours();
  if (!brief.createdAt) return false;

  const created = new Date(brief.createdAt).getTime();
  const ageHours = (Date.now() - created) / (1000 * 60 * 60);

  return ageHours < ttl;
}

/**
 * Check if a brief should be reverified.
 */
export function shouldReverify(brief: VerifiedApplicationBrief, identity: ApplicationIdentity): boolean {
  // If the cache key doesn't match, must reverify
  const currentKey = generateCacheKey(identity);
  if (brief.cacheKey !== currentKey) return true;

  // If expired, must reverify
  if (!isFresh(brief)) return true;

  // If any source is STALE or INACCESSIBLE, must reverify
  if (brief.sources.some(s => s.status === "STALE" || s.status === "INACCESSIBLE")) {
    return true;
  }

  return false;
}

/**
 * Get freshness TTL from environment or default.
 */
export function getIntFreshnessHours(): number {
  const env = process.env.REQUIREMENTS_FRESHNESS_HOURS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_FRESHNESS_HOURS;
}

/**
 * Calculate expiry timestamp.
 */
export function calculateExpiry(createdAt: string, maxAgeHours?: number): string {
  const ttl = maxAgeHours ?? getIntFreshnessHours();
  const expiry = new Date(new Date(createdAt).getTime() + ttl * 60 * 60 * 1000);
  return expiry.toISOString();
}
