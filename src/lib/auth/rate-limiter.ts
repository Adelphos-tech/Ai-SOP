// ============================================================
// IN-MEMORY RATE LIMITER
// ============================================================
// Simple sliding-window rate limiter using in-memory Map.
// No Redis required. Suitable for single-server deployment.
//
// Limits per IP address (or any key) within a time window.
// ============================================================

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Periodic cleanup of expired entries (every 5 minutes)
let lastCleanup = 0;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanupExpired(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const keysToDelete: string[] = [];
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt < now) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(k => buckets.delete(k));
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a key.
 * Returns { allowed: true } if under limit, { allowed: false } if exceeded.
 *
 *   const rl = checkRateLimit(ip, 10, 15 * 60 * 1000); // 10 requests per 15 min
 *   if (!rl.allowed) return 429;
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now);

  const existing = buckets.get(key);

  if (existing && existing.resetAt > now) {
    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }
    existing.count++;
    return { allowed: true, remaining: maxRequests - existing.count, resetAt: existing.resetAt };
  }

  // New window
  const resetAt = now + windowMs;
  buckets.set(key, { count: 1, resetAt });
  return { allowed: true, remaining: maxRequests - 1, resetAt };
}

/**
 * Get client IP from a Next.js request.
 * Checks X-Forwarded-For (set by nginx) and falls back to a default.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
