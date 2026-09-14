/**
 * @file ai-policy-verifier.ts
 * @description
 * AI Usage Policy Verifier for the Application Requirements Engine.
 *
 * This module verifies whether an official institution permits generative AI
 * assistance for application materials. It is SEPARATE from requirements
 * verification — both must pass before SOP generation.
 *
 * HARD RULE: If no official AI policy can be found, generation is BLOCKED.
 * Silence is NOT permission. UNKNOWN is NOT permission.
 */

import {
  AiPolicyStatus,
  AiActionPermission,
  ApplicationAiMode,
  AiPolicySource,
  AiUsagePolicy,
  GenerationEligibility,
} from "./ai-policy-types";
import { generateCacheKey } from "./freshness";

/* ------------------------------------------------------------------ */
/* Policy detection from official text                                 */
/* ------------------------------------------------------------------ */

/**
 * Detect AI policy status from official source text.
 *
 * This is a deterministic keyword/pattern-based detector. It looks for
 * explicit statements about generative AI in application materials.
 *
 * Patterns recognized:
 *   - Prohibition: "generative artificial intelligence", "AI-generated",
 *     "may not be created by", "work may not be that of a third party nor
 *     that created by generative"
 *   - Permission: "AI tools may be used", "generative AI is permitted"
 *   - Restriction: "AI may assist with", "limited to proofreading"
 *
 * @param text Official source text to analyze.
 * @returns Detected status, or AI_POLICY_NOT_FOUND if no AI policy text found.
 */
export function detectAiPolicyFromText(text: string): AiPolicyStatus {
  if (!text) return "AI_POLICY_NOT_FOUND";

  const lower = text.toLowerCase();

  // ===== Check for restricted/limited patterns FIRST =====
  // These are more specific than permission patterns and must be checked first
  // e.g., "may use AI for proofreading" should be RESTRICTED, not ALLOWED
  const restrictedPatterns = [
    "ai may assist with",
    "limited to proofreading",
    "ai for editing only",
    "ai for grammar only",
    "ai assistance is limited",
    "may use ai for proofreading",
    "may use ai for grammar",
    "may not generate original content",
    "ai for proofreading",
    "ai for grammar checking",
    "proofreading and grammar checking only",
    "editing but may not generate",
  ];

  for (const pattern of restrictedPatterns) {
    if (lower.includes(pattern)) {
      return "AI_ASSISTANCE_RESTRICTED";
    }
  }

  // ===== Check for explicit PERMISSION patterns =====
  // This prevents "ai-generated content is permitted" from matching prohibition patterns
  const permissionPatterns = [
    "ai tools may be used",
    "generative ai is permitted",
    "ai assistance is allowed",
    "use of ai is permitted",
    "ai-generated content is permitted",
    "ai generated content is permitted",
    "ai-generated content is allowed",
    "ai generated content is allowed",
    "you may use ai",
    "applicants may use ai",
    "use of generative ai is permitted",
    "use of generative ai is allowed",
  ];

  for (const pattern of permissionPatterns) {
    if (lower.includes(pattern)) {
      return "AI_GENERATION_ALLOWED";
    }
  }

  // ===== Check for prohibition patterns =====
  // More specific patterns that don't match permission statements
  const prohibitionPatterns = [
    "generative artificial intelligence",
    "may not be that of a third party nor that created by generative",
    "may not be created by generative",
    "not be created by generative artificial intelligence",
    "prohibits the use of ai",
    "ai is not permitted",
    "artificial intelligence is prohibited",
    "no ai-generated content",
    "do not use ai",
    "ai-generated content is not permitted",
    "ai generated content is not permitted",
    "ai-generated content is prohibited",
    "ai generated content is prohibited",
    "forbidden to use ai",
    "use of ai is forbidden",
    "use of ai is prohibited",
  ];

  for (const pattern of prohibitionPatterns) {
    if (lower.includes(pattern)) {
      return "AI_GENERATION_PROHIBITED";
    }
  }

  // No AI policy text found
  return "AI_POLICY_NOT_FOUND";
}

/* ------------------------------------------------------------------ */
/* Derive per-action permissions from status                           */
/* ------------------------------------------------------------------ */

/**
 * Derive per-action permissions from the overall policy status.
 *
 * IMPORTANT: Unknown status does NOT grant permission. Only explicit
 * ALLOWED status grants permission for a specific action.
 */
export function deriveActionPermissions(
  status: AiPolicyStatus
): {
  editingAllowed: AiActionPermission;
  proofreadingAllowed: AiActionPermission;
  brainstormingAllowed: AiActionPermission;
  translationAllowed: AiActionPermission;
} {
  switch (status) {
    case "AI_GENERATION_ALLOWED":
      // Full AI writing allowed — all actions permitted
      return {
        editingAllowed: "ALLOWED",
        proofreadingAllowed: "ALLOWED",
        brainstormingAllowed: "ALLOWED",
        translationAllowed: "ALLOWED",
      };

    case "AI_ASSISTANCE_RESTRICTED":
      // Limited assistance — generation blocked, but some actions may be allowed
      // We do NOT infer which actions are allowed without explicit text.
      // Default: all unknown (not permission)
      return {
        editingAllowed: "UNKNOWN",
        proofreadingAllowed: "UNKNOWN",
        brainstormingAllowed: "UNKNOWN",
        translationAllowed: "UNKNOWN",
      };

    case "AI_GENERATION_PROHIBITED":
      // Generation explicitly prohibited
      // Editing/proofreading/etc. are UNKNOWN unless explicitly permitted
      // Do NOT infer that editing is allowed just because only generation is prohibited
      return {
        editingAllowed: "UNKNOWN",
        proofreadingAllowed: "UNKNOWN",
        brainstormingAllowed: "UNKNOWN",
        translationAllowed: "UNKNOWN",
      };

    case "AI_POLICY_NOT_FOUND":
    case "AI_POLICY_AMBIGUOUS":
    case "AI_POLICY_CONFLICT":
    case "REVIEW_REQUIRED":
      // No clear policy — all actions unknown (NOT permission)
      return {
        editingAllowed: "UNKNOWN",
        proofreadingAllowed: "UNKNOWN",
        brainstormingAllowed: "UNKNOWN",
        translationAllowed: "UNKNOWN",
      };
  }
}

/* ------------------------------------------------------------------ */
/* Derive application AI mode                                          */
/* ------------------------------------------------------------------ */

/**
 * Derive the application-level AI mode from the policy status.
 */
export function deriveApplicationAiMode(status: AiPolicyStatus): ApplicationAiMode {
  switch (status) {
    case "AI_GENERATION_ALLOWED":
      return "FULL_AI_WRITING_ALLOWED";
    case "AI_ASSISTANCE_RESTRICTED":
      return "LIMITED_AI_ASSISTANCE";
    case "AI_GENERATION_PROHIBITED":
      return "AI_WRITING_BLOCKED";
    case "AI_POLICY_NOT_FOUND":
    case "AI_POLICY_AMBIGUOUS":
    case "AI_POLICY_CONFLICT":
    case "REVIEW_REQUIRED":
      return "POLICY_REVIEW_REQUIRED";
  }
}

/* ------------------------------------------------------------------ */
/* Build AI usage policy from sources                                  */
/* ------------------------------------------------------------------ */

/**
 * Build an AiUsagePolicy from a set of official policy sources.
 *
 * If multiple sources disagree, status = AI_POLICY_CONFLICT.
 * If no sources provided, status = AI_POLICY_NOT_FOUND (BLOCKS generation).
 *
 * @param sources Official sources containing AI policy text.
 * @param identity Application identity for cache key.
 * @returns Complete AI usage policy record.
 */
export function buildAiUsagePolicy(
  sources: AiPolicySource[],
  identity: { country: string; university: string; program: string; degreeLevel: string; intake: string; intakeYear: string }
): AiUsagePolicy {
  const now = new Date().toISOString();
  const cacheKey = "aipol__" + generateCacheKey(identity);

  // No sources → policy not found
  if (sources.length === 0) {
    return {
      status: "AI_POLICY_NOT_FOUND",
      generationAllowed: false,
      editingAllowed: "UNKNOWN",
      proofreadingAllowed: "UNKNOWN",
      brainstormingAllowed: "UNKNOWN",
      translationAllowed: "UNKNOWN",
      applicationAiMode: "POLICY_REVIEW_REQUIRED",
      sources: [],
      verifiedAt: now,
      cacheKey,
      expiresAt: now,
      blockingReasons: ["AI_POLICY_NOT_FOUND: No official AI usage policy found. Generation blocked under strict official-source policy."],
    };
  }

  // Detect policy status from each source
  const statuses: AiPolicyStatus[] = sources.map(s => detectAiPolicyFromText(s.exactPolicyText));

  // Check for conflicts
  const uniqueStatuses = new Set(statuses.filter(s => s !== "AI_POLICY_NOT_FOUND"));
  if (uniqueStatuses.size > 1) {
    // Multiple different policy statuses → conflict
    return {
      status: "AI_POLICY_CONFLICT",
      generationAllowed: false,
      editingAllowed: "UNKNOWN",
      proofreadingAllowed: "UNKNOWN",
      brainstormingAllowed: "UNKNOWN",
      translationAllowed: "UNKNOWN",
      applicationAiMode: "POLICY_REVIEW_REQUIRED",
      sources,
      verifiedAt: now,
      cacheKey,
      expiresAt: now,
      blockingReasons: [`AI_POLICY_CONFLICT: Official sources disagree on AI policy (${Array.from(uniqueStatuses).join(", ")}).`],
    };
  }

  // Use the detected status (first non-NOT_FOUND, or NOT_FOUND if all are NOT_FOUND)
  const detectedStatus = statuses.find(s => s !== "AI_POLICY_NOT_FOUND") || "AI_POLICY_NOT_FOUND";

  // If all sources had no AI policy text, status is NOT_FOUND
  if (detectedStatus === "AI_POLICY_NOT_FOUND") {
    return {
      status: "AI_POLICY_NOT_FOUND",
      generationAllowed: false,
      editingAllowed: "UNKNOWN",
      proofreadingAllowed: "UNKNOWN",
      brainstormingAllowed: "UNKNOWN",
      translationAllowed: "UNKNOWN",
      applicationAiMode: "POLICY_REVIEW_REQUIRED",
      sources,
      verifiedAt: now,
      cacheKey,
      expiresAt: now,
      blockingReasons: ["AI_POLICY_NOT_FOUND: No official AI usage policy found. Generation blocked under strict official-source policy."],
    };
  }

  // Derive permissions
  const perms = deriveActionPermissions(detectedStatus);
  const mode = deriveApplicationAiMode(detectedStatus);

  // Determine generation allowed
  const generationAllowed = detectedStatus === "AI_GENERATION_ALLOWED";

  // Build blocking reasons
  const blockingReasons: string[] = [];
  if (!generationAllowed) {
    if (detectedStatus === "AI_GENERATION_PROHIBITED") {
      blockingReasons.push("OFFICIAL_AI_POLICY_PROHIBITS_GENERATED_APPLICATION_CONTENT: Official policy prohibits AI-generated application materials.");
    } else if (detectedStatus === "AI_ASSISTANCE_RESTRICTED") {
      blockingReasons.push("AI_ASSISTANCE_RESTRICTED: Official policy limits AI to assistance only, not generation.");
    } else if (detectedStatus === "AI_POLICY_AMBIGUOUS") {
      blockingReasons.push("AI_POLICY_AMBIGUOUS: Official AI policy is unclear.");
    } else if (detectedStatus === "AI_POLICY_CONFLICT") {
      blockingReasons.push("AI_POLICY_CONFLICT: Official sources disagree on AI policy.");
    } else if (detectedStatus === "REVIEW_REQUIRED") {
      blockingReasons.push("REVIEW_REQUIRED: AI policy extraction incomplete.");
    }
  }

  return {
    status: detectedStatus,
    generationAllowed,
    editingAllowed: perms.editingAllowed,
    proofreadingAllowed: perms.proofreadingAllowed,
    brainstormingAllowed: perms.brainstormingAllowed,
    translationAllowed: perms.translationAllowed,
    applicationAiMode: mode,
    sources,
    verifiedAt: now,
    cacheKey,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    blockingReasons,
  };
}

/* ------------------------------------------------------------------ */
/* Combined generation eligibility                                     */
/* ------------------------------------------------------------------ */

/**
 * Compute the combined generation eligibility from both gates.
 *
 * Generation is allowed ONLY when:
 *   1. requirementsEligible = true (requirements verified)
 *   2. aiPolicy.generationAllowed = true (AI policy permits)
 *
 * @param requirementsEligible Whether requirements verification passed.
 * @param aiPolicy AI usage policy record.
 * @returns Combined generation eligibility.
 */
export function computeGenerationEligibility(
  requirementsEligible: boolean,
  aiPolicy: AiUsagePolicy
): GenerationEligibility {
  const finalGenerationEligible = requirementsEligible && aiPolicy.generationAllowed;
  const blockingReasons: string[] = [];

  if (!requirementsEligible) {
    blockingReasons.push("REQUIREMENTS_NOT_VERIFIED: Official application requirements have not been verified.");
  }

  for (const reason of aiPolicy.blockingReasons) {
    blockingReasons.push(reason);
  }

  return {
    requirementsEligible,
    aiPolicy,
    finalGenerationEligible,
    blockingReasons,
    generationBlockedByPolicy: !aiPolicy.generationAllowed,
  };
}
