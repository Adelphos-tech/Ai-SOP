/**
 * @file ai-policy-types.ts
 * @description
 * Type definitions for the AI Usage Policy Compliance Gate.
 *
 * This gate is SEPARATE from the Requirements Verification Gate.
 * Requirements verification answers: "Do we know what the application requires?"
 * AI policy verification answers: "Does the official institution permit
 * generative AI assistance for this application material?"
 *
 * BOTH gates must permit generation before the OpenAI writing pipeline runs.
 */

/* ------------------------------------------------------------------ */
/* AI policy statuses                                                  */
/* ------------------------------------------------------------------ */

/**
 * Status of the official AI usage policy for an application.
 *
 * - AI_GENERATION_ALLOWED        — official policy explicitly permits AI-generated content
 * - AI_GENERATION_PROHIBITED     — official policy explicitly prohibits AI-generated content
 * - AI_ASSISTANCE_RESTRICTED    — official policy allows limited AI help (e.g., proofreading only)
 * - AI_POLICY_NOT_FOUND          — no official AI policy could be found (BLOCKS generation)
 * - AI_POLICY_AMBIGUOUS          — official policy exists but is unclear (BLOCKS generation)
 * - AI_POLICY_CONFLICT           — multiple official policies conflict (BLOCKS generation)
 * - REVIEW_REQUIRED              — extraction incomplete, human review needed
 */
export type AiPolicyStatus =
  | "AI_GENERATION_ALLOWED"
  | "AI_GENERATION_PROHIBITED"
  | "AI_ASSISTANCE_RESTRICTED"
  | "AI_POLICY_NOT_FOUND"
  | "AI_POLICY_AMBIGUOUS"
  | "AI_POLICY_CONFLICT"
  | "REVIEW_REQUIRED";

/* ------------------------------------------------------------------ */
/* Per-action permissions                                              */
/* ------------------------------------------------------------------ */

/**
 * Permission status for a specific AI action.
 *
 * - ALLOWED          — official policy explicitly permits this action
 * - PROHIBITED       — official policy explicitly prohibits this action
 * - UNKNOWN          — policy does not address this action (NOT permission)
 * - REVIEW_REQUIRED  — extraction incomplete
 *
 * IMPORTANT: UNKNOWN is NOT permission. Silence does not grant consent.
 */
export type AiActionPermission = "ALLOWED" | "PROHIBITED" | "UNKNOWN" | "REVIEW_REQUIRED";

/* ------------------------------------------------------------------ */
/* Application-level AI mode                                           */
/* ------------------------------------------------------------------ */

/**
 * Overall AI mode for an application, derived from the policy status.
 *
 * - FULL_AI_WRITING_ALLOWED     — generation, editing, proofreading all permitted
 * - LIMITED_AI_ASSISTANCE       — some actions allowed (e.g., proofreading only)
 * - AI_WRITING_BLOCKED          — generation prohibited; may allow limited assistance
 * - POLICY_REVIEW_REQUIRED      — policy unclear or missing; block until reviewed
 */
export type ApplicationAiMode =
  | "FULL_AI_WRITING_ALLOWED"
  | "LIMITED_AI_ASSISTANCE"
  | "AI_WRITING_BLOCKED"
  | "POLICY_REVIEW_REQUIRED";

/* ------------------------------------------------------------------ */
/* AI policy source record                                             */
/* ------------------------------------------------------------------ */

/**
 * A single official source that states an AI usage policy.
 */
export interface AiPolicySource {
  /** Stable unique ID (e.g., "AIPOL-HDS-001"). */
  sourceId: string;
  /** Title of the page/document. */
  title: string;
  /** Official URL. */
  url: string;
  /** Official domain (e.g., "gsas.harvard.edu"). */
  officialDomain: string;
  /** Whether the domain was verified as official. */
  domainVerified: boolean;
  /** Source type (webpage, document, application instructions). */
  sourceType: "OFFICIAL_UNIVERSITY_WEBPAGE" | "OFFICIAL_UNIVERSITY_DOCUMENT" | "OFFICIAL_APPLICATION_INSTRUCTIONS";
  /** Exact verbatim policy text from the source. */
  exactPolicyText: string;
  /** ISO-8601 timestamp when the policy was retrieved. */
  retrievedAt: string;
  /** ISO-8601 publication/update date if available. */
  publishedOrUpdatedAt?: string;
  /** Applicable school/program if the policy is program-specific. */
  applicableScope: string;
  /** Applicable application cycle/intake if available. */
  applicableCycle?: string;
  /** Precedence priority. */
  priority: "PRIMARY" | "SECONDARY" | "TERTIARY";
  /** HTTP status of the source fetch. */
  httpStatus: number;
}

/* ------------------------------------------------------------------ */
/* AI policy record                                                    */
/* ------------------------------------------------------------------ */

/**
 * The complete AI usage policy record for an application.
 */
export interface AiUsagePolicy {
  /** Overall policy status. */
  status: AiPolicyStatus;
  /** Whether AI generation of application content is allowed. */
  generationAllowed: boolean;
  /** Whether AI editing/rewriting is allowed (null = unknown). */
  editingAllowed: AiActionPermission;
  /** Whether AI proofreading/grammar is allowed (null = unknown). */
  proofreadingAllowed: AiActionPermission;
  /** Whether AI brainstorming/outline help is allowed (null = unknown). */
  brainstormingAllowed: AiActionPermission;
  /** Whether AI translation is allowed (null = unknown). */
  translationAllowed: AiActionPermission;
  /** Application-level AI mode derived from the policy. */
  applicationAiMode: ApplicationAiMode;
  /** Sources supporting this policy. */
  sources: AiPolicySource[];
  /** ISO-8601 timestamp when the policy was verified. */
  verifiedAt: string;
  /** Cache key for this policy record. */
  cacheKey: string;
  /** Freshness expiry timestamp. */
  expiresAt: string;
  /** Any blocking reasons derived from the policy. */
  blockingReasons: string[];
}

/* ------------------------------------------------------------------ */
/* Combined generation eligibility                                     */
/* ------------------------------------------------------------------ */

/**
 * Combined result of both gates (requirements + AI policy).
 *
 * This replaces the old simple `generationEligible: boolean`.
 * Generation is allowed ONLY when BOTH `requirementsEligible` is true
 * AND `aiPolicy.generationAllowed` is true.
 */
export interface GenerationEligibility {
  /** Whether requirements verification passed. */
  requirementsEligible: boolean;
  /** AI usage policy record. */
  aiPolicy: AiUsagePolicy;
  /** Final generation eligible = requirementsEligible AND aiPolicy.generationAllowed. */
  finalGenerationEligible: boolean;
  /** All blocking reasons from both gates. */
  blockingReasons: string[];
  /** Whether generation was blocked specifically by AI policy. */
  generationBlockedByPolicy: boolean;
}
