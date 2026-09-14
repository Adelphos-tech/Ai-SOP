export type StageName = "planner" | "writer" | "factReviewer" | "qualityReviewer" | "languageCalibrator" | "finalizer";

const DEFAULT_MODEL = process.env.OPENAI_SOP_MODEL || "gpt-5.6-sol";

// Per-stage model configuration — all use Sol for quality baseline
// Future: can override individual stages with cheaper models
export const AI_MODELS: Record<StageName, string> = {
  planner: process.env.OPENAI_MODEL_PLANNER || DEFAULT_MODEL,
  writer: process.env.OPENAI_MODEL_WRITER || DEFAULT_MODEL,
  factReviewer: process.env.OPENAI_MODEL_FACT_REVIEWER || DEFAULT_MODEL,
  qualityReviewer: process.env.OPENAI_MODEL_QUALITY_REVIEWER || DEFAULT_MODEL,
  languageCalibrator: process.env.OPENAI_MODEL_LANGUAGE_CALIBRATOR || DEFAULT_MODEL,
  finalizer: process.env.OPENAI_MODEL_FINALIZER || DEFAULT_MODEL,
};

/**
 * Per-stage max completion token configuration.
 *
 * The Final Fact Reviewer (stage 6) requires a higher budget because
 * gpt-5.6-sol uses reasoning tokens that count against the completion
 * limit. With 4000 tokens, reasoning consumed the entire budget and
 * the model returned empty content (discovered in MIT #002).
 *
 * The factReviewer budget is set to 8000 to allow substantial reasoning
 * while leaving room for the JSON fact classification output.
 *
 * Other stages do NOT need this increase — their reasoning + output
 * fits within 8000 tokens.
 */
export const STAGE_MAX_COMPLETION_TOKENS: Record<StageName, number> = {
  planner: 8000,
  writer: 8000,
  factReviewer: 8000,
  qualityReviewer: 8000,
  languageCalibrator: 8000,
  finalizer: 8000,
};

export const AI_CONFIG = {
  maxCompletionTokens: 4000,
  maxCompletionTokensJson: 8000,
  temperature: 0.7,
  temperatureJson: 0.3,
  temperatureCalibrate: 0.5,
  temperatureFinalize: 0.6,
  timeout: 120000,
  pipelineTimeout: 600000,
};

export const STAGE_NAMES = {
  planner: "SOP Planner",
  writer: "Draft Writer",
  factReviewer: "Fact Reviewer",
  qualityReviewer: "Quality Reviewer",
  languageCalibrator: "Language Calibrator",
  finalizer: "Finalizer",
} as const;

// Cost guardrails
export const COST_GUARDRAILS = {
  MAX_PIPELINE_CALLS: 6,
  MAX_COST_USD_PER_SOP: 5.0, // $5 max per SOP
  MAX_TOTAL_INPUT_TOKENS: 200000,
  MAX_TOTAL_OUTPUT_TOKENS: 20000,
};

export function getModelForStage(stage: StageName): string {
  return AI_MODELS[stage];
}

export function getAllModelsUsed(): string[] {
  return Array.from(new Set(Object.values(AI_MODELS)));
}

/**
 * Get the max completion tokens for a specific stage.
 * Uses per-stage configuration if available, falls back to AI_CONFIG.
 */
export function getMaxCompletionTokensForStage(stage: StageName): number {
  return STAGE_MAX_COMPLETION_TOKENS[stage] || AI_CONFIG.maxCompletionTokensJson;
}

/**
 * Get the prompt version hash for checkpoint validity.
 * This changes when any prompt template is modified.
 */
export function getPromptVersionHash(): string {
  // Version tag — update when any prompt template changes
  return "prompt-v12-2026-09-09";
}
