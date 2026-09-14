import { getOpenAIClient } from "../openai-client";
import { AI_CONFIG, getModelForStage, StageName } from "../config";
import { calculateStageCost } from "../pricing";
import { buildLanguageCalibratorPrompt } from "../prompts/legacy/language-calibrator";
import { LanguageProfile, TokenUsage, UsageLogEntry, StageUsage } from "../types";
import { logUsage } from "../usage-logger";

export async function calibrateLanguage(draft: string, profile: LanguageProfile): Promise<{ result: string; usage: TokenUsage; stageUsage: StageUsage } | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const model = getModelForStage("languageCalibrator" as StageName);
  const { system, user } = buildLanguageCalibratorPrompt(draft, profile);
  const start = Date.now();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_completion_tokens: AI_CONFIG.maxCompletionTokens,
    });

    const content = response.choices[0]?.message?.content || "";
    const duration = Date.now() - start;

    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;
    const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;
    const responseId = response.id || "";

    const cost = calculateStageCost(model, promptTokens, cachedTokens, completionTokens);
    const usage: TokenUsage = { promptTokens, completionTokens, totalTokens, cachedTokens, reasoningTokens, responseId };
    const stageUsage: StageUsage = {
      stage: "languageCalibrator", model, responseId, durationMs: duration,
      inputTokens: promptTokens, cachedInputTokens: cachedTokens,
      outputTokens: completionTokens, totalTokens, reasoningTokens,
      estimatedCostUsd: cost.totalCostUsd, success: true,
    };

    await logUsage({
      timestamp: new Date().toISOString(), model, pipelineStage: "languageCalibrator",
      inputTokens: promptTokens, cachedInputTokens: cachedTokens,
      outputTokens: completionTokens, totalTokens, reasoningTokens,
      estimatedCostUsd: cost.totalCostUsd, duration, success: true,
    } as UsageLogEntry);

    return { result: content, usage, stageUsage };
  } catch (error) {
    const duration = Date.now() - start;
    await logUsage({
      timestamp: new Date().toISOString(), model, pipelineStage: "languageCalibrator",
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0,
      reasoningTokens: 0, estimatedCostUsd: 0, duration, success: false,
    } as UsageLogEntry);
    throw error;
  }
}
