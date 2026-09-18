// ============================================================
// OpenAI STAGE TRANSPORT — Background Responses
// ============================================================
// Replaces long-lived synchronous chat.completions calls with
// OpenAI Background Responses so slow stages (Writer >120s) can
// complete without being killed by a client HTTP timeout.
//
// One abstraction for all six stages:
//   startBackgroundStage()   → POST /responses {background:true}
//   getBackgroundStage()     → GET  /responses/{id}
//   cancelBackgroundStage()  → POST /responses/{id}/cancel
//   waitForBackgroundStage() → poll loop: heartbeat-aware,
//                              cancel-aware, SLA-bounded
//
// `store: true` — required for background responses to remain
// retrievable for polling/cancellation (OpenAI retains background
// response data temporarily for this purpose; the applicant content
// is already sent to the model for processing, so polling retention
// adds no new data category).
// ============================================================

import OpenAI from "openai";
import { createHash } from "crypto";
import { getOpenAIClient } from "./openai-client";
import { getModelForStage, getMaxCompletionTokensForStage, StageName } from "./config";
import type { StageUsage } from "./types";
import { calculateStageCost, getPricingForModel } from "./pricing";
import { logUsage } from "./usage-logger";
import type { UsageLogEntry } from "./types";

// ---------- configuration ----------

export const BACKGROUND_RESPONSES_ENABLED = process.env.OPENAI_BACKGROUND_RESPONSES_ENABLED !== "0";

/** Short network timeout for create/retrieve/cancel — NOT the stage SLA. */
const PROVIDER_HTTP_TIMEOUT_MS = 30_000;
/** Provider poll interval (server-side, inside the pipeline). */
const PROVIDER_POLL_MS = 2_500;
const PROVIDER_POLL_JITTER_MS = 700;

/** Per-stage SLA — how long the provider may legitimately work.
 * Defaults derived from usage telemetry (writer p99 ≈ 86s, but
 * background queueing adds latency — generous headroom, env-tunable).
 * HTTP timeout ≠ stage SLA. */
export function getStageSlaMs(stage: StageName): number {
  const envKey = {
    planner: "OPENAI_STAGE_SLA_PLANNER_MS",
    writer: "OPENAI_STAGE_SLA_WRITER_MS",
    qualityReviewer: "OPENAI_STAGE_SLA_QUALITY_REVIEWER_MS",
    languageCalibrator: "OPENAI_STAGE_SLA_LANGUAGE_MS",
    finalizer: "OPENAI_STAGE_SLA_FINALIZER_MS",
    factReviewer: "OPENAI_STAGE_SLA_FACT_REVIEWER_MS",
  }[stage];
  const env = envKey ? parseInt(process.env[envKey] || "", 10) : NaN;
  if (Number.isFinite(env) && env > 0) return env;
  return stage === "writer" ? 480_000 : 300_000;
}

/** Hard ceiling for an entire generation. */
export function getMaxGenerationDurationMs(): number {
  const env = parseInt(process.env.MAX_GENERATION_DURATION_MS || "", 10);
  return Number.isFinite(env) && env > 0 ? env : 1_200_000; // 20 min
}

// ---------- types ----------

export type ProviderStatus =
  | "queued" | "in_progress" | "completed"
  | "failed" | "incomplete" | "cancelled";

export interface ProviderPollResult {
  status: ProviderStatus;
  outputText?: string;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  errorCode?: string;
  errorMessage?: string;
}

export interface StageTransport {
  startBackgroundStage(stage: StageName, systemPrompt: string, userPrompt: string): Promise<string>;
  getBackgroundStage(responseId: string): Promise<ProviderPollResult>;
  cancelBackgroundStage(responseId: string): Promise<void>;
}

export interface WaitHooks {
  /** Called every poll tick — throw to abort (e.g. cancel requested). */
  onTick?: (elapsedMs: number) => Promise<void> | void;
  /** Called when the provider status changes. */
  onStatus?: (status: ProviderStatus, responseId: string) => Promise<void> | void;
}

export class StageTimeoutError extends Error {
  constructor(public stage: string, public slaMs: number) {
    super(`STAGE_TIMEOUT:${stage}`);
    this.name = "StageTimeoutError";
  }
}
export class GenerationTimeLimitError extends Error {
  constructor() {
    super("GENERATION_TIME_LIMIT");
    this.name = "GenerationTimeLimitError";
  }
}
export class ProviderTerminalError extends Error {
  /** Usage present on a terminal (e.g. incomplete) response — the
   * caller reconciles it instead of recording NULL. */
  public providerUsage?: ProviderPollResult["usage"];
  constructor(public code: string, message: string, public retryable: boolean) {
    super(message);
    this.name = "ProviderTerminalError";
  }
}

// ---------- failure classification ----------

function isTransientProviderError(result: ProviderPollResult): boolean {
  const code = result.errorCode || "";
  const msg = result.errorMessage || "";
  if (/rate_limit|429|server_error|5\d\d|overloaded|timeout/i.test(code)) return true;
  if (/rate limit|temporarily|overloaded|internal error|timed out/i.test(msg)) return true;
  return false;
}

function isTransientTransportError(e: any): boolean {
  const name = e?.name || "";
  if (["APIConnectionError", "APIConnectionTimeoutError", "TimeoutError", "RateLimitError", "InternalServerError"].includes(name)) return true;
  const status = e?.status;
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

// ---------- circuit breaker (in-process, single-instance) ----------

const CB_WINDOW_MS = 90_000;
const CB_OPEN_MS = 60_000;
const CB_THRESHOLD = 3;
const recentProviderFailures = new Map<string, number>(); // runId → ts
let circuitOpenUntil = 0;

export function recordProviderTerminalFailure(runId: string, retryable: boolean): void {
  if (!retryable || !runId) return;
  recentProviderFailures.set(runId, Date.now());
  const cutoff = Date.now() - CB_WINDOW_MS;
  recentProviderFailures.forEach((ts, k) => { if (ts < cutoff) recentProviderFailures.delete(k); });
  if (recentProviderFailures.size >= CB_THRESHOLD) circuitOpenUntil = Date.now() + CB_OPEN_MS;
}

export function isProviderCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

// ---------- repeat-failure fingerprint (spec 20) ----------

export function computeStageFingerprint(input: {
  generationContractHash: string; stage: string; model: string;
  evidenceHash?: string; promptHash?: string;
}): string {
  return createHash("sha256")
    .update(`${input.generationContractHash}|${input.stage}|${input.model}|${input.evidenceHash || ""}|${input.promptHash || ""}`)
    .digest("hex").slice(0, 32);
}

const fingerprintFailures = new Map<string, number>();
export function recordFingerprintFailure(fp: string): number {
  const n = (fingerprintFailures.get(fp) || 0) + 1;
  fingerprintFailures.set(fp, n);
  return n;
}
export function getFingerprintFailureCount(fp: string): number {
  return fingerprintFailures.get(fp) || 0;
}

// ---------- real transport ----------

/** Required when using text.format=json_object — OpenAI rejects the
 * request unless the input/instructions mention "json". Injected
 * deterministically by the transport; never left to prompt authors. */
const JSON_OUTPUT_INSTRUCTION =
  "Return the final result as a valid JSON object only.";

export class JsonInstructionMissingError extends Error {
  constructor() {
    super("OPENAI_JSON_INSTRUCTION_MISSING");
    this.name = "JsonInstructionMissingError";
  }
}
export class ProviderInvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderInvalidRequestError";
  }
}

/**
 * Build the Responses create params for a stage. Deterministic:
 * json_object gets the canonical JSON instruction appended when the
 * system prompt lacks it; preflight throws before any provider call
 * if the effective payload still lacks an explicit JSON instruction.
 */
export function buildResponsesCreateParams(
  stage: StageName, systemPrompt: string, userPrompt: string,
): Record<string, unknown> {
  const instructions = /json/i.test(systemPrompt)
    ? systemPrompt
    : `${systemPrompt}\n\n${JSON_OUTPUT_INSTRUCTION}`;
  // The "json" keyword check applies to INPUT messages — inject the
  // directive into the user input as well when absent there.
  const userText = /json/i.test(userPrompt)
    ? userPrompt
    : `${userPrompt}\n\n${JSON_OUTPUT_INSTRUCTION}`;
  if (!/json/i.test(userText)) {
    throw new JsonInstructionMissingError();
  }
  return {
    model: getModelForStage(stage),
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
    background: true,
    store: true,
    max_output_tokens: getMaxCompletionTokensForStage(stage),
    text: { format: { type: "json_object" } },
  };
}

export class OpenAIResponsesTransport implements StageTransport {
  async startBackgroundStage(stage: StageName, systemPrompt: string, userPrompt: string): Promise<string> {
    // Preflight runs BEFORE the client check — a malformed request
    // must never reach OpenAI as a 400.
    const params = buildResponsesCreateParams(stage, systemPrompt, userPrompt);
    const client = getOpenAIClient();
    if (!client) throw new Error("OpenAI client not available");
    let response: any;
    try {
      response = await client.responses.create(params as any, {
        timeout: PROVIDER_HTTP_TIMEOUT_MS, maxRetries: 0,
      });
    } catch (e: any) {
      // Malformed requests are not transient — zero retry, no circuit.
      if (e?.status === 400 || /invalid_request/i.test(e?.code || "")) {
        throw new ProviderInvalidRequestError(e?.message || "Invalid request");
      }
      throw e;
    }
    const id = (response as any)?.id;
    if (!id) throw new Error("Provider did not return a response id");
    return id;
  }

  async getBackgroundStage(responseId: string): Promise<ProviderPollResult> {
    const client = getOpenAIClient();
    if (!client) throw new Error("OpenAI client not available");
    // One bounded retry on transient retrieval failure — never creates
    // a second response (spec: retry retrieval, not the stage).
    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r: any = await client.responses.retrieve(responseId, undefined, {
          timeout: PROVIDER_HTTP_TIMEOUT_MS,
          maxRetries: 0,
        });
        const status = String(r.status || "in_progress") as ProviderStatus;
        const usage = r.usage
          ? {
              inputTokens: r.usage.input_tokens ?? 0,
              cachedInputTokens: r.usage.input_tokens_details?.cached_tokens ?? 0,
              outputTokens: r.usage.output_tokens ?? 0,
              reasoningTokens: r.usage.output_tokens_details?.reasoning_tokens ?? 0,
              totalTokens: r.usage.total_tokens ?? 0,
            }
          : undefined;
        return {
          status,
          outputText: status === "completed" ? (r.output_text ?? "") : undefined,
          usage,
          errorCode: r.error?.code || r.incomplete_details?.reason || undefined,
          errorMessage: r.error?.message || undefined,
        };
      } catch (e: any) {
        lastErr = e;
        if (!isTransientTransportError(e) || attempt === 1) throw e;
        await new Promise(r => setTimeout(r, 800));
      }
    }
    throw lastErr;
  }

  async cancelBackgroundStage(responseId: string): Promise<void> {
    const client = getOpenAIClient();
    if (!client) return;
    try {
      await client.responses.cancel(responseId, { timeout: PROVIDER_HTTP_TIMEOUT_MS, maxRetries: 0 });
    } catch (e) {
      console.error(JSON.stringify({ event: "provider_cancel_failed", responseId, error: (e as any)?.message }));
    }
  }
}

// ---------- mock transport (deterministic tests — zero OpenAI calls) ----------

export interface MockScript {
  /** Statuses returned in sequence per getBackgroundStage call; last repeats. */
  statuses: ProviderStatus[];
  outputText?: string;
  usage?: ProviderPollResult["usage"];
  errorCode?: string;
  errorMessage?: string;
  /** Number of retrieve calls that throw a transient network error first. */
  transientRetrieveFailures?: number;
  /** If set, start throws this error. */
  startError?: Error;
}

export class MockResponsesTransport implements StageTransport {
  scripts = new Map<string, MockScript>();
  calls = { start: 0, retrieve: 0, cancel: 0 };
  private seq = 0;
  private polls = new Map<string, number>();
  private transientLeft = new Map<string, number>();
  /** Queue of scripts consumed by successive startBackgroundStage calls. */
  private nextQueue: MockScript[] = [];

  queueScript(statuses: ProviderStatus[], extra?: Partial<MockScript>): string {
    const id = `resp_mock_${++this.seq}`;
    this.scripts.set(id, { statuses, ...extra });
    return id;
  }
  /** Pre-seed a known id (resume tests). "__next__" enqueues a script
   * consumed by the next startBackgroundStage call. */
  seedResponse(id: string, script: MockScript): void {
    if (id === "__next__") this.nextQueue.push(script);
    else this.scripts.set(id, script);
  }

  async startBackgroundStage(_s: StageName, _sp: string, _up: string): Promise<string> {
    this.calls.start++;
    const next = this.nextQueue.shift();
    if (next?.startError) throw next.startError;
    const id = `resp_mock_${++this.seq}`;
    this.scripts.set(id, next ? { ...next } : { statuses: ["in_progress"] });
    return id;
  }

  async getBackgroundStage(responseId: string): Promise<ProviderPollResult> {
    this.calls.retrieve++;
    const left = this.transientLeft.get(responseId) ?? this.scripts.get(responseId)?.transientRetrieveFailures ?? 0;
    if (left > 0) {
      this.transientLeft.set(responseId, left - 1);
      const err: any = new Error("mock network failure");
      err.name = "APIConnectionError";
      throw err;
    }
    const script = this.scripts.get(responseId) || { statuses: ["completed"] };
    const i = this.polls.get(responseId) ?? 0;
    this.polls.set(responseId, i + 1);
    const status = script.statuses[Math.min(i, script.statuses.length - 1)];
    return {
      status,
      outputText: status === "completed" ? (script.outputText ?? "{}") : undefined,
      // Provider may include usage on terminal non-completed states
      // (e.g. incomplete) — return it whenever scripted.
      usage: script.usage,
      errorCode: script.errorCode,
      errorMessage: script.errorMessage,
    };
  }

  async cancelBackgroundStage(responseId: string): Promise<void> {
    this.calls.cancel++;
    const script = this.scripts.get(responseId);
    if (script) script.statuses = ["cancelled"];
  }
}

// ---------- transport registry (injectable for tests) ----------

let _transport: StageTransport | null = null;
export function getStageTransport(): StageTransport {
  if (!_transport) _transport = new OpenAIResponsesTransport();
  return _transport;
}
export function setStageTransport(t: StageTransport | null): void {
  _transport = t;
}

// ---------- wait loop ----------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Poll a background provider response until terminal.
 * - never restarts the stage because elapsed time passed
 * - stage SLA + generation SLA cancel the provider response first
 * - onTick hook enforces cancellation/heartbeat each tick
 * - terminal transient failures throw ProviderTerminalError(retryable)
 *   — the CALLER decides whether to create a new response (max once)
 */
export async function waitForBackgroundStage(opts: {
  transport: StageTransport;
  responseId: string;
  stage: StageName;
  stageStartedAtMs: number;
  generationStartedAtMs: number;
  pollMs?: number;
  hooks?: WaitHooks;
}): Promise<ProviderPollResult> {
  const { transport, responseId, stage } = opts;
  const slaMs = getStageSlaMs(stage);
  const pollMs = opts.pollMs ?? PROVIDER_POLL_MS;

  while (true) {
    const elapsed = Date.now() - opts.stageStartedAtMs;
    const totalElapsed = Date.now() - opts.generationStartedAtMs;

    if (totalElapsed > getMaxGenerationDurationMs()) {
      await transport.cancelBackgroundStage(responseId);
      throw new GenerationTimeLimitError();
    }
    if (elapsed > slaMs) {
      await transport.cancelBackgroundStage(responseId);
      throw new StageTimeoutError(stage, slaMs);
    }

    await opts.hooks?.onTick?.(elapsed);

    const result = await transport.getBackgroundStage(responseId);
    await opts.hooks?.onStatus?.(result.status, responseId);

    if (result.status === "completed") {
      if (!result.outputText || !result.outputText.trim()) {
        throw new ProviderTerminalError("EMPTY_OUTPUT", `${stage} returned empty content`, true);
      }
      return result;
    }
    if (result.status === "cancelled") {
      throw new ProviderTerminalError("PROVIDER_CANCELLED", "Provider response cancelled", false);
    }
    if (result.status === "incomplete") {
      // Classify the provider's incomplete_details.reason into stable
      // internal codes — never collapse to generic PROVIDER_INCOMPLETE
      // and never retry (budget/content issues aren't transient).
      const reason = (result.errorCode || "").toLowerCase();
      const code =
        reason === "max_output_tokens" ? "MAX_OUTPUT_TOKENS" :
        reason === "content_filter" ? "CONTENT_FILTER" :
        reason === "max_messages" ? "MAX_MESSAGES" :
        reason === "steered" ? "STEERED" :
        "INCOMPLETE_UNKNOWN";
      const err = new ProviderTerminalError(
        code,
        `Provider incomplete: ${reason || "unknown"}`,
        false,
      );
      // Incomplete responses may still carry usage — attach it so the
      // caller can reconcile instead of recording NULL.
      err.providerUsage = result.usage;
      throw err;
    }
    if (result.status === "failed") {
      const retryable = isTransientProviderError(result);
      throw new ProviderTerminalError(
        result.errorCode || "FAILED",
        result.errorMessage || "Provider failed",
        retryable,
      );
    }
    // queued / in_progress → keep waiting (heartbeat keeps running).
    await sleep(pollMs + Math.floor(Math.random() * PROVIDER_POLL_JITTER_MS));
  }
}

/** Map a completed provider poll into the existing StageUsage contract. */
/** Compute output-budget utilization for a stage. Responses API:
 * reasoning + visible output share max_output_tokens. */
export function computeOutputUtilization(stage: StageName, usage?: {
  outputTokens: number; reasoningTokens: number;
} | null): {
  maxOutputTokens: number;
  visibleOutputTokens: number;
  utilizationRatio: number;
} {
  const maxOutputTokens = getMaxCompletionTokensForStage(stage);
  const output = usage?.outputTokens ?? 0;
  const reasoning = usage?.reasoningTokens ?? 0;
  return {
    maxOutputTokens,
    visibleOutputTokens: Math.max(0, output - reasoning),
    utilizationRatio: maxOutputTokens > 0 ? output / maxOutputTokens : 0,
  };
}

/** Log internal utilization warnings (never shown to consultants). */
export function logUtilizationWarning(opts: {
  stage: StageName; generationId?: string | null;
  totalOutputTokens: number; maxOutputTokens: number; utilizationRatio: number;
}): void {
  const { utilizationRatio } = opts;
  if (utilizationRatio < 0.8) return;
  const event = utilizationRatio >= 0.9
    ? "CRITICAL_OUTPUT_BUDGET_UTILIZATION"
    : "HIGH_OUTPUT_BUDGET_UTILIZATION";
  console.warn(JSON.stringify({
    event,
    generationId: opts.generationId || null,
    stage: opts.stage,
    totalOutputTokens: opts.totalOutputTokens,
    maxOutputTokens: opts.maxOutputTokens,
    utilization: Number(utilizationRatio.toFixed(4)),
  }));
}

/** Internal verbosity regression warnings — non-blocking, based on
 * compact-contract targets. Logs only; never fails generation. */
const VERBOSITY_WARN_TOKENS: Partial<Record<StageName, { limit: number; event: string }>> = {
  qualityReviewer: { limit: 4000, event: "REVIEWER_OUTPUT_VERBOSE" },
  factReviewer: { limit: 3500, event: "FACT_REVIEW_OUTPUT_VERBOSE" },
  languageCalibrator: { limit: 2500, event: "LANGUAGE_OUTPUT_VERBOSE" },
};

export async function stageUsageFromProvider(opts: {
  stage: StageName;
  responseId: string;
  usage?: ProviderPollResult["usage"];
  durationMs: number;
  generationId?: string | null;
}): Promise<StageUsage> {
  const model = getModelForStage(opts.stage);
  const u = opts.usage;
  if (!u) {
    await logUsage({
      timestamp: new Date().toISOString(), model, pipelineStage: opts.stage,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0,
      reasoningTokens: 0, estimatedCostUsd: 0, duration: opts.durationMs,
      success: false, note: "USAGE_UNKNOWN",
    } as UsageLogEntry);
    return {
      stage: opts.stage, model, responseId: opts.responseId, durationMs: opts.durationMs,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0,
      reasoningTokens: 0, estimatedCostUsd: 0, success: false, pricingRates: getPricingForModel(model),
    };
  }
  const cost = calculateStageCost(model, u.inputTokens, u.cachedInputTokens, u.outputTokens);
  const util = computeOutputUtilization(opts.stage, u);
  const vWarn = VERBOSITY_WARN_TOKENS[opts.stage];
  if (vWarn && u.outputTokens > vWarn.limit) {
    console.warn(JSON.stringify({
      event: vWarn.event, generationId: opts.generationId || null,
      stage: opts.stage, totalOutputTokens: u.outputTokens,
      compactTarget: vWarn.limit,
    }));
  }
  logUtilizationWarning({
    stage: opts.stage, generationId: opts.generationId,
    totalOutputTokens: u.outputTokens, maxOutputTokens: util.maxOutputTokens,
    utilizationRatio: util.utilizationRatio,
  });
  await logUsage({
    timestamp: new Date().toISOString(), model, pipelineStage: opts.stage,
    inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens,
    outputTokens: u.outputTokens, totalTokens: u.totalTokens,
    reasoningTokens: u.reasoningTokens, estimatedCostUsd: cost.totalCostUsd,
    duration: opts.durationMs, success: true,
    maxOutputTokens: util.maxOutputTokens,
    visibleOutputTokens: util.visibleOutputTokens,
    utilizationRatio: Number(util.utilizationRatio.toFixed(4)),
  } as UsageLogEntry);
  return {
    stage: opts.stage, model, responseId: opts.responseId, durationMs: opts.durationMs,
    inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens,
    outputTokens: u.outputTokens, totalTokens: u.totalTokens,
    reasoningTokens: u.reasoningTokens, estimatedCostUsd: cost.totalCostUsd,
    success: true, pricingRates: getPricingForModel(model),
  };
}
