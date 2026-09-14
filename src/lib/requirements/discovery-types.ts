// ============================================================
// OFFICIAL REQUIREMENTS DISCOVERY — TYPE DEFINITIONS
// Phase SOP-AI-27
// ============================================================
// Discovery input → search → fetch → classify → extract → validate
// → VerifiedApplicationContext
//
// AI is used for page classification and structured extraction,
// but AI is NEVER the source of truth. Every verified field
// must be supported by retrieved official-source evidence.
// ============================================================

import { ApplicationIdentity, SourceRecord, RequirementStatus } from "./types";
import { AiUsagePolicy, AiPolicyStatus } from "./ai-policy-types";
import { ResponseComponent } from "./generation-contract-types";
import { VerifiedApplicationContext, ApplicationVerificationStatus } from "./application-context";

// ============================================================
// DISCOVERY INPUT
// ============================================================

export interface ApplicationDiscoveryInput {
  university: string;
  program: string;
  degree: string;
  intake: string;
  country: string;
  /** Intake year (e.g., "2027") */
  intakeYear?: string;
  /** Optional: school/department for more targeted discovery */
  school?: string;
  /** Optional: department for more targeted discovery */
  department?: string;
  /** Optional: campus for multi-campus universities */
  campus?: string;
  /** Optional: consultant-provided official requirements URL (hint only) */
  hintRequirementsUrl?: string;
  /** Optional: consultant-provided official AI policy URL (hint only) */
  hintAiPolicyUrl?: string;
  /** Force re-discovery even if cache exists */
  forceRefresh?: boolean;
}

// ============================================================
// CANDIDATE SOURCE
// ============================================================

export type CandidateSourceType =
  | "PROGRAM_REQUIREMENTS"
  | "APPLICATION_REQUIREMENTS"
  | "STATEMENT_REQUIREMENTS"
  | "PERSONAL_STATEMENT_REQUIREMENTS"
  | "AI_USAGE_POLICY"
  | "GRADUATE_ADMISSIONS_POLICY"
  | "FACULTY_DIRECTORY"
  | "PROGRAM_FACULTY"
  | "OFFICIAL_PDF"
  | "OTHER_OFFICIAL";

export type SourceScope =
  | "UNIVERSITY"
  | "GRADUATE_SCHOOL"
  | "SCHOOL"
  | "DEPARTMENT"
  | "PROGRAM"
  | "APPLICATION"
  | "INTAKE_SPECIFIC";

export interface CandidateSource {
  url: string;
  sourceType: CandidateSourceType;
  /** How this URL was discovered: "REGISTRY" | "SEARCH" | "CONSULTANT_HINT" | "LINK_DISCOVERY" */
  discoveryMethod: string;
  /** Search query that led to this URL, if from search */
  searchQuery?: string;
  /** Title/snippet from search results (NOT evidence — discovery hint only) */
  searchSnippet?: string;
  /** Whether the domain was verified as official */
  domainVerified: boolean;
  /** Official organization name from domain verification */
  officialOrganization?: string;
  /** Official domain */
  officialDomain?: string;
}

// ============================================================
// FETCHED PAGE
// ============================================================

export type PageClassificationStatus =
  | "RELEVANT"
  | "NOT_RELEVANT"
  | "REQUIRES_RENDERING"
  | "FETCH_FAILED"
  | "EXTRACTION_UNAVAILABLE";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  redirectChain: string[];
  httpStatus: number;
  contentType: string;
  html: string;
  extractedText: string;
  title: string;
  headings: string[];
  links: string[];
  retrievedAt: string;
  contentHash: string;
  domainVerified: boolean;
  officialDomain: string;
  officialOrganization: string;
  /** Whether the page was JS-only and couldn't be read */
  requiresRendering: boolean;
  /** Whether this is a PDF */
  isPdf: boolean;
}

// ============================================================
// AI PAGE CLASSIFICATION
// ============================================================

export interface PageClassification {
  pageType: CandidateSourceType;
  relevance: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  scope: SourceScope;
  programMatch: boolean;
  intakeMatch: boolean;
  usefulFor: string[];
  confidence: number;
  /** AI model that produced this classification */
  model: string;
}

// ============================================================
// AI REQUIREMENTS EXTRACTION
// ============================================================

export interface ExtractedField<T = any> {
  fieldName: string;
  value: T;
  status: RequirementStatus;
  /** Evidence text from the official page supporting this field */
  evidenceText: string;
  /** Source ID of the page this was extracted from */
  sourceId: string;
  /** Source URL */
  sourceUrl: string;
  /** Scope of the source */
  sourceScope: SourceScope;
  /** AI confidence 0-1 */
  confidence: number;
  /** Whether this field was extracted by AI or deterministically */
  extractionMethod: "AI" | "DETERMINISTIC";
}

export interface ExtractedRequirements {
  sopRequired: ExtractedField<boolean>;
  documentName: ExtractedField<string | null>;
  officialPrompt: ExtractedField<string | null>;
  numberOfComponents: ExtractedField<number>;
  wordMin: ExtractedField<number | null>;
  wordMax: ExtractedField<number | null>;
  characterLimit: ExtractedField<number | null>;
  pageMax: ExtractedField<number | null>;
  formattingRequirements: ExtractedField<string[]>;
  mandatoryTopics: ExtractedField<string[]>;
  facultyRequired: ExtractedField<boolean>;
  programSpecificInstructions: ExtractedField<string | null>;
  aiGenerationPolicy: ExtractedField<string | null>;
  aiEditingPolicy: ExtractedField<string | null>;
  aiProofreadingPolicy: ExtractedField<string | null>;
  aiBrainstormingPolicy: ExtractedField<string | null>;
}

// ============================================================
// DISCOVERY RESULT
// ============================================================

export interface DiscoveryConflict {
  field: string;
  sources: string[];
  values: any[];
  description: string;
}

export interface UnresolvedField {
  fieldName: string;
  reason: string;
  status: RequirementStatus;
}

export interface DiscoveryDiagnostics {
  cacheStatus: "CACHE_HIT" | "CACHE_MISS" | "CACHE_STALE";
  searchQueriesUsed: string[];
  candidateSourcesFound: number;
  pagesFetched: number;
  pagesClassified: number;
  pagesExtracted: number;
  aiClassificationCalls: number;
  aiExtractionCalls: number;
  redirectRejections: number;
  thirdPartyRejections: number;
  jsOnlyPages: number;
  pdfPages: number;
  internalLinksDiscovered: number;
  sitemapUrlsFound: number;
  aiPolicySearchQueries: number;
  budgetExhausted: boolean;
  stopReason: string | null;
  mostSpecificSourceUrl: string | null;
  mostSpecificSourceScope: string | null;
}

export interface DiscoveryCost {
  searchOperations: number;
  fetches: number;
  aiClassificationCalls: number;
  aiExtractionCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  estimatedInr: number;
  duration: number;
}

export interface ApplicationDiscoveryResult {
  status: ApplicationVerificationStatus;
  context: VerifiedApplicationContext | null;
  candidateSources: CandidateSource[];
  verifiedSources: SourceRecord[];
  unresolvedFields: UnresolvedField[];
  conflicts: DiscoveryConflict[];
  diagnostics: DiscoveryDiagnostics;
  cost: DiscoveryCost;
  error: string | null;
}

// ============================================================
// SEARCH PROVIDER INTERFACE
// ============================================================

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface OfficialSourceSearchProvider {
  search(query: string, allowedDomains?: string[]): Promise<SearchResult[]>;
}

// ============================================================
// BUDGET LIMITS
// ============================================================

export const DISCOVERY_BUDGET = {
  MAX_SEARCH_QUERIES: 12,
  MAX_CANDIDATE_URLS: 20,
  MAX_PAGES_FETCHED: 12,
  MAX_AI_CLASSIFICATION_CALLS: 8,
  MAX_AI_EXTRACTION_CALLS: 6,
  MAX_TOTAL_DISCOVERY_CALLS: 14,
  MAX_INTERNAL_LINK_DEPTH: 2,
  MAX_SITEMAP_URLS: 20,
  MAX_AI_POLICY_SEARCH_QUERIES: 5,
} as const;

// ============================================================
// DISCOVERY MODEL CONFIG
// ============================================================

export const DISCOVERY_MODEL = process.env.OPENAI_DISCOVERY_MODEL || "gpt-5.6-sol";

export const DISCOVERY_TEMPERATURE = 1; // gpt-5.6-sol only supports default temperature
export const DISCOVERY_MAX_TOKENS = 4000;
