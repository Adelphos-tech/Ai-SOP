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

// GPT-5.6 Terra pricing — confirmed rates, NOT a Sol placeholder
const GPT_56_TERRA_PRICING: ModelPricing = {
  inputPerMillion: 2.00,
  cachedInputPerMillion: 0.20,
  outputPerMillion: 12.00,
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
  "gpt-5.6-luna": GPT_56_SOL_PRICING,  // placeholder — update when Luna pricing confirmed
  "openai/gpt-oss-120b": GROQ_GPT_OSS_120B_PRICING,
  "openai/gpt-oss-20b": { inputPerMillion: 0.075, cachedInputPerMillion: 0.075, outputPerMillion: 0.30 },
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
