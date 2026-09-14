// ============================================================
// CANONICAL VERIFIED APPLICATION CONTEXT (Phase SOP-AI-26)
// ============================================================
// The single server-side authoritative representation of everything
// the SOP generation pipeline needs to know about an application:
//   - verified requirements brief
//   - verified AI usage policy
//   - response components
//   - faculty context
//   - official source provenance
//
// The browser may NEVER independently establish VERIFIED requirements
// or AI_GENERATION_ALLOWED. Those must come from this server-side
// context.
//
// Future Requirements Discovery Agent will populate this structure.
// The SOP generation pipeline consumes it unchanged.
// ============================================================

import {
  ApplicationIdentity,
  VerifiedApplicationBrief,
  SourceRecord,
  VerificationStatus,
} from "./types";
import { AiUsagePolicy } from "./ai-policy-types";
import { ResponseComponent } from "./generation-contract-types";

export const APPLICATION_CONTEXT_SCHEMA_VERSION = "1.1.0";

/**
 * Trust state of the application context.
 * Generation proceeds only when the fields required for that
 * application are sufficiently VERIFIED.
 */
export type ApplicationVerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "REVIEW_REQUIRED"
  | "UNKNOWN"
  | "CONFLICT"
  | "PORTAL_ONLY_UNAVAILABLE";

/**
 * Faculty context entry — approved faculty alignments.
 */
export interface FacultyContextEntry {
  facultyName: string;
  verifiedProgramFactSource: any;
  studentInterestEvidence: any[];
  alignmentReason: string;
  status: "STUDENT_APPROVED";
  approvedAt: string;
}

/**
 * The canonical server-side authoritative application context.
 *
 * This is the SINGLE downstream boundary that both browser flow
 * and benchmark flow must converge to before entering the
 * Generation Contract → Evidence Bundle → Gates → Pipeline.
 */
export interface VerifiedApplicationContext {
  /** Unique identifier for this context */
  applicationId: string;

  /** Schema version for forward compatibility */
  schemaVersion: string;

  /** Application identity — the lookup key */
  applicationIdentity: ApplicationIdentity;

  /** Verified application requirements brief */
  brief: VerifiedApplicationBrief;

  /** Verified AI usage policy */
  aiPolicy: AiUsagePolicy;

  /** Response components derived from official requirements — full canonical type */
  responseComponents: ResponseComponent[];

  /** Faculty context (approved alignments, if applicable) */
  facultyContext: FacultyContextEntry[];

  /** Official sources used to verify this context */
  officialSources: SourceRecord[];

  /** Overall verification status */
  verificationStatus: ApplicationVerificationStatus;

  /** When this context was verified */
  verifiedAt: string;

  /** Content hash of the brief + AI policy for integrity checks */
  contentHash: string;

  /** Cache key (same as brief.cacheKey) */
  cacheKey: string;

  /** When this context was created/persisted */
  createdAt: string;

  /** When this context expires (null = does not expire) */
  expiresAt: string | null;

  /** Whether this context was produced by a fixture adapter */
  fromFixture: boolean;
}

/**
 * Result of loading a verified application context.
 */
export interface LoadContextResult {
  found: boolean;
  context: VerifiedApplicationContext | null;
  /** If not found or expired, the reason */
  reason: string | null;
}

/**
 * Generate a stable applicationId from identity.
 * This is the same as the brief cache key — identity-scoped.
 */
export function generateApplicationId(identity: ApplicationIdentity): string {
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
 * Compute a content hash for the context.
 * Uses the brief cache key + AI policy status + verification status.
 * Not cryptographic — for integrity tracking only.
 */
export function computeContextContentHash(
  brief: VerifiedApplicationBrief,
  aiPolicy: AiUsagePolicy,
): string {
  const data = `${brief.cacheKey}::${aiPolicy.status}::${brief.verification.status}::${brief.sources.length}`;
  // Simple hash (not SHA-256, sufficient for integrity tracking)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `ctx-${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

/**
 * Derive the overall application verification status from the brief
 * and AI policy.
 *
 * Does NOT silently upgrade PARTIALLY_VERIFIED to VERIFIED.
 */
export function deriveApplicationVerificationStatus(
  brief: VerifiedApplicationBrief,
  aiPolicy: AiUsagePolicy,
): ApplicationVerificationStatus {
  // If brief has CONFLICT, context has CONFLICT
  if (brief.verification.status === "CONFLICT") {
    return "CONFLICT";
  }

  // If AI policy has CONFLICT, context has CONFLICT
  if (aiPolicy.status === "AI_POLICY_CONFLICT") {
    return "CONFLICT";
  }

  // If brief is BLOCKED or UNVERIFIED, context is UNKNOWN
  if (brief.verification.status === "BLOCKED" || brief.verification.status === "UNVERIFIED") {
    return "UNKNOWN";
  }

  // If AI policy is NOT_FOUND, AMBIGUOUS, or REVIEW_REQUIRED
  if (aiPolicy.status === "AI_POLICY_NOT_FOUND" || aiPolicy.status === "AI_POLICY_AMBIGUOUS") {
    return "UNKNOWN";
  }
  if (aiPolicy.status === "REVIEW_REQUIRED") {
    return "REVIEW_REQUIRED";
  }

  // If AI policy is PROHIBITED or RESTRICTED
  if (aiPolicy.status === "AI_GENERATION_PROHIBITED" || aiPolicy.status === "AI_ASSISTANCE_RESTRICTED") {
    return "PORTAL_ONLY_UNAVAILABLE";
  }

  // If brief is PARTIALLY_VERIFIED, context is PARTIALLY_VERIFIED
  if (brief.verification.status === "PARTIALLY_VERIFIED") {
    return "PARTIALLY_VERIFIED";
  }

  // If brief is VERIFIED and AI policy is ALLOWED
  if (brief.verification.status === "VERIFIED" && aiPolicy.status === "AI_GENERATION_ALLOWED") {
    return "VERIFIED";
  }

  // Default: REVIEW_REQUIRED
  return "REVIEW_REQUIRED";
}
