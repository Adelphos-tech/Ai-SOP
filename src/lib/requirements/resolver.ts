import {
  ApplicationIdentity,
  RequirementsResolutionRequest,
  RequirementsResolutionResult,
  VerifiedApplicationBrief,
  DocumentRequirement,
  SourceRecord,
  FieldProvenance,
  RequirementStatus,
  VerificationResult,
  ConflictRecord,
} from "./types";
import { generateCacheKey, isFresh, calculateExpiry } from "./freshness";
import { loadBriefByIdentity, saveBrief } from "./requirements-db";
import { detectConflicts } from "./conflict-detector";
import { fetchOfficialPage, extractRequirementsFromHtml } from "./html-extractor";
import { lookupRequirementsPageUrls, lookupAiPolicyPageUrls, verifyOfficialDomain } from "./domain-verification";
import { detectAiPolicyFromText, buildAiUsagePolicy } from "./ai-policy-verifier";
import { AiPolicySource, AiUsagePolicy } from "./ai-policy-types";

/**
 * Create an unverified brief with all fields marked UNKNOWN.
 * HARD RULE: If a requirement cannot be verified, mark as UNKNOWN, never use generic fallback.
 */
export function createUnverifiedBrief(identity: ApplicationIdentity): VerifiedApplicationBrief {
  const now = new Date().toISOString();
  const cacheKey = generateCacheKey(identity);

  const defaultDoc: DocumentRequirement = {
    documentType: "STATEMENT_OF_PURPOSE",
    documentTypeLabel: "Statement of Purpose",
    required: true,
    officialPrompt: {
      rawText: null,
      status: "UNKNOWN" as RequirementStatus,
      provenance: null,
    },
    wordLimit: {
      min: null,
      max: null,
      status: "UNKNOWN" as RequirementStatus,
      provenance: null,
    },
    characterLimit: {
      min: null,
      max: null,
      status: "UNKNOWN" as RequirementStatus,
      provenance: null,
    },
    requiredTopics: [],
    formatInstructions: [],
    additionalQuestions: [],
  };

  const verification: VerificationResult = {
    status: "UNVERIFIED",
    verifiedAt: now,
    conflicts: [],
    blockingIssues: [
      { field: "officialPrompt", issue: "Official SOP/essay instructions not verified", severity: "BLOCK" },
      { field: "wordLimit", issue: "Word/character requirement status unknown", severity: "BLOCK" },
    ],
  };

  return {
    applicationIdentity: identity,
    documents: [defaultDoc],
    countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
    sources: [],
    verification,
    cacheKey,
    createdAt: now,
    expiresAt: null,
  };
}

/**
 * Resolve official requirements page URLs for a university.
 * Registry first, student-provided fallback.
 */
function resolveOfficialUrls(
  identity: ApplicationIdentity,
  studentProvidedRequirementsUrl?: string,
  studentProvidedAiPolicyUrl?: string
): { requirementsUrls: string[]; aiPolicyUrls: string[] } {
  const registryReqUrls = lookupRequirementsPageUrls(identity.university);
  const registryAiUrls = lookupAiPolicyPageUrls(identity.university);

  const requirementsUrls = registryReqUrls.length > 0
    ? registryReqUrls
    : (studentProvidedRequirementsUrl ? [studentProvidedRequirementsUrl] : []);

  const aiPolicyUrls = registryAiUrls.length > 0
    ? registryAiUrls
    : (studentProvidedAiPolicyUrl ? [studentProvidedAiPolicyUrl] : []);

  return { requirementsUrls, aiPolicyUrls };
}

/**
 * Fetch and extract requirements from an official page.
 */
async function fetchAndExtractRequirements(
  url: string,
  identity: ApplicationIdentity
): Promise<{
  source: SourceRecord;
  wordLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
  characterLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
  promptText: string | null;
} | null> {
  try {
    const { html, httpStatus, contentHash } = await fetchOfficialPage(url);
    const extracted = extractRequirementsFromHtml(html, url);

    const domainCheck = verifyOfficialDomain(url, "OFFICIAL_UNIVERSITY_WEBPAGE");
    const hostname = new URL(url).hostname;

    const source: SourceRecord = {
      sourceId: `SRC-${hostname}-${contentHash.substring(0, 8)}`,
      sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE",
      title: hostname,
      officialOrganization: domainCheck.organization || hostname,
      officialDomain: hostname,
      url,
      retrievedAt: new Date().toISOString(),
      publishedOrUpdatedAt: null,
      programMatch: true,
      degreeLevelMatch: true,
      intakeMatch: true,
      countryMatch: true,
      httpStatus,
      contentHash,
      status: "ACTIVE",
      priority: "PRIMARY",
    };

    return {
      source,
      wordLimit: extracted.wordLimit,
      characterLimit: extracted.characterLimit,
      promptText: extracted.promptText,
    };
  } catch (err: any) {
    console.error(`[resolver] Failed to fetch requirements from ${url}:`, err?.message || err);
    return null;
  }
}

/**
 * Fetch and detect AI policy from an official page.
 */
async function fetchAndDetectAiPolicy(
  url: string,
  identity: ApplicationIdentity
): Promise<{ source: AiPolicySource; policyText: string } | null> {
  try {
    const { html, httpStatus } = await fetchOfficialPage(url);

    // Strip scripts/styles and extract text content
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const domainCheck = verifyOfficialDomain(url, "OFFICIAL_UNIVERSITY_WEBPAGE");
    const hostname = new URL(url).hostname;

    const source: AiPolicySource = {
      sourceId: `AIPOL-${hostname}-${Date.now().toString(36)}`,
      title: hostname,
      url,
      officialDomain: hostname,
      domainVerified: domainCheck.verified,
      sourceType: "OFFICIAL_UNIVERSITY_WEBPAGE",
      exactPolicyText: cleaned.substring(0, 5000),
      retrievedAt: new Date().toISOString(),
      applicableScope: identity.program || "",
      priority: "PRIMARY",
      httpStatus,
    };

    return { source, policyText: cleaned };
  } catch (err: any) {
    console.error(`[resolver] Failed to fetch AI policy from ${url}:`, err?.message || err);
    return null;
  }
}

/**
 * Build a VERIFIED brief from fetched official requirements.
 */
function buildVerifiedBrief(
  identity: ApplicationIdentity,
  sources: SourceRecord[],
  extracted: {
    wordLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
    characterLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
    promptText: string | null;
  }[],
  aiPolicySources: AiPolicySource[]
): { brief: VerifiedApplicationBrief; aiPolicy: AiUsagePolicy } {
  const now = new Date().toISOString();
  const cacheKey = generateCacheKey(identity);

  // Use the first source that had a prompt
  const promptSource = extracted.find(e => e.promptText);
  const promptStatus: RequirementStatus = promptSource?.promptText ? "VERIFIED" : "UNKNOWN";
  const promptProvenance: FieldProvenance | null = promptSource?.promptText && sources[0]
    ? {
        field: "officialPrompt",
        value: promptSource.promptText,
        status: "VERIFIED",
        sourceId: sources[0].sourceId,
        sourceQuote: promptSource.promptText,
        verifiedAt: now,
        programMatch: true,
        intakeMatch: true,
      }
    : null;

  // Use the first source that had a word limit
  const wordSource = extracted.find(e => e.wordLimit.status === "VERIFIED");
  const wordStatus: RequirementStatus = wordSource?.wordLimit.status === "VERIFIED" ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE";

  // Use the first source that had a character limit
  const charSource = extracted.find(e => e.characterLimit.status === "VERIFIED");
  const charStatus: RequirementStatus = charSource?.characterLimit.status === "VERIFIED" ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE";

  const doc: DocumentRequirement = {
    documentType: "STATEMENT_OF_PURPOSE",
    documentTypeLabel: "Statement of Purpose",
    required: true,
    officialPrompt: {
      rawText: promptSource?.promptText || null,
      status: promptStatus,
      provenance: promptProvenance,
    },
    wordLimit: {
      min: wordSource?.wordLimit.min || null,
      max: wordSource?.wordLimit.max || null,
      status: wordStatus,
      provenance: wordSource && sources[0] ? {
        field: "wordLimit",
        value: wordSource.wordLimit.max,
        status: "VERIFIED",
        sourceId: sources[0].sourceId,
        sourceQuote: wordSource.wordLimit.quote,
        verifiedAt: now,
        programMatch: true,
        intakeMatch: true,
      } : null,
    },
    characterLimit: {
      min: charSource?.characterLimit.min || null,
      max: charSource?.characterLimit.max || null,
      status: charStatus,
      provenance: charSource && sources[0] ? {
        field: "characterLimit",
        value: charSource.characterLimit.max,
        status: "VERIFIED",
        sourceId: sources[0].sourceId,
        sourceQuote: charSource.characterLimit.quote,
        verifiedAt: now,
        programMatch: true,
        intakeMatch: true,
      } : null,
    },
    requiredTopics: [],
    formatInstructions: [],
    additionalQuestions: [],
  };

  // Determine verification status based on what was actually extracted
  const hasPrompt = promptStatus === "VERIFIED";
  const hasWordLimit = wordStatus === "VERIFIED";
  const hasSources = sources.length > 0;
  const hasAnyRequirement = hasPrompt || hasWordLimit;

  let verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "BLOCKED";
  const blockingIssues: any[] = [];

  if (!hasSources) {
    verificationStatus = "UNVERIFIED";
    blockingIssues.push({ field: "sources", issue: "No official sources could be fetched", severity: "BLOCK" });
  } else if (!hasAnyRequirement) {
    verificationStatus = "PARTIALLY_VERIFIED";
    blockingIssues.push({ field: "officialPrompt", issue: "Official SOP prompt not found on fetched pages", severity: "BLOCK" });
  } else if (!hasPrompt) {
    verificationStatus = "PARTIALLY_VERIFIED";
    blockingIssues.push({ field: "officialPrompt", issue: "Official SOP prompt not found", severity: "WARN" });
  } else {
    verificationStatus = "VERIFIED";
  }

  const verification: VerificationResult = {
    status: verificationStatus,
    verifiedAt: now,
    conflicts: [],
    blockingIssues,
  };

  const brief: VerifiedApplicationBrief = {
    applicationIdentity: identity,
    documents: [doc],
    countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
    sources,
    verification,
    cacheKey,
    createdAt: now,
    expiresAt: verificationStatus === "VERIFIED" ? calculateExpiry(now) : null,
  };

  // Detect conflicts
  const conflicts = detectConflicts(brief);
  if (conflicts.length > 0) {
    brief.verification.status = "CONFLICT";
    brief.verification.conflicts = conflicts;
    brief.verification.blockingIssues = conflicts.map(c => ({
      field: c.field,
      issue: `Conflict between official sources for ${c.field}`,
      severity: "BLOCK",
    }));
  }

  // Build AI policy from fetched sources
  const aiPolicy = buildAiUsagePolicy(aiPolicySources, identity);

  return { brief, aiPolicy };
}

/**
 * Main requirements resolver.
 * Fetches official requirements and AI policy from official pages.
 * Registry first, student-provided URLs as fallback.
 */
export async function resolveRequirements(
  request: RequirementsResolutionRequest
): Promise<RequirementsResolutionResult> {
  const start = Date.now();
  const identity = request.applicationIdentity;

  // Check cache first
  if (!request.forceRefresh) {
    const cached = await loadBriefByIdentity(identity);
    if (cached && isFresh(cached)) {
      return {
        status: cached.verification.status === "VERIFIED" ? "RESOLVED" :
                cached.verification.status === "CONFLICT" ? "CONFLICT" :
                cached.verification.status === "BLOCKED" ? "BLOCKED" : "PARTIALLY_RESOLVED",
        brief: cached,
        aiPolicy: null,
        error: null,
        costUsd: 0,
        costInr: 0,
        duration: Date.now() - start,
        fromCache: true,
      };
    }
  }

  // Resolve official URLs (registry first, student-provided fallback)
  const { requirementsUrls, aiPolicyUrls } = resolveOfficialUrls(
    identity,
    request.studentProvidedRequirementsUrl,
    request.studentProvidedAiPolicyUrl
  );

  // If no URLs available, return BLOCKED
  if (requirementsUrls.length === 0 && aiPolicyUrls.length === 0) {
    const brief = createUnverifiedBrief(identity);
    await saveBrief(brief);
    return {
      status: "BLOCKED",
      brief,
      aiPolicy: null,
      error: "No official source URLs available. University not in registry and no student-provided URLs.",
      costUsd: 0,
      costInr: 0,
      duration: Date.now() - start,
      fromCache: false,
    };
  }

  // Fetch and extract requirements from all available URLs
  const sources: SourceRecord[] = [];
  const extracted: any[] = [];

  for (const url of requirementsUrls) {
    const result = await fetchAndExtractRequirements(url, identity);
    if (result) {
      sources.push(result.source);
      extracted.push({
        wordLimit: result.wordLimit,
        characterLimit: result.characterLimit,
        promptText: result.promptText,
      });
    }
  }

  // Fetch and detect AI policy from all available URLs
  const aiPolicySources: AiPolicySource[] = [];
  for (const url of aiPolicyUrls) {
    const result = await fetchAndDetectAiPolicy(url, identity);
    if (result) {
      aiPolicySources.push(result.source);
    }
  }

  // If we couldn't fetch anything, return BLOCKED
  if (sources.length === 0 && aiPolicySources.length === 0) {
    const brief = createUnverifiedBrief(identity);
    await saveBrief(brief);
    return {
      status: "BLOCKED",
      brief,
      aiPolicy: null,
      error: "Could not fetch any official source pages.",
      costUsd: 0,
      costInr: 0,
      duration: Date.now() - start,
      fromCache: false,
    };
  }

  // Build the verified brief and AI policy
  const { brief, aiPolicy } = buildVerifiedBrief(identity, sources, extracted, aiPolicySources);

  // Save to cache
  await saveBrief(brief);

  const status = brief.verification.status === "VERIFIED" ? "RESOLVED" :
                 brief.verification.status === "CONFLICT" ? "CONFLICT" :
                 "PARTIALLY_RESOLVED";

  return {
    status,
    brief,
    aiPolicy,
    error: null,
    costUsd: 0,
    costInr: 0,
    duration: Date.now() - start,
    fromCache: false,
  };
}

/**
 * Create a verified brief from test fixture data.
 * Used by test fixtures to simulate verified requirements.
 */
export function createVerifiedBriefFromFixture(
  identity: ApplicationIdentity,
  sources: SourceRecord[],
  documents: DocumentRequirement[],
  countryGuidanceItems: FieldProvenance[] = [],
  countryGuidanceSourceId: string | null = null
): VerifiedApplicationBrief {
  const now = new Date().toISOString();
  const cacheKey = generateCacheKey(identity);

  const brief: VerifiedApplicationBrief = {
    applicationIdentity: identity,
    documents,
    countryGuidance: {
      items: countryGuidanceItems,
      priority: "SECONDARY",
      sourceId: countryGuidanceSourceId,
    },
    sources,
    verification: {
      status: "VERIFIED",
      verifiedAt: now,
      conflicts: [],
      blockingIssues: [],
    },
    cacheKey,
    createdAt: now,
    expiresAt: calculateExpiry(now),
  };

  // Detect conflicts
  const conflicts = detectConflicts(brief);
  if (conflicts.length > 0) {
    brief.verification.status = "CONFLICT";
    brief.verification.conflicts = conflicts;
    brief.verification.blockingIssues = conflicts.map(c => ({
      field: c.field,
      issue: `Conflict between official sources for ${c.field}`,
      severity: "BLOCK",
    }));
  }

  return brief;
}
