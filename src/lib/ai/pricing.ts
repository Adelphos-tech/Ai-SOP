// Centralized OpenAI pricing configuration
// Last updated: 2026-09-09
// Source: OpenAI API pricing page

export interface ModelPricing {
  inputPerMillion: number;      // USD per 1M input tokens
  cachedInputPerMillion: number; // USD per 1M cached input tokens
  outputPerMillion: number;    // USD per 1M output tokens
}

export const PRICING_VERSION = "2026-10-30";
export const PRICING_SOURCE = "OpenAI API pricing page (Standard tier, verified 2026-10-23)";

// GPT-5.6 Sol pricing
const GPT_56_SOL_PRICING: ModelPricing = {
  inputPerMillion: 4.00,
  cachedInputPerMillion: 0.40,
  outputPerMillion: 20.00,
};

// GPT-5.6 Terra pricing — confirmed rates, NOT a Sol placeholder
const GPT_56_TERRA_PRICING: ModelPricing = {
  inputPerMillion: 2.00,
  cachedInputPerMillion: 0.20,
  outputPerMillion: 12.00,
};

// GPT-5.6 Luna pricing — verified official rates; replaces the previous
// Sol-rate placeholder which overestimated Luna cost ~17–20x.
const GPT_56_LUNA_PRICING: ModelPricing = {
  inputPerMillion: 0.20,
  cachedInputPerMillion: 0.02,
  outputPerMillion: 1.20,
};

// GPT-6.1 Sol pricing — verified official rates (half of 5.6 Sol).
const GPT_61_SOL_PRICING: ModelPricing = {
  inputPerMillion: 2.00,
  cachedInputPerMillion: 0.10,
  outputPerMillion: 10.00,
};

// GPT-6 Sol / Luna pricing — verified official rates.
const GPT_6_SOL_PRICING: ModelPricing = {
  inputPerMillion: 2.00,
  cachedInputPerMillion: 0.20,
  outputPerMillion: 10.00,
};
const GPT_6_LUNA_PRICING: ModelPricing = {
  inputPerMillion: 0.10,
  cachedInputPerMillion: 0.01,
  outputPerMillion: 0.50,
};

// Groq gpt-oss-120b — Groq on-demand pricing (testing tier)
const GROQ_GPT_OSS_120B_PRICING: ModelPricing = {
  inputPerMillion: 0.15,
  cachedInputPerMillion: 0.15,
  outputPerMillion: 0.75,
};

// Pricing registry — keyed by model name
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.6-sol": GPT_56_SOL_PRICING,
  "gpt-5.6-terra": GPT_56_TERRA_PRICING,
  "gpt-5.6-luna": GPT_56_LUNA_PRICING,
  "gpt-6.1-sol": GPT_61_SOL_PRICING,
  "gpt-6-sol": GPT_6_SOL_PRICING,
  "gpt-6-luna": GPT_6_LUNA_PRICING,
  "openai/gpt-oss-120b": GROQ_GPT_OSS_120B_PRICING,
  "openai/gpt-oss-20b": { inputPerMillion: 0.075, cachedInputPerMillion: 0.075, outputPerMillion: 0.30 },
  // Gemini paid-tier rates (free tier bills $0 — rates recorded for visibility)
  "gemini-2.5-flash": { inputPerMillion: 0.30, cachedInputPerMillion: 0.075, outputPerMillion: 2.50 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.10, cachedInputPerMillion: 0.025, outputPerMillion: 0.40 },
};

/** True when the model has an explicitly verified pricing entry. */
export function hasPricingForModel(model: string): boolean {
  return model in MODEL_PRICING;
}

/**
 * Models in `models` that have no verified pricing entry. Used by
 * configuration validation so an unpriced model is caught at
 * configuration/preflight time instead of silently billed at Sol rates.
 */
export function findUnpricedModels(models: string[]): string[] {
  return models.filter(m => !hasPricingForModel(m));
}

const warnedUnpricedModels = new Set<string>();

/**
 * Pricing lookup. Unknown models keep the historical Sol-rate fallback
 * (existing persisted estimates and tests rely on it), but the fallback
 * is now LOUD — each unknown model warns once so misconfigurations are
 * never silent. Use `findUnpricedModels` to fail earlier at validation.
 */
export function getPricingForModel(model: string): ModelPricing {
  const pricing = MODEL_PRICING[model];
  if (pricing) return pricing;
  if (!warnedUnpricedModels.has(model)) {
    warnedUnpricedModels.add(model);
    console.warn(
      `[pricing] MODEL_PRICING has no verified entry for "${model}" — ` +
      `estimating at gpt-5.6-sol rates. Add verified pricing to the registry.`
    );
  }
  return GPT_56_SOL_PRICING;
}

export interface CostBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export function calculateStageCost(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): CostBreakdown {
  const pricing = getPricingForModel(model);
  const uncachedInput = inputTokens - cachedInputTokens;

  const inputCostUsd = (uncachedInput * pricing.inputPerMillion) / 1_000_000;
  const cachedInputCostUsd = (cachedInputTokens * pricing.cachedInputPerMillion) / 1_000_000;
  const outputCostUsd = (outputTokens * pricing.outputPerMillion) / 1_000_000;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    inputCostUsd,
    cachedInputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd,
  };
}
