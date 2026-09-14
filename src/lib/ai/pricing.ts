// Centralized OpenAI pricing configuration
// Last updated: 2026-09-09
// Source: OpenAI API pricing page

export interface ModelPricing {
  inputPerMillion: number;      // USD per 1M input tokens
  cachedInputPerMillion: number; // USD per 1M cached input tokens
  outputPerMillion: number;    // USD per 1M output tokens
}

export const PRICING_VERSION = "2026-09-09";
export const PRICING_SOURCE = "OpenAI API pricing page";

// GPT-5.6 Sol pricing
const GPT_56_SOL_PRICING: ModelPricing = {
  inputPerMillion: 4.00,
  cachedInputPerMillion: 0.40,
  outputPerMillion: 20.00,
};

// Pricing registry — keyed by model name
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.6-sol": GPT_56_SOL_PRICING,
  "gpt-5.6-terra": GPT_56_SOL_PRICING, // placeholder — update when Terra pricing confirmed
  "gpt-5.6-luna": GPT_56_SOL_PRICING,  // placeholder — update when Luna pricing confirmed
};

export function getPricingForModel(model: string): ModelPricing {
  return MODEL_PRICING[model] || GPT_56_SOL_PRICING;
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
