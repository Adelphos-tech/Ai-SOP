import { getOpenAIClient } from "../openai-client";
import { AI_CONFIG, getModelForStage, StageName } from "../config";
import { calculateStageCost } from "../pricing";
import { buildPlannerPrompt } from "../prompts/legacy/planner";
import { AiInput } from "./build-ai-input";
import { PlannerOutput, TokenUsage, UsageLogEntry, StageUsage } from "../types";
import { logUsage } from "../usage-logger";

export async function planSop(input: AiInput): Promise<{ result: PlannerOutput; usage: TokenUsage; stageUsage: StageUsage } | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const model = getModelForStage("planner" as StageName);
  const { system, user } = buildPlannerPrompt(input);
  const start = Date.now();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: AI_CONFIG.maxCompletionTokensJson,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "";
    if (!content) throw new Error("Planner returned empty content");
    let result;
    try {
      result = JSON.parse(content) as PlannerOutput;
    } catch (e) {
      console.error("PLANNER JSON PARSE ERROR. Content length:", content.length, "First 200:", content.substring(0, 200));
      throw new Error("Planner returned invalid JSON: " + content.substring(0, 100));
    }
    const duration = Date.now() - start;

    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;
    const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;
    const responseId = response.id || "";

    const cost = calculateStageCost(model, promptTokens, cachedTokens, completionTokens);

    const usage: TokenUsage = {
      promptTokens, completionTokens, totalTokens, cachedTokens, reasoningTokens, responseId,
    };

    const stageUsage: StageUsage = {
      stage: "planner",
      model,
      responseId,
      durationMs: duration,
      inputTokens: promptTokens,
      cachedInputTokens: cachedTokens,
      outputTokens: completionTokens,
      totalTokens,
      reasoningTokens,
      estimatedCostUsd: cost.totalCostUsd,
      success: true,
    };

    await logUsage({
      timestamp: new Date().toISOString(),
      model, pipelineStage: "planner",
      inputTokens: promptTokens, cachedInputTokens: cachedTokens,
      outputTokens: completionTokens, totalTokens, reasoningTokens,
      estimatedCostUsd: cost.totalCostUsd, duration, success: true,
    } as UsageLogEntry);

    return { result, usage, stageUsage };
  } catch (error: any) {
    const duration = Date.now() - start;
    console.error("PLANNER ERROR:", error?.message, error?.status, error?.error);
    await logUsage({
      timestamp: new Date().toISOString(), model, pipelineStage: "planner",
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0,
      reasoningTokens: 0, estimatedCostUsd: 0, duration, success: false,
    } as UsageLogEntry);
    throw error;
  }
}
