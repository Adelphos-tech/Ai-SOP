export interface PlannerOutput {
  opening_strategy: string;
  academic_story: string[];
  key_experiences: string[];
  program_connection: string;
  career_progression: string;
  personalization_points: string[];
  facts_to_prioritize: string[];
  facts_to_omit: string[];
}

export interface FactReviewOutput {
  pass: boolean;
  unsupported_claims: string[];
  altered_claims: string[];
  ambiguous_claims: string[];
  corrections_required: string[];
}

export interface QualityReviewOutput {
  scores: {
    personalization: number;
    narrative_flow: number;
    academic_story: number;
    career_alignment: number;
    course_relevance: number;
    naturalness: number;
    professional_tone: number;
    generic_language: number;
    repetition: number;
    resume_in_prose: number;
    opening_quality: number;
    conclusion_quality: number;
    sentence_variety: number;
    fact_coverage: number;
  };
  major_issues: string[];
  recommended_edits: string[];
}

export interface LanguageProfile {
  level: string;
  tone: string;
  personalization: string;
  technicalDetail: string;
  openingStyle: string;
  sopLength: string;
  customMinWords?: string;
  customMaxWords?: string;
  actualEnglishProficiency: {
    testType: string;
    overallScore: string;
    writingScore: string;
  };
}

export interface StageUsage {
  stage: string;
  model: string;
  responseId: string;
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  success: boolean;
  /**
   * Pricing rates applied at generation time (USD per 1M tokens).
   * Persisted so historical generation costs don't silently change
   * when pricing.ts is updated later.
   */
  pricingRates?: {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  };
}

export interface PipelineCost {
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDurationMs: number;
  estimatedApiCostUSD: number;
  estimatedApiCostINR: number;
  exchangeRate: {
    pair: string;
    rate: number;
    source: string;
    retrievedAt: string;
    stale: boolean;
  };
  stages: StageUsage[];
}

export interface PipelineResult {
  status: "success" | "error" | "partial" | "cancelled";
  planner: PlannerOutput | null;
  draft: string;
  // Phase 38A: factReview/qualityReview now use typed contracts from model-output-types.ts.
  // Legacy PipelineResult uses `any` since run-sop-pipeline.ts is a legacy wrapper.
  factReview: any | null;
  qualityReview: any | null;
  languageProfile: LanguageProfile | null;
  finalSop: string;
  metrics: {
    wordCount: number;
    model: string;
    stages: number;
    duration: number;
    cost: PipelineCost | null;
  };
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  responseId: string;
}

/** How the provider response powering this row was obtained. */
export type UsageRequestKind =
  | "NEW_PROVIDER_REQUEST"        // freshly created paid provider response
  | "REUSED_PROVIDER_RESPONSE"    // existing response polled to completion — no new charge
  | "POLL"                        // retrieval-only operation — never a charge
  | "RETRY_NEW_PROVIDER_REQUEST"; // bounded retry created a new response after a retryable terminal failure

/** Cost certainty — "tokens unavailable" is NOT "zero cost". */
export type UsageCertainty =
  | "USAGE_KNOWN"              // provider returned usage for this response
  | "USAGE_UNKNOWN"            // tokens/cost could not be determined — cost may be non-zero
  | "NOT_CHARGED_CONFIRMED";   // request provably never reached the provider (preflight/400)

export interface UsageLogEntry {
  timestamp: string;
  model: string;
  pipelineStage: string;
  // --- correlation (null when unavailable — never invented) ---
  generationId?: string | null;
  generationRunId?: string | null;
  attemptSeq?: number | null;
  documentId?: string | null;
  provider?: string | null;
  providerResponseId?: string | null;
  requestKind?: UsageRequestKind | null;
  errorCode?: string | null;
  usageStatus?: UsageCertainty | null;
  // --- usage (null = unknown, NOT zero-cost) ---
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  duration: number;
  success: boolean;
  /** Token-budget telemetry (Responses API: reasoning + visible share
   * the ceiling). Optional — absent on legacy entries. */
  maxOutputTokens?: number;
  visibleOutputTokens?: number;
  utilizationRatio?: number;
  note?: string;
}
