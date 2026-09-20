/**
 * @file run-application-pipeline.ts
 * @description
 * GENERIC 6-stage OpenAI pipeline, driven entirely by the GenerationContract.
 *
 * Stage order:
 *   1. Planner                          (OpenAI)
 *   2. Writer                           (OpenAI)
 *   3. Quality Reviewer                 (OpenAI)
 *   4. Language Calibrator              (OpenAI)
 *      ↓
 *      DETERMINISTIC PRE-FINAL RENDER   (NO OpenAI call)
 *      ↓
 *      DETERMINISTIC COMPONENT ACTION PLANNING (NO OpenAI call)
 *      ↓
 *   5. Bounded Finalizer               (OpenAI — receives action plan + render feedback)
 *      ↓
 *      DETERMINISTIC FINALIZER GUARD    (NO OpenAI call)
 *      ↓
 *   6. Final Fact Reviewer              (OpenAI — audits ACTUAL final text)
 *      ↓
 *      DETERMINISTIC FINAL RENDER       (NO OpenAI call)
 *      ↓
 *      Submission Status
 *
 * MAX_PIPELINE_CALLS: 6 (unchanged — render checks, action planning, and the
 * finalizer guard are deterministic, not AI)
 *
 * PHASE SOP-AI-12 additions:
 *   - Evidence Ledger built from the Generation Contract
 *   - Deterministic per-component action planning (FREEZE/COMPRESS/REPAIR)
 *   - Bounded Finalizer prompt (action-plan-driven, evidence-locked)
 *   - Finalizer output validation (scope/length/page/evidence guards)
 *   - Durable per-stage checkpoints with resume
 *   - Attempt accounting (successful/partial/technical-retry costs)
 *   - Checkpoint invalidation on contract/prompt/model/render-profile change
 *
 * The pipeline knows NOTHING about specific universities. All application
 * information (prompts, components, faculty, constraints) comes from the
 * GenerationContract.
 */

import { StudentProfile } from "@/types";
import { AI_CONFIG, getAllModelsUsed, getModelForStage, getPromptVersionHash, StageName } from "../config";
import { isApiKeyConfigured } from "../openai-client";
import { buildAiInput } from "./build-ai-input";
import {
  ResponseComponent,
  FacultyAlignment,
  PageLimitConstraint,
  GenerationContract,
} from "@/lib/requirements/generation-contract-types";
import { VerifiedApplicationBrief } from "@/lib/requirements/types";
import { AiUsagePolicy } from "@/lib/requirements/ai-policy-types";
import { buildGenericPlannerPrompt } from "../prompts/generic/planner";
import { buildGenericWriterPrompt } from "../prompts/generic/writer";
import { buildGenericQualityReviewerPrompt } from "../prompts/generic/quality-reviewer";
import { buildGenericLanguageCalibratorPrompt } from "../prompts/generic/language-calibrator";
import { buildGenericFinalFactReviewerPrompt, calculateDeterministicOverallPass } from "../prompts/generic/final-fact-reviewer";
import {
  QualityReviewOutput,
  FactReviewOutput,
  validateQualityReviewOutput,
  validateFactReviewOutput,
  deriveFactReviewTotals,
} from "../model-output-types";
import { buildEvidenceLedger, EvidenceLedger } from "../evidence-ledger";
import { buildApplicationEvidenceBundle, ApplicationEvidenceBundle } from "../application-evidence-bundle";
import { planComponentActions, ActionPlanResult } from "../component-action-planner";
import { buildComponentEvidencePackets, validateWriterEvidenceReferences, ComponentEvidencePacket } from "../component-evidence-packet";
import { normalizeStageOutput } from "./stage-contracts";
import { resolveLengthContext, lengthStatusFor, wordsOf, LengthStatus } from "../length-context";
import {
  validateLanguageCalibratorClaims,
  validateFinalizerClaims,
  checkMissingMandatoryTopics,
  hashClaimSet,
  WriterClaim,
  CalibratedClaim,
  FinalizerClaimOutput,
  RequiredTopicProvenance,
  ClaimProvenanceResult,
} from "../claim-provenance";
import {
  buildBoundedFinalizerPrompt,
  validateFinalizerOutput,
  BoundedFinalizerBlockedError,
  FinalizerGuardResult,
  FinalizerResponse,
} from "../bounded-finalizer";
import { getUsdToInrRate } from "@/lib/currency/exchange-rate";
import { getOpenAIClient } from "../openai-client";
import { calculateStageCost, getPricingForModel } from "../pricing";
import { LanguageProfile, StageUsage, PipelineCost } from "../types";
import { logUsage } from "../usage-logger";
import { UsageLogEntry } from "../types";
import { countWords } from "../validation/word-count";
import { computeSubmissionStatus, FinalCompliance } from "@/lib/output/submission-status";
import { runPostFinalChecks } from "@/lib/output/post-final-checks";
import { DVIVID_STANDARD_APPLICATION_V1 } from "@/lib/render/render-profile";
import { checkMandatoryTopicEvidence, isHardMandatoryTopicStatus } from "@/lib/requirements/generation-gate";
import { runPreFinalRender } from "@/lib/render/pre-final-render";
import { runFinalRender } from "@/lib/render/final-render";
import { RenderFeedback, RenderLifecycleResult } from "@/lib/render/render-lifecycle-types";
import { computeHash, CheckpointHashes } from "../pipeline-checkpoint";
import { resolveNarrativeProfile, buildNarrativePlannerGuidance, buildNarrativeWriterRules, applyVisaReturnHomeRequirement } from "../../application/narrative-profile";
import {
  markStageStarted,
  markStageCompleted,
  heartbeatRun,
  isCancelRequested,
  getRun,
  setProviderState,
  updateProviderCheck,
  setProviderUsage,
  recordStageResponse,
  updateStageResponseStatus,
  setStageResponseUsage,
  findReusableProviderResponse,
  GenerationCancelledError,
} from "../../application/generation-lifecycle";
import {
  BACKGROUND_RESPONSES_ENABLED,
  getStageTransport,
  waitForBackgroundStage,
  stageUsageFromProvider,
  computeStageFingerprint,
  getFingerprintFailureCount,
  recordFingerprintFailure,
  recordProviderTerminalFailure,
  StageTimeoutError,
  GenerationTimeLimitError,
  ProviderTerminalError,
} from "../openai-transport";
import {
  createStageExecution,
  EXECUTION_STAGES,
  ExecutionStage,
  ExecutionMode,
  StageExecution,
  StageExecutionResult,
  StageExecutionError,
} from "./stage-execution";
import { AttemptAccounting } from "../attempt-accounting";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";

export interface ApplicationPipelineExecution {
  generationId: string;
  mode: ExecutionMode;
  /**
   * Authoritative generation run id (generation_runs row). When set,
   * the pipeline persists stage progress, heartbeats, and enforces
   * cancellation boundaries before/after every stage.
   */
  generationRunId?: string;
  /** Document id — used to record provider stage responses for recovery. */
  documentId?: string;
}

export interface ApplicationPipelineInput {
  profile: StudentProfile;
  responseComponents: ResponseComponent[];
  facultyAlignment: FacultyAlignment[];
  pageLimit: PageLimitConstraint;
  programContextText?: string;
  documentTypeLabel?: string;
  /** Phase 33: document-type configuration (perspective, rubric, structure, safety) */
  documentTypeConfig?: any;
  /** Phase 33: writing instructions from document-type config + merged prompt */
  pipelineWritingInstructions?: string;
  /** Phase 33: quality rubric instructions from document-type config */
  qualityRubricInstructions?: string;
  /** Phase 12: authoritative server-side contract (required for bounded finalization) */
  generationContract?: GenerationContract;
  /** Phase 12: verified requirements brief (required for checkpoint hashes) */
  requirementsBrief?: VerifiedApplicationBrief | null;
  /** Phase 12: verified AI usage policy (required for checkpoint hashes) */
  aiPolicy?: AiUsagePolicy | null;
  /** Phase 12: execution/resume options */
  execution?: ApplicationPipelineExecution;
}

export interface ApplicationResponseItem {
  componentId: string;
  title: string;
  text: string;
}

/** Advisory issue — surfaced to the consultant, never aborts the draft. */
export interface GenerationWarning {
  code: string;
  message: string;
}

export interface ApplicationPipelineResult {
  status: "success" | "error" | "cancelled";
  error?: string;
  generationId?: string;
  /** Content/quality/compliance issues that did not prevent a usable draft. */
  warnings: GenerationWarning[];
  planner: any;
  writerOutput: any;
  qualityReview: QualityReviewOutput | null;
  factReview: FactReviewOutput | null;
  calibratedOutput: any;
  finalizedOutput: any;
  actionPlan?: ActionPlanResult;
  finalizerGuard?: FinalizerGuardResult;
  evidenceLedger?: EvidenceLedger;
  /** Phase 14: per-component evidence packets */
  evidencePackets?: ComponentEvidencePacket[];
  /** Phase 14: deterministic Writer evidence validation result */
  writerEvidenceValidation?: { valid: boolean; violations: any[] };
  /** Phase 16: Writer claims with stable IDs */
  writerClaims?: WriterClaim[];
  /** Phase 16: calibrated claims after Language Calibrator */
  calibratedClaims?: CalibratedClaim[];
  /** Phase 16: Language Calibrator claim validation */
  languageCalibratorClaimValidation?: { valid: boolean; violations: any[] };
  /** Phase 16: Finalizer claim provenance validation */
  claimProvenanceValidation?: ClaimProvenanceResult;
  /** Phase 16: required topic provenance */
  requiredTopicProvenance?: Array<{ componentId: string; topics: RequiredTopicProvenance[] }>;
  accounting?: AttemptAccounting;
  compliance: FinalCompliance | null;
  responses: ApplicationResponseItem[];
  finalText: string;
  renderLifecycle: RenderLifecycleResult | null;
  preFinalRenderFeedback: RenderFeedback | null;
  finalRenderFeedback: RenderFeedback | null;
  metrics: {
    wordCount: number;
    model: string;
    stages: number;
    duration: number;
    cost: PipelineCost | null;
    renderChecks: number;
  };
}

/**
 * Build the dependency hashes used for checkpoint validity.
 * A checkpoint may be reused ONLY if all relevant hashes match.
 */
function buildCheckpointHashes(args: {
  contract: GenerationContract;
  brief: VerifiedApplicationBrief | null;
  aiPolicy: AiUsagePolicy | null;
  evidenceLedger: EvidenceLedger;
  renderProfileVersion: string;
}): CheckpointHashes {
  const modelConfigurationHash = computeHash({
    models: AI_CONFIG,
    stageModels: Object.fromEntries(
      (Object.keys(getAllModelsUsed()) as string[]).map(m => [m, m])
    ),
    pricing: "2026-09-09",
  });
  // Phase 21: Use contractSemanticHash for generationContractHash to ensure
  // checkpoint validity is deterministic. The raw contract hash includes
  // volatile fields (contractId, createdAt) that change on every build.
  const semanticHash = args.contract.contractSemanticHash || computeHash(args.contract);
  return {
    generationContractHash: semanticHash,
    contractSemanticHash: semanticHash,
    studentFactsHash: computeHash(args.contract.studentFacts),
    applicationRequirementsHash: computeHash(args.brief),
    aiPolicyHash: computeHash(args.aiPolicy),
    applicationSpecificFactsHash: args.evidenceLedger.ledgerHash,
    modelConfigurationHash,
    promptVersionHash: getPromptVersionHash(),
    renderProfileVersion: args.renderProfileVersion,
  };
}

/**
 * Build calibrated claims from the Language Calibrator response.
 * Compact contract: OMITTED rewrittenText = verbatim preserved
 * (fallback to Writer text); null still means dropped → the claim
 * preservation validator catches it as missing.
 */
export function buildCalibratedClaims(
  calibrated: { responses?: any[]; componentPlans?: any[] },
  writerClaims: Array<{ claimId: string; componentId: string; text: string; evidenceIds: string[] }>,
): CalibratedClaim[] {
  const calibratedClaims: CalibratedClaim[] = [];
  const calResponses = calibrated.responses || calibrated.componentPlans || [];
  for (const resp of calResponses) {
    const claimMap = resp.claimMap || [];
    for (const cm of claimMap) {
      const wClaim = writerClaims.find(wc => wc.claimId === cm.claimId);
      if (cm.rewrittenText !== null && cm.rewrittenText !== undefined) {
        calibratedClaims.push({
          claimId: cm.claimId,
          componentId: resp.componentId,
          rewrittenText: cm.rewrittenText,
          evidenceIds: wClaim?.evidenceIds || [],
        });
      } else if (cm.rewrittenText === undefined && wClaim) {
        calibratedClaims.push({
          claimId: cm.claimId,
          componentId: resp.componentId,
          rewrittenText: wClaim.text,
          evidenceIds: wClaim.evidenceIds || [],
        });
      }
    }
  }

  // If no claimMap was returned, build calibrated claims from Writer claims (fallback)
  if (calibratedClaims.length === 0 && writerClaims.length > 0) {
    for (const wc of writerClaims) {
      calibratedClaims.push({
        claimId: wc.claimId,
        componentId: wc.componentId,
        rewrittenText: wc.text,
        evidenceIds: wc.evidenceIds,
      });
    }
  }
  return calibratedClaims;
}

async function callOpenAIForStage(
  stage: StageName,
  systemPrompt: string,
  userPrompt: string,
  abortSignal?: AbortSignal
): Promise<{ content: string; stageUsage: StageUsage }> {
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI client not available");

  const model = getModelForStage(stage);
  const start = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: AI_CONFIG.maxCompletionTokensJson,
    response_format: { type: "json_object" },
  }, abortSignal ? { signal: abortSignal } : undefined);

  const content = response.choices[0]?.message?.content || "";
  if (!content) throw new Error(`${stage} returned empty content`);

  const duration = Date.now() - start;
  const promptTokens = response.usage?.prompt_tokens || 0;
  const completionTokens = response.usage?.completion_tokens || 0;
  const totalTokens = response.usage?.total_tokens || 0;
  const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
  const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;
  const responseId = response.id || "";

  const cost = calculateStageCost(model, promptTokens, cachedTokens, completionTokens);

  const stageUsage: StageUsage = {
    stage,
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
    // Persist the pricing used at generation time so historical cost
    // records remain reproducible if pricing.ts changes later.
    pricingRates: getPricingForModel(model),
  };

  await logUsage({
    timestamp: new Date().toISOString(),
    model, pipelineStage: stage,
    inputTokens: promptTokens, cachedInputTokens: cachedTokens,
    outputTokens: completionTokens, totalTokens, reasoningTokens,
    estimatedCostUsd: cost.totalCostUsd, duration, success: true,
  } as UsageLogEntry);

  return { content, stageUsage };
}

/**
 * Background-Responses stage call. The provider response id is
 * persisted BEFORE polling so a PM2 restart can resume polling
 * (or reuse the finished result) instead of double-billing.
 * Throws StageExecutionError(technical=false) on terminal failures
 * so the execution manager does not layer a third retry on top of
 * the transport's own bounded single retry.
 */
export async function callOpenAIForStageBackground(
  stage: StageName,
  systemPrompt: string,
  userPrompt: string,
  ctx: {
    generationRunId: string | null;
    documentId: string;
    hashes: CheckpointHashes;
    generationStartedAtMs: number;
    isCancelRequested: () => Promise<boolean>;
  },
): Promise<{ content: string; stageUsage: StageUsage }> {
  const transport = getStageTransport();
  const model = getModelForStage(stage);
  const stageStartedAtMs = Date.now();
  const fingerprint = computeStageFingerprint({
    generationContractHash: ctx.hashes.generationContractHash,
    stage,
    model,
    evidenceHash: ctx.hashes.applicationSpecificFactsHash,
    promptHash: ctx.hashes.promptVersionHash,
  });

  // Repeated identical terminal failures → don't auto-resubmit.
  if (getFingerprintFailureCount(fingerprint) >= 2) {
    throw new StageExecutionError("REPEATED_STAGE_FAILURE", `${stage}: identical work failed repeatedly`, false);
  }

  // Reuse an in-flight/completed provider response for identical work
  // (restart recovery + double-billing guard), preferring this run's
  // own persisted state.
  let responseId: string | null = null;
  if (ctx.generationRunId) {
    try {
      const run = await getRun(ctx.generationRunId);
      if (
        run?.providerResponseId && run.providerStage === stage &&
        run.stageFingerprint === fingerprint &&
        ["queued", "in_progress", "completed"].includes(run.providerResponseStatus || "")
      ) {
        responseId = run.providerResponseId;
      }
    } catch { /* resume check is best-effort */ }
  }
  if (!responseId) {
    try {
      const reusable = await findReusableProviderResponse(stage, fingerprint);
      if (reusable) {
        responseId = reusable.responseId;
        // Reflect the reused response on this run for visibility/recovery.
        if (ctx.generationRunId) {
          try {
            await setProviderState(ctx.generationRunId, { stage, responseId, status: reusable.status, model, fingerprint });
          } catch { /* best-effort */ }
        }
      }
    } catch { /* dedup is best-effort */ }
  }

  const persistResponse = async (id: string, status: string) => {
    if (!ctx.generationRunId) return;
    try {
      await setProviderState(ctx.generationRunId, { stage, responseId: id, status, model, fingerprint });
      await recordStageResponse(ctx.generationRunId, ctx.documentId, { stage, fingerprint, responseId: id, status, model });
    } catch { /* provider persistence is best-effort */ }
  };

  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!responseId) {
      try {
        responseId = await transport.startBackgroundStage(stage, systemPrompt, userPrompt);
      } catch (e: any) {
        // Malformed request / missing JSON instruction — zero retry.
        if (e?.name === "ProviderInvalidRequestError" || e?.name === "JsonInstructionMissingError") {
          if (ctx.generationRunId) {
            try {
              await updateProviderCheck(ctx.generationRunId, "failed", {
                errorCode: "INVALID_REQUEST", errorMessage: e?.message,
              });
            } catch { /* best-effort */ }
          }
          throw new StageExecutionError("PROVIDER_INVALID_REQUEST", "PROVIDER_INVALID_REQUEST", false);
        }
        throw e;
      }
      await persistResponse(responseId, "queued");
    }
    try {
      const result = await waitForBackgroundStage({
        transport,
        responseId,
        stage,
        stageStartedAtMs,
        generationStartedAtMs: ctx.generationStartedAtMs,
        hooks: {
          onTick: async () => {
            if (await ctx.isCancelRequested()) {
              await transport.cancelBackgroundStage(responseId!);
              throw new GenerationCancelledError(stage);
            }
          },
          onStatus: async (status) => {
            if (!ctx.generationRunId) return;
            try {
              await updateProviderCheck(ctx.generationRunId, status);
              await updateStageResponseStatus(responseId!, status);
            } catch { /* best-effort */ }
          },
        },
      });
      const durationMs = Date.now() - stageStartedAtMs;
      if (ctx.generationRunId) {
        try {
          await setProviderUsage(ctx.generationRunId, result.usage || null);
          await setStageResponseUsage(responseId, result.usage || null);
        } catch { /* best-effort */ }
      }
      const stageUsage = await stageUsageFromProvider({
        stage, responseId, usage: result.usage, durationMs,
        generationId: ctx.generationRunId,
      });
      return { content: result.outputText!, stageUsage };
    } catch (e: any) {
      lastError = e;
      // Cancellation must propagate as GenerationCancelledError so the
      // outer pipeline catch produces a "cancelled" result.
      if (e instanceof GenerationCancelledError) throw e;
      if (e instanceof StageTimeoutError || e instanceof GenerationTimeLimitError) {
        throw new StageExecutionError(e instanceof StageTimeoutError ? "STAGE_TIMEOUT" : "GENERATION_TIME_LIMIT", e.message, false);
      }
      if (e instanceof ProviderTerminalError) {
        recordFingerprintFailure(fingerprint);
        if (ctx.generationRunId) {
          recordProviderTerminalFailure(ctx.generationRunId, e.retryable);
          // Persist terminal classification (no applicant content).
          try {
            const incompleteMatch = e.message.match(/^Provider incomplete: (.+)$/);
            const terminalStatus = incompleteMatch ? "incomplete" : "failed";
            await updateProviderCheck(ctx.generationRunId, terminalStatus, {
              errorCode: e.code,
              incompleteReason: incompleteMatch?.[1],
            });
            await updateStageResponseStatus(responseId!, terminalStatus, {
              errorCode: e.code,
              incompleteReason: incompleteMatch?.[1],
            });
            // Reconcile usage even on terminal failure when present.
            if (e.providerUsage) {
              await setProviderUsage(ctx.generationRunId, e.providerUsage);
              await setStageResponseUsage(responseId!, e.providerUsage);
            }
          } catch { /* best-effort */ }
        }
        if (e.code === "PROVIDER_CANCELLED") {
          throw new GenerationCancelledError(stage);
        }
        if (!e.retryable || attempt === 1) {
          throw new StageExecutionError(`PROVIDER_${e.code}`, e.message, false);
        }
        // One controlled retry — create a fresh response for identical work.
        responseId = null;
        continue;
      }
      if (e?.name === "ProviderInvalidRequestError" || e?.name === "JsonInstructionMissingError") {
        // Malformed request — zero retry, no circuit, safe code only.
        throw new StageExecutionError("PROVIDER_INVALID_REQUEST", "PROVIDER_INVALID_REQUEST", false);
      }
      // Unclassified retrieval failure — retryable once via the same response.
      if (attempt === 1) throw new StageExecutionError("PROVIDER_POLL_FAILED", e?.message || "provider poll failed", false);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new StageExecutionError("PROVIDER_FAILED", lastError?.message || "provider failed", false);
}

/**
 * Map the legacy StageName to the ExecutionStage used by the checkpoint manager.
 * The execution manager enforces a single canonical stage order:
 *   planner, writer, qualityReviewer, languageCalibrator, finalizer, factReviewer
 */
function mapStageName(stage: StageName): ExecutionStage {
  // StageName and ExecutionStage share the same identifiers except for
  // factReviewer, which is the same string in both unions.
  return stage as unknown as ExecutionStage;
}

export async function runApplicationPipeline(
  input: ApplicationPipelineInput
): Promise<ApplicationPipelineResult> {
  const pipelineStart = Date.now();
  let renderCheckCount = 0;
  // Content/quality/compliance uncertainty collects here — never fatal.
  const generationWarnings: GenerationWarning[] = [];

  // Capture render profile at start — immutable during the attempt
  const renderProfile = DVIVID_STANDARD_APPLICATION_V1;
  const renderProfileId = renderProfile.renderProfileId;
  const renderProfileVersion = renderProfile.version;

  // Phase 12: require the authoritative contract for bounded finalization.
  if (!input.generationContract) {
    return errorResult("GENERATION_CONTRACT_REQUIRED", pipelineStart, renderCheckCount);
  }

  const contract = input.generationContract;
  const brief = input.requirementsBrief ?? null;
  const aiPolicy = input.aiPolicy ?? null;

  // Build the Evidence Ledger from the contract — the ONLY factual evidence
  // available to the Finalizer.
  const evidenceLedger = buildEvidenceLedger({
    studentFacts: contract.studentFacts,
    programContextText: input.programContextText || "",
    facultyAlignment: contract.facultyAlignment,
    applicationSpecificFacts: (contract.studentFacts as any)?.applicationSpecificFacts,
  });

  // Build dependency hashes for checkpoint validity.
  const hashes = buildCheckpointHashes({
    contract, brief, aiPolicy, evidenceLedger, renderProfileVersion,
  });

  // Resolve execution mode and generation ID.
  const executionMode: ExecutionMode = input.execution?.mode || "CONTENT_REGENERATION";
  const generationId = input.execution?.generationId || randomUUID();

  // Validate generation ID format before any filesystem access.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) {
    return errorResult("INVALID_GENERATION_ID", pipelineStart, renderCheckCount, generationId);
  }

  // Isolated checkpoint directory OUTSIDE immutable historical generation paths.
  // Historical #001/#002 live under logs/live-generations/; new attempts use
  // logs/attempts/<generationId>/ so historical baselines are never modified.
  const basePath = path.join(process.cwd(), "logs", "attempts", generationId);

  // Acquire the stage execution manager (creates or resumes the attempt).
  let stageExecution: StageExecution;
  try {
    const fxInfo = await getUsdToInrRate();
    stageExecution = await createStageExecution({
      generationId,
      mode: executionMode,
      basePath,
      hashes,
      exchangeRate: fxInfo.rate > 0 ? fxInfo.rate : 1,
      maxTechnicalRetries: 2,
      call: async (stage, system, user, onUsage) => {
        try {
          // Provider-rate pacing — low-TPM tiers (e.g. free Groq) need calls
          // spread across minute windows. Unset = no pacing (OpenAI).
          const gapMs = Number(process.env.STAGE_CALL_GAP_MS || 0);
          if (gapMs > 0 && !abortController.signal.aborted) {
            await new Promise(r => setTimeout(r, gapMs));
          }
          const result = BACKGROUND_RESPONSES_ENABLED
            ? await callOpenAIForStageBackground(stage as StageName, system, user, {
                generationRunId,
                documentId: input.execution?.documentId || "",
                hashes,
                generationStartedAtMs: pipelineStart,
                isCancelRequested: async () =>
                  abortController.signal.aborted ||
                  (generationRunId ? await isCancelRequested(generationRunId) : false),
              })
            : await callOpenAIForStage(stage as StageName, system, user, abortController.signal);
          await onUsage(result.stageUsage);
          return result;
        } catch (e: any) {
          if (abortController.signal.aborted || e?.name === "AbortError" || e instanceof GenerationCancelledError) {
            throw new GenerationCancelledError(stage);
          }
          throw e;
        }
      },
    });
  } catch (error: any) {
    if (error instanceof StageExecutionError) {
      return errorResult(error.code, pipelineStart, renderCheckCount, generationId);
    }
    return errorResult(error?.message || "STAGE_EXECUTION_INIT_FAILED", pipelineStart, renderCheckCount, generationId);
  }

  const stageUsages: StageUsage[] = [];

  // ===== Generation lifecycle: stage progress + cancellation =====
  // When execution.generationRunId is set, stage boundaries are
  // persisted to generation_runs and cancellation is enforced before
  // AND after every stage — no new stage may start after a cancel
  // request. An AbortController also aborts the in-flight SDK call.
  const generationRunId = input.execution?.generationRunId || null;
  const abortController = new AbortController();
  let lifecycleInterval: ReturnType<typeof setInterval> | null = null;

  async function throwIfCancelled(stage?: string): Promise<void> {
    if (!generationRunId) return;
    if (abortController.signal.aborted) throw new GenerationCancelledError(stage);
    if (await isCancelRequested(generationRunId)) {
      abortController.abort();
      throw new GenerationCancelledError(stage);
    }
  }

  if (generationRunId) {
    lifecycleInterval = setInterval(async () => {
      try {
        await heartbeatRun(generationRunId);
        if (await isCancelRequested(generationRunId)) abortController.abort();
      } catch { /* heartbeat is best-effort */ }
    }, 8000);
    if (lifecycleInterval.unref) lifecycleInterval.unref();
  }

  async function execStage(
    stage: ExecutionStage,
    system: string,
    user: string,
    context?: { freezeComponentIds?: Set<string>; expectedClaimIds?: Map<string, string[]> }
  ): Promise<StageExecutionResult> {
    await throwIfCancelled(stage);
    if (generationRunId) {
      try { await markStageStarted(generationRunId, stage); } catch { /* progress is best-effort */ }
    }
    const result = await stageExecution.execute(stage, system, user, context);
    if (generationRunId) {
      try { await markStageCompleted(generationRunId); } catch { /* best-effort */ }
    }
    await throwIfCancelled(stage);
    return result;
  }

  const buildCost = async (duration: number): Promise<PipelineCost> => {
    const totalInputTokens = stageUsages.reduce((s, x) => s + x.inputTokens, 0);
    const totalCachedInputTokens = stageUsages.reduce((s, x) => s + x.cachedInputTokens, 0);
    const totalOutputTokens = stageUsages.reduce((s, x) => s + x.outputTokens, 0);
    const totalTokens = stageUsages.reduce((s, x) => s + x.totalTokens, 0);
    const estimatedApiCostUSD = stageUsages.reduce((s, x) => s + x.estimatedCostUsd, 0);
    const fxInfo = await getUsdToInrRate();
    return {
      totalInputTokens, totalCachedInputTokens, totalOutputTokens, totalTokens,
      totalDurationMs: duration,
      estimatedApiCostUSD,
      estimatedApiCostINR: fxInfo.rate > 0 ? estimatedApiCostUSD * fxInfo.rate : 0,
      exchangeRate: {
        pair: fxInfo.pair, rate: fxInfo.rate, source: fxInfo.source,
        retrievedAt: fxInfo.retrievedAt, stale: fxInfo.stale,
      },
      stages: stageUsages,
    };
  };

  try {
    const aiInput = buildAiInput(input.profile);
    // Phase 19: Use canonical ApplicationEvidenceBundle for all stages.
    // This ensures every stage (including Final Fact Reviewer) sees ALL evidence
    // categories — especially projectClarifications.
    const evidenceBundle = buildApplicationEvidenceBundle({
      profile: input.profile,
      programContextText: input.programContextText,
      facultyAlignment: input.facultyAlignment,
    });
    const studentFactsText = evidenceBundle.studentFactsText;
    const programFactsText = evidenceBundle.programFactsText;

    // Phase 24: Pre-Generation Mandatory Topic Evidence Gate
    // Check that every mandatory official topic has suitable approved evidence
    // BEFORE any OpenAI call. This prevents wasted paid calls like #007.
    const topicGateResult = checkMandatoryTopicEvidence(contract, evidenceBundle);
    if (!topicGateResult.passed) {
      // Policy: only NO usable student information at all is fatal.
      // Per-topic evidence gaps are warnings — the Writer still sees the
      // closed evidence world and Fact Reviewer guards final claims.
      if (evidenceBundle.ledger.studentFacts.length === 0) {
        return errorResult("MISSING_REQUIRED_STUDENT_INFORMATION", pipelineStart, renderCheckCount, generationId, { warnings: generationWarnings });
      }
      for (const issue of topicGateResult.blockingIssues) {
        generationWarnings.push({ code: "TOPIC_EVIDENCE_UNCERTAIN", message: issue.issue });
      }
    }

    // Phase COST-OPT: document-type narrative profile — default ON.
    // Emergency rollback: DISABLE_NARRATIVE_PROFILES=1
    const resolvedNarrative = process.env.DISABLE_NARRATIVE_PROFILES
      ? null
      : resolveNarrativeProfile(
          input.documentTypeConfig?.documentType || "CUSTOM",
          input.profile
        );
    const narrativeProfile = resolvedNarrative?.profile || null;
    // VISA_SOP with supported return-home evidence: mark it as required
    // content so Planner/Writer/QR/Finalizer all see and preserve it.
    // Status RECOMMENDED — never blocks the mandatory-topic gate.
    if (resolvedNarrative?.returnHomeRequired) {
      applyVisaReturnHomeRequirement(input.responseComponents);
      if (contract?.responseComponents) {
        applyVisaReturnHomeRequirement(contract.responseComponents);
      }
    }

    // STAGE 1: PLANNER
    const plannerPrompt = buildGenericPlannerPrompt(
      studentFactsText, input.responseComponents, input.facultyAlignment, programFactsText,
      input.documentTypeConfig ? `DOCUMENT TYPE: ${input.documentTypeConfig.displayName}\nWRITING PERSPECTIVE: ${input.documentTypeConfig.writingPerspective}\nDEFAULT STRUCTURE: ${input.documentTypeConfig.defaultStructure}\n${input.documentTypeConfig.promptFirst ? "ANSWER THE SUPPLIED PROMPT DIRECTLY — do NOT default to SOP structure." : ""}${narrativeProfile ? `\n${buildNarrativePlannerGuidance(narrativeProfile)}` : ""}` : undefined
    );
    const plannerResult = await execStage(
      "planner", plannerPrompt.system, plannerPrompt.user
    );
    const plan = plannerResult.output;
    stageUsages.push(plannerResult.stageUsage);

    // STAGE 2: WRITER (Phase 14: closed-world with evidence packets)
    // Phase 33: Use document-type-specific writing instructions if provided
    const writingInstructions = input.pipelineWritingInstructions
      ? `${input.pipelineWritingInstructions}\n\nDesired level: ${aiInput.writingPreferences.level || "Natural Professional"}. Tone: ${aiInput.writingPreferences.tone || "Professional & Personal"}.${narrativeProfile ? `\n\n${buildNarrativeWriterRules(narrativeProfile)}` : ""}`
      : `Desired level: ${aiInput.writingPreferences.level || "Natural Professional"}. Tone: ${aiInput.writingPreferences.tone || "Professional & Personal"}.${narrativeProfile ? `\n\n${buildNarrativeWriterRules(narrativeProfile)}` : ""}`;

    // Phase 14: Build per-component evidence packets
    // Planner contract emits studentEvidenceIds / programEvidenceIds /
    // facultyEvidenceIds — earlier code looked for primaryEvidenceIds /
    // secondaryEvidenceIds, which the prompt never defines, so the
    // planner's selection was always discarded.
    const ledgerIds = new Set(evidenceLedger.allEntries.map(e => e.id));
    const plannerSelection = (plan.componentPlans || plan.responses || []).map((p: any) => {
      const emitted = [
        ...(Array.isArray(p.studentEvidenceIds) ? p.studentEvidenceIds : []),
        ...(Array.isArray(p.programEvidenceIds) ? p.programEvidenceIds : []),
        ...(Array.isArray(p.facultyEvidenceIds) ? p.facultyEvidenceIds : []),
        // Legacy field names — tolerate older checkpoints/shapes.
        ...(Array.isArray(p.primaryEvidenceIds) ? p.primaryEvidenceIds : []),
        ...(Array.isArray(p.secondaryEvidenceIds) ? p.secondaryEvidenceIds : []),
      ].filter((id: any) => typeof id === "string");
      // Keep only IDs that actually exist in the ledger — hallucinated or
      // descriptive strings are dropped, and an empty result falls back to
      // the full-entry closed world (same as before).
      const primaryIds = Array.from(new Set(emitted.filter(id => ledgerIds.has(id))));
      const secondaryIds: string[] = [];
      const looksLikeIds = primaryIds.length > 0;
      return {
        componentId: p.componentId,
        primaryEvidenceIds: looksLikeIds ? primaryIds : [],
        secondaryEvidenceIds: looksLikeIds ? secondaryIds : [],
      };
    });
    const evidencePackets = buildComponentEvidencePackets({
      evidenceLedger,
      responseComponents: input.responseComponents,
      plannerEvidenceSelection: plannerSelection,
    });

    const writerPrompt = buildGenericWriterPrompt(
      plan, studentFactsText, input.responseComponents, input.facultyAlignment, writingInstructions, evidencePackets
    );
    const writerResult = await execStage(
      "writer", writerPrompt.system, writerPrompt.user
    );
    const writerOutput = writerResult.output;
    stageUsages.push(writerResult.stageUsage);

    // Phase 14: Deterministic Writer evidence validation (no AI call)
    const writerValidation = validateWriterEvidenceReferences({ packets: evidencePackets, writerOutput: writerOutput as any });
    if (!writerValidation.valid) {
      // Writer cited unknown/unauthorized evidence IDs — the draft text
      // still exists and downstream claim extraction + Fact Reviewer audit
      // the actual final claims. Surface as warning, keep the draft.
      generationWarnings.push({
        code: "WRITER_EVIDENCE_REFERENCE_VIOLATION",
        message: `Writer referenced evidence IDs outside the authorized packet: ${(writerValidation.violations || []).map((v: any) => v?.claim || v?.evidenceId || v?.message || JSON.stringify(v)).slice(0, 5).join("; ")}`,
      });
    }

    // Phase 16: Extract Writer claims with stable IDs
    const writerClaims: WriterClaim[] = [];
    for (const resp of (writerOutput.responses || writerOutput.componentPlans || [])) {
      for (const fc of (resp.factualClaims || [])) {
        writerClaims.push({
          claimId: fc.claimId || `CLAIM-${resp.componentId}-${String(writerClaims.length + 1).padStart(3, "0")}`,
          componentId: resp.componentId,
          text: fc.claim || fc.text || "",
          evidenceIds: fc.evidenceIds || [],
        });
      }
    }

    // Phase 16: Build required topic provenance from the contract
    const requiredTopicProvenance: Array<{ componentId: string; topics: RequiredTopicProvenance[] }> =
      input.responseComponents.map(rc => ({
        componentId: rc.componentId,
        topics: rc.requiredTopics.map((t: any) => {
          const mandatory = isHardMandatoryTopicStatus(t.status);
          return {
            topicId: t.topic,
            text: t.topic,
            requirementType: mandatory ? "MANDATORY_REQUIRED_TOPIC" as const : "OPTIONAL_QUALITY_SUGGESTION" as const,
            sourceRequirementId: rc.sourceId || "CONTRACT",
            sourceUrl: undefined,
            mandatory,
          };
        }),
      }));

    // STAGE 3: QUALITY REVIEWER (receives the Evidence Ledger + evidence packets)
    const qualityPrompt = buildGenericQualityReviewerPrompt(
      writerOutput, input.responseComponents, input.facultyAlignment, evidenceLedger, evidencePackets, input.qualityRubricInstructions,
      input.pipelineWritingInstructions
    );
    const qualityResult = await execStage(
      "qualityReviewer", qualityPrompt.system, qualityPrompt.user
    );
    const qualityReview = qualityResult.output as QualityReviewOutput;
    // Phase 38A: Validate Quality Reviewer output against typed contract
    const qualityValidation = validateQualityReviewOutput(qualityReview);
    if (!qualityValidation.valid) {
      // QR output is malformed — review uncertainty is not fatal. The
      // action planner handles missing coverage as FREEZE + warnings and
      // Fact Reviewer still audits the final text.
      generationWarnings.push({
        code: "QUALITY_REVIEWER_OUTPUT_INVALID",
        message: `Quality Reviewer output failed structural validation: ${(qualityValidation.errors || []).slice(0, 3).join("; ")}`,
      });
    }
    stageUsages.push(qualityResult.stageUsage);

    // Deterministic length compliance — the server computes word counts;
    // the model cannot contradict arithmetic. wordCompliance /
    // requirementCompliance.wordLimit are normalized to the real status.
    {
      const complianceFor = (status: LengthStatus): "PASS" | "FAIL" | "N/A" =>
        status === "NO_LIMIT" ? "N/A" : status === "WITHIN_RANGE" ? "PASS" : "FAIL";
      const writerWordMap = new Map<string, number>(
        (writerOutput.responses || []).map((r: any) => [r.componentId as string, wordsOf(r.text)])
      );
      for (const cs of qualityReview.componentScores || []) {
        const rc = input.responseComponents.find(c => c.componentId === cs.componentId);
        const ctx = resolveLengthContext(rc?.wordLimit);
        const words = writerWordMap.get(cs.componentId) ?? 0;
        const status = lengthStatusFor(words, ctx);
        cs.wordCompliance = complianceFor(status);
        if (qualityReview.requirementCompliance) {
          qualityReview.requirementCompliance.wordLimit = complianceFor(status);
        }
      }
    }

    // STAGE 4: LANGUAGE CALIBRATOR
    const languageProfile: LanguageProfile = {
      level: aiInput.writingPreferences.level || "Natural Professional",
      tone: aiInput.writingPreferences.tone || "Professional & Personal",
      personalization: aiInput.writingPreferences.personalization || "Balanced",
      technicalDetail: aiInput.writingPreferences.technicalDetail || "Medium",
      openingStyle: aiInput.writingPreferences.openingStyle || "Let AI Choose Best Opening",
      sopLength: aiInput.writingPreferences.sopLength || "900-1100",
      actualEnglishProficiency: {
        testType: aiInput.englishProficiency.testType,
        overallScore: aiInput.englishProficiency.overallScore,
        writingScore: aiInput.englishProficiency.writing,
      },
    } as LanguageProfile;
    const calibratePrompt = buildGenericLanguageCalibratorPrompt(writerOutput, languageProfile, input.responseComponents);
    const calibrateResult = await execStage(
      "languageCalibrator", calibratePrompt.system, calibratePrompt.user
    );
    const calibrated = calibrateResult.output;
    stageUsages.push(calibrateResult.stageUsage);

    // Phase 16: Build calibrated claims and validate Language Calibrator claim preservation
    let calibratedClaims = buildCalibratedClaims(calibrated, writerClaims);

    const languageCalibratorClaimValidation = validateLanguageCalibratorClaims({
      writerClaims,
      calibratedClaims,
    });
    // Policy: if the Calibrator introduced claims not present in the
    // Writer output, keep the safe pre-calibration draft instead of
    // failing the run.
    const calibratedSource = languageCalibratorClaimValidation.valid ? calibrated : writerOutput;
    if (!languageCalibratorClaimValidation.valid) {
      calibratedClaims = writerClaims.map(c => ({ claimId: c.claimId, componentId: c.componentId, rewrittenText: c.text, evidenceIds: c.evidenceIds }));
      generationWarnings.push({
        code: "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM",
        message: "Language Calibrator introduced claims not present in the Writer draft; using Writer text as the safe draft.",
      });
    }

    // ===== DETERMINISTIC PRE-FINAL RENDER (NO OpenAI call) =====
    const calibratedResponses: Array<{ componentId: string; label: string; text: string }> =
      (calibratedSource.responses || calibratedSource.componentPlans || []).map((r: any) => ({
        componentId: r.componentId,
        label: r.title || r.componentId,
        text: r.text || "",
      }));

    let preFinalFeedback: RenderFeedback | null = null;
    const hasPageConstraint = input.responseComponents.some(rc => rc.pageLimit.maxPages != null);

    if (hasPageConstraint && calibratedResponses.length > 0) {
      try {
        preFinalFeedback = await runPreFinalRender(
          calibratedResponses, input.responseComponents, renderProfile
        );
        renderCheckCount++;
      } catch (e) {
        preFinalFeedback = null;
      }
    }

    // ===== DETERMINISTIC COMPONENT ACTION PLANNING (NO OpenAI call) =====
    const actionPlan = planComponentActions({
      responseComponents: input.responseComponents,
      renderFeedback: preFinalFeedback,
      qualityReview,
      evidenceLedger,
      calibratedResponses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })),
    });

    // Technical integrity blocks stay fatal (a missing/empty calibrated
    // text means there is no draft to finalize). Semantic issues — topic
    // coverage uncertainty, missing-topic evidence, render validation
    // gaps — degrade to warnings; FREEZE preserves the calibrated text.
    if (actionPlan.blocked) {
      const issues = actionPlan.blockingIssues || [];
      const hardIssues = issues.filter(i => i.code === "FINALIZER_SCOPE_VIOLATION");
      const softIssues = issues.filter(i => i.code !== "FINALIZER_SCOPE_VIOLATION");
      for (const i of softIssues) {
        generationWarnings.push({ code: i.code, message: i.message });
      }
      if (hardIssues.length > 0) {
        await stageExecution.finish(false);
        const reason = hardIssues[0].code;
        return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
          planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
          actionPlan, evidenceLedger, accounting: stageExecution.accounting(), warnings: generationWarnings,
        });
      }
    }

    // Phase 16: Missing mandatory topics with no adequate evidence — the
    // Writer already worked in a closed evidence world, so an uncovered
    // topic means it could not be truthfully addressed. Warn, never fail.
    const missingMandatoryCheck = checkMissingMandatoryTopics({
      actionPlan,
      requiredTopics: requiredTopicProvenance,
    });
    if (missingMandatoryCheck.blocked) {
      for (const b of missingMandatoryCheck.blockingReasons) {
        generationWarnings.push({ code: "TOPIC_EVIDENCE_MISSING", message: b.reason });
      }
    }

    // STAGE 5: BOUNDED FINALIZER (receives action plan + render feedback)
    // buildBoundedFinalizerPrompt throws BoundedFinalizerBlockedError if the
    // action plan is internally inconsistent.
    // Phase 34C: Pass calibratedClaims for expectedClaimIds and add retry loop
    // for FINALIZER_METADATA_INCOMPLETE with corrective feedback.
    // STAGE 5: BOUNDED FINALIZER (best-effort)
    // The calibrated text is already a complete, evidence-checked draft.
    // Any finalizer-path failure — plan inconsistency, metadata retries
    // exhausted, guard violation, provenance violation — preserves the
    // calibrated text and records a warning instead of failing the run.
    // Provider/transport failures still propagate as technical FAILED.
    let finalized: any = { responses: calibratedResponses.map(r => ({ componentId: r.componentId, title: r.label, text: r.text })) };
    let rawResponses: any[] = finalized.responses;
    let finalizerGuard: FinalizerGuardResult | undefined;
    let claimProvenanceValidation: ClaimProvenanceResult | undefined;
    let finalizerRan = false;
    const fallBackToCalibrated = (code: string, message: string) => {
      generationWarnings.push({ code, message });
      finalized = { responses: calibratedResponses.map(r => ({ componentId: r.componentId, title: r.label, text: r.text })) };
      rawResponses = finalized.responses;
    };

    let finalizerPrompt;
    try {
      finalizerPrompt = buildBoundedFinalizerPrompt({
        calibratedOutput: { responses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })) },
        responseComponents: input.responseComponents,
        actionPlan,
        evidenceLedger,
        renderFeedback: preFinalFeedback,
        calibratedClaims: calibratedClaims.map(c => ({ claimId: c.claimId, componentId: c.componentId })),
        complianceConstraints: input.pipelineWritingInstructions,
      });
    } catch (error) {
      fallBackToCalibrated(
        "BOUNDED_FINALIZER_BLOCKED",
        `Finalizer could not plan a safe repair (${error instanceof BoundedFinalizerBlockedError ? "action plan inconsistent" : (error as Error)?.message}); keeping the calibrated draft.`,
      );
    }

    if (finalizerPrompt) {
      // Phase 33B: Pass FREEZE component IDs to parseStage so it can distinguish
      // FREEZE (empty metadata allowed, deterministic inference) from COMPRESS
      // (empty metadata = technical retry for FINALIZER_METADATA_INCOMPLETE).
      const freezeComponentIds = new Set(
        actionPlan.plans.filter(p => p.action === "FREEZE").map(p => p.componentId)
      );

      // Phase 34C: Build expectedClaimIds map for parseStage zero-claim edge case
      const expectedClaimIdsMap = new Map<string, string[]>();
      for (const claim of calibratedClaims) {
        if (!expectedClaimIdsMap.has(claim.componentId)) {
          expectedClaimIdsMap.set(claim.componentId, []);
        }
        expectedClaimIdsMap.get(claim.componentId)!.push(claim.claimId);
      }

      // Phase 34C: Retry loop for FINALIZER_METADATA_INCOMPLETE.
      // Provider/transport errors propagate to the outer catch (technical
      // FAILED); exhausted metadata retries fall back to calibrated text.
      let finalizerResult;
      let finalizerRetryCount = 0;
      const maxFinalizerRetries = 2;
      while (true) {
        try {
          finalizerResult = await execStage(
            "finalizer", finalizerPrompt.system, finalizerPrompt.user,
            { freezeComponentIds, expectedClaimIds: expectedClaimIdsMap }
          );
          break;
        } catch (error: any) {
          const isMetadataIncomplete = error?.code === "FINALIZER_METADATA_INCOMPLETE";
          if (!isMetadataIncomplete) throw error;
          if (finalizerRetryCount >= maxFinalizerRetries) {
            fallBackToCalibrated("FINALIZER_METADATA_INCOMPLETE", "Finalizer did not return claim provenance metadata after retries; keeping the calibrated draft.");
            break;
          }
          finalizerRetryCount++;
          const failedComponents = actionPlan.plans
            .filter(p => p.action !== "FREEZE")
            .map(p => ({
              componentId: p.componentId,
              expectedClaimIds: expectedClaimIdsMap.get(p.componentId) ?? [],
            }))
            .filter(fc => fc.expectedClaimIds.length > 0);
          try {
            finalizerPrompt = buildBoundedFinalizerPrompt({
              calibratedOutput: { responses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })) },
              responseComponents: input.responseComponents,
              actionPlan,
              evidenceLedger,
              renderFeedback: preFinalFeedback,
              calibratedClaims: calibratedClaims.map(c => ({ claimId: c.claimId, componentId: c.componentId })),
              retryCorrection: { failedComponents },
              complianceConstraints: input.pipelineWritingInstructions,
            });
          } catch {
            fallBackToCalibrated("BOUNDED_FINALIZER_BLOCKED", "Finalizer retry plan inconsistent; keeping the calibrated draft.");
            finalizerResult = undefined;
            break;
          }
        }
      }
      if (finalizerResult) {
        finalized = finalizerResult.output;
        stageUsages.push(finalizerResult.stageUsage);
        rawResponses = finalized.responses || finalized.componentPlans || [];
        finalizerRan = true;
      }
    }

    // The stage cursor must advance even when the Finalizer is skipped —
    // otherwise stage 6 hits STAGE_ORDER_VIOLATION. Record a deterministic
    // no-provider FREEZE-equivalent checkpoint preserving calibrated text.
    if (!finalizerRan) {
      const skipOutput = {
        responses: calibratedResponses.map(r => ({
          componentId: r.componentId,
          title: r.label,
          text: r.text,
          retainedClaimIds: [] as string[],
          removedClaimIds: [] as string[],
          repairClaims: [] as any[],
        })),
      };
      await stageExecution.skip("finalizer", skipOutput, {
        freezeComponentIds: new Set(input.responseComponents.map(rc => rc.componentId)),
      });
    }

    // Normalise responses (finalizer output, or calibrated fallback)
    const responses: ApplicationResponseItem[] = rawResponses.map((r: any) => ({
      componentId: r.componentId,
      title: r.title || r.componentId,
      text: r.text || "",
    }));

    // A run that produced no usable text at all is a technical failure —
    // there is no draft to warn about.
    if (!responses.some(r => typeof r.text === "string" && r.text.trim().length > 0)) {
      await stageExecution.finish(false);
      return errorResult("EMPTY_FINAL_DOCUMENT", pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        finalizedOutput: finalized, actionPlan, evidenceLedger,
        accounting: stageExecution.accounting(), warnings: generationWarnings,
      });
    }

    // ===== DETERMINISTIC FINAL RENDER (NO OpenAI call) =====
    let finalFeedback: RenderFeedback | null = null;
    let renderLifecycle: RenderLifecycleResult | null = null;

    if (hasPageConstraint && responses.length > 0) {
      try {
        const finalRenderResult = await runFinalRender(
          responses.map(r => ({ componentId: r.componentId, label: r.title, text: r.text })),
          input.responseComponents, renderProfile, preFinalFeedback
        );
        finalFeedback = finalRenderResult.feedback;
        renderLifecycle = finalRenderResult.lifecycle;
        renderCheckCount++;
      } catch (e) {
        finalFeedback = null;
        renderLifecycle = null;
        generationWarnings.push({ code: "PAGE_LIMIT_WARNING", message: "Final physical page validation could not run; page-limit compliance is unverified." });
      }
    }

    // ===== DETERMINISTIC FINALIZER GUARD + CLAIM PROVENANCE (only when the
    // Finalizer actually produced output) =====
    // Guard/provenance failures are content failures — the calibrated draft
    // remains the safe text, so they become warnings with a text fallback.
    if (finalizerRan) {
      finalizerGuard = validateFinalizerOutput({
        actionPlan,
        calibratedResponses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })),
        finalResponses: responses.map(r => ({ componentId: r.componentId, text: r.text, repairReferences: (rawResponses.find((rr: any) => rr.componentId === r.componentId)?.repairReferences) })),
        finalRenderFeedback: finalFeedback,
        evidenceLedger,
        responseComponents: input.responseComponents,
      });

      if (!finalizerGuard.passed) {
        fallBackToCalibrated("FINALIZER_GUARD_FAILED", `Finalizer output failed the deterministic guard (${finalizerGuard.violations[0] || "unknown"}); keeping the calibrated draft.`);
        responses.length = 0;
        responses.push(...rawResponses.map((r: any) => ({ componentId: r.componentId, title: r.title || r.componentId, text: r.text || "" })));
      } else {
        try {
          const finalizerClaimOutputs: FinalizerClaimOutput[] = rawResponses.map((r: any) => {
            const hasRetained = "retainedClaimIds" in r;
            const hasRemoved = "removedClaimIds" in r;
            const hasRepair = "repairClaims" in r;
            const componentPlan = actionPlan.plans.find(p => p.componentId === r.componentId);
            const isFreeze = componentPlan?.action === "FREEZE";
            if (!isFreeze && (!hasRetained || !hasRemoved || !hasRepair)) {
              const missing: string[] = [];
              if (!hasRetained) missing.push("retainedClaimIds");
              if (!hasRemoved) missing.push("removedClaimIds");
              if (!hasRepair) missing.push("repairClaims");
              throw new Error(`FINALIZER_GUARD_INCOMPLETE: Missing required claim metadata fields [${missing.join(", ")}] for component ${r.componentId}`);
            }
            return {
              componentId: r.componentId,
              text: r.text || "",
              retainedClaimIds: hasRetained ? (Array.isArray(r.retainedClaimIds) ? r.retainedClaimIds : []) : [],
              removedClaimIds: hasRemoved ? (Array.isArray(r.removedClaimIds) ? r.removedClaimIds : []) : [],
              repairClaims: hasRepair ? (Array.isArray(r.repairClaims) ? r.repairClaims : []) : [],
            };
          });

          claimProvenanceValidation = validateFinalizerClaims({
            preFinalClaims: calibratedClaims,
            finalizerOutputs: finalizerClaimOutputs,
            actionPlan,
            requiredTopics: requiredTopicProvenance,
          });

          if (!claimProvenanceValidation.valid) {
            fallBackToCalibrated("CLAIM_PROVENANCE_VIOLATION", `Finalizer claim provenance invalid (${claimProvenanceValidation.violations[0]?.code || "unknown"}); keeping the calibrated draft.`);
            responses.length = 0;
            responses.push(...rawResponses.map((r: any) => ({ componentId: r.componentId, title: r.title || r.componentId, text: r.text || "" })));
          }
        } catch (e: any) {
          fallBackToCalibrated("FINALIZER_GUARD_INCOMPLETE", `${e?.message || "Finalizer claim metadata incomplete"}; keeping the calibrated draft.`);
          responses.length = 0;
          responses.push(...rawResponses.map((r: any) => ({ componentId: r.componentId, title: r.title || r.componentId, text: r.text || "" })));
        }
      }
    }

    // If a guard/provenance fallback swapped the final text after the
    // render above, re-render the text that will actually be persisted.
    if (hasPageConstraint && finalizerRan && generationWarnings.some(w =>
      w.code === "FINALIZER_GUARD_FAILED" || w.code === "CLAIM_PROVENANCE_VIOLATION" || w.code === "FINALIZER_GUARD_INCOMPLETE")) {
      try {
        const reRender = await runFinalRender(
          responses.map(r => ({ componentId: r.componentId, label: r.title, text: r.text })),
          input.responseComponents, renderProfile, preFinalFeedback
        );
        finalFeedback = reRender.feedback;
        renderLifecycle = reRender.lifecycle;
      } catch { /* keep previous feedback */ }
    }

    // STAGE 6: FINAL FACT REVIEWER — audits the ACTUAL final text
    // Phase 19: Final Fact Reviewer receives canonical bundle text
    // (includes projectClarifications and all evidence categories)
    const factPrompt = buildGenericFinalFactReviewerPrompt(
      responses.map(r => ({ componentId: r.componentId, text: r.text })),
      studentFactsText, programFactsText, input.facultyAlignment, input.responseComponents,
      input.documentTypeConfig ? `DOCUMENT TYPE: ${input.documentTypeConfig.displayName}\nWRITING PERSPECTIVE: ${input.documentTypeConfig.writingPerspective}\n${input.documentTypeConfig.recommenderPerspectiveRequired ? "RECOMMENDER SAFETY: Claims about recommender observations, relationship duration, courses taught, or performance rankings must be supported by approved evidence." : ""}${input.documentTypeConfig.visaSpecificEvidence ? "VISA SAFETY: Claims about financial assets, family obligations, property, or immigration intent must be supported by approved evidence." : ""}` : undefined
    );
    const factResult = await execStage(
      "factReviewer", factPrompt.system, factPrompt.user
    );
    const factReview = factResult.output as FactReviewOutput;
    // Phase 38A: Validate Final Fact Reviewer output against typed contract
    const factValidation = validateFactReviewOutput(factReview);
    if (!factValidation.valid) {
      await stageExecution.finish(false);
      const reason = "FACT_REVIEWER_OUTPUT_INVALID";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        finalizedOutput: finalized, evidenceLedger, accounting: stageExecution.accounting(),
      });
    }
    stageUsages.push(factResult.stageUsage);

    // ===== DETERMINISTIC POST-FINAL CHECKS (no AI) =====
    const postChecks = runPostFinalChecks(
      responses,
      input.responseComponents.length,
      Object.fromEntries(input.responseComponents.map(rc => [rc.componentId, rc.wordLimit || {}]))
    );

    // ===== COMPUTE FINAL COMPLIANCE =====
    // Phase 38A: Derive totals from components[].claims[] — do NOT trust model-reported totals
    const derivedTotals = deriveFactReviewTotals(factReview);
    // Overwrite model-reported totals with derived values
    factReview.totalInventedFacts = derivedTotals.totalInventedFacts;
    factReview.totalAlteredFacts = derivedTotals.totalAlteredFacts;
    factReview.totalInterpretiveElaborations = derivedTotals.totalInterpretiveElaborations;
    factReview.totalAmbiguousClaims = derivedTotals.totalAmbiguousClaims;
    factReview.overallPass = derivedTotals.overallPass;

    const totalInvented = derivedTotals.totalInventedFacts;
    const totalAltered = derivedTotals.totalAlteredFacts;
    const totalElaborations = derivedTotals.totalInterpretiveElaborations;
    // Phase 38A: Deterministic overallPass — derived from claims, not model-reported
    const factPass = derivedTotals.overallPass;

    const { status: submissionStatus, physicalPageBlocker } = computeSubmissionStatus({
      factReviewPass: factPass,
      inventedFacts: totalInvented,
      alteredFacts: totalAltered,
      hasPageConstraint,
      deterministicChecksPass: postChecks.pass,
      renderValidation: renderLifecycle ? {
        pdfGenerated: true,
        pageValidation: null,
        renderEngineError: false,
        renderLifecycle,
      } : null,
    });

    const hasWordLimit = input.responseComponents.some(rc => rc.wordLimit?.max != null);
    const hasCharLimit = input.responseComponents.some(rc => rc.characterLimit?.max != null);

    let pageLimitStatus: "PASS" | "FAIL" | "RENDER_VALIDATION_REQUIRED" = "N/A" as any;
    if (hasPageConstraint) {
      if (renderLifecycle) {
        pageLimitStatus = renderLifecycle.hasOverflowFinal ? "FAIL" : "PASS";
      } else {
        pageLimitStatus = "RENDER_VALIDATION_REQUIRED";
      }
    }

    const compliance: FinalCompliance = {
      documentStructure: postChecks.pass ? "PASS" : "FAIL",
      officialPromptCoverage: (qualityReview?.requirementCompliance?.componentPromptCoverage === "FAIL" ? "FAIL" : "PASS"),
      requiredTopicCoverage: (qualityReview?.requirementCompliance?.requiredTopics === "FAIL" ? "FAIL" : "PASS"),
      factSafety: {
        status: factPass ? "PASS" : "FAIL",
        inventedFacts: totalInvented,
        alteredFacts: totalAltered,
        interpretiveElaborations: totalElaborations,
      },
      wordLimit: hasWordLimit ? "PENDING" : "N/A" as any,
      characterLimit: hasCharLimit ? "PENDING" : "N/A" as any,
      pageLimit: pageLimitStatus,
      renderValidation: renderLifecycle ? {
        pdfGenerated: true,
        pageValidation: null,
        renderEngineError: false,
        renderLifecycle,
      } : null,
      submissionStatus,
      physicalPageBlocker,
    };

    // Advisory compliance → warnings (never fatal — consultant reviews)
    if (!postChecks.pass) {
      generationWarnings.push({ code: "POST_FINAL_CHECK_WARNING", message: "Deterministic post-final checks reported issues; review the draft." });
    }
    if (compliance.requiredTopicCoverage === "FAIL") {
      generationWarnings.push({ code: "TOPIC_COVERAGE_INCOMPLETE", message: "One or more required/requested topics were not fully covered." });
    }
    if (pageLimitStatus === "FAIL") {
      generationWarnings.push({ code: "PAGE_LIMIT_WARNING", message: "Final render exceeds the physical page limit." });
    } else if (pageLimitStatus === "RENDER_VALIDATION_REQUIRED") {
      generationWarnings.push({ code: "PAGE_LIMIT_WARNING", message: "Page-limit compliance could not be verified." });
    }
    if (!factPass) {
      generationWarnings.push({ code: "FACT_REVIEW_WARNING", message: `Fact review flagged issues — invented: ${totalInvented}, altered: ${totalAltered}, elaborations: ${totalElaborations}.` });
    }

    const docLabel = input.documentTypeLabel || "APPLICATION DOCUMENT";
    // Phase 34D: Remove internal component IDs from student-facing output.
    // Component IDs (e.g., "RC-DOC") are internal pipeline metadata and must
    // never appear in final prose, DocumentVersion content, or exports.
    // For single-component documents (the D-Vivid case), use text directly.
    // For multi-component documents, use the human-readable title only if the
    // model actually returned one (not a fallback to the componentId).
    const finalText = responses
      .map(r => {
        // Only include title if it's a real title, not a fallback to componentId
        const hasRealTitle = r.title && r.title !== r.componentId;
        if (hasRealTitle) {
          return `${r.title.toUpperCase()}\n\n${r.text}`;
        }
        return r.text;
      })
      .join("\n\n");
    const fullText = `${docLabel.toUpperCase()}\n\n${finalText}`;

    const totalWordCount = responses.reduce((s, r) => s + countWords(r.text), 0);
    const duration = Date.now() - pipelineStart;
    const cost = await buildCost(duration);

    // Mark the attempt successful and release the execution lock.
    await stageExecution.finish(true);
    const accounting = stageExecution.accounting();
    await stageExecution.close();

    return {
      status: "success",
      generationId,
      warnings: generationWarnings,
      planner: plan,
      writerOutput,
      qualityReview,
      factReview,
      calibratedOutput: calibrated,
      finalizedOutput: finalized,
      actionPlan,
      finalizerGuard,
      evidenceLedger,
      evidencePackets,
      writerEvidenceValidation: writerValidation,
      writerClaims,
      calibratedClaims,
      languageCalibratorClaimValidation,
      claimProvenanceValidation,
      requiredTopicProvenance,
      accounting,
      compliance,
      responses,
      finalText: fullText,
      renderLifecycle,
      preFinalRenderFeedback: preFinalFeedback,
      finalRenderFeedback: finalFeedback,
      metrics: {
        wordCount: totalWordCount,
        model: getAllModelsUsed().join(", "),
        stages: stageUsages.length,
        duration,
        cost,
        renderChecks: renderCheckCount,
      },
    };
  } catch (error: any) {
    const duration = Date.now() - pipelineStart;
    const cost = stageUsages.length > 0 ? await buildCost(duration) : null;
    try { await stageExecution.finish(false); } catch {}
    try { await stageExecution.close(); } catch {}
    const accounting = (() => { try { return stageExecution.accounting(); } catch { return undefined; } })();

    // Cancellation is a first-class outcome, not an error.
    if (error instanceof GenerationCancelledError || abortController.signal.aborted) {
      return {
        status: "cancelled",
        error: "GENERATION_CANCELLED",
        generationId,
        warnings: generationWarnings,
        planner: null, writerOutput: null, qualityReview: null, factReview: null,
        calibratedOutput: null, finalizedOutput: null,
        compliance: null, responses: [], finalText: "",
        renderLifecycle: null, preFinalRenderFeedback: null, finalRenderFeedback: null,
        accounting,
        metrics: { wordCount: 0, model: "", stages: stageUsages.length, duration, cost, renderChecks: renderCheckCount },
      };
    }

    return {
      status: "error",
      error: error?.message || "PIPELINE_ERROR",
      generationId,
      warnings: generationWarnings,
      planner: null, writerOutput: null, qualityReview: null, factReview: null,
      calibratedOutput: null, finalizedOutput: null,
      compliance: null, responses: [], finalText: "",
      renderLifecycle: null, preFinalRenderFeedback: null, finalRenderFeedback: null,
      accounting,
      metrics: { wordCount: 0, model: "", stages: stageUsages.length, duration, cost, renderChecks: renderCheckCount },
    };
  } finally {
    if (lifecycleInterval) clearInterval(lifecycleInterval);
  }
}

function errorResult(
  reason: string,
  pipelineStart: number,
  renderCheckCount: number,
  generationId?: string,
  partial?: Partial<ApplicationPipelineResult>
): ApplicationPipelineResult {
  const duration = Date.now() - pipelineStart;
  return {
    status: "error",
    error: reason,
    generationId,
    warnings: partial?.warnings ?? [],
    planner: partial?.planner ?? null,
    writerOutput: partial?.writerOutput ?? null,
    qualityReview: partial?.qualityReview ?? null,
    factReview: partial?.factReview ?? null,
    calibratedOutput: partial?.calibratedOutput ?? null,
    finalizedOutput: partial?.finalizedOutput ?? null,
    actionPlan: partial?.actionPlan,
    finalizerGuard: partial?.finalizerGuard,
    evidenceLedger: partial?.evidenceLedger,
    accounting: partial?.accounting,
    compliance: null,
    responses: [],
    finalText: "",
    renderLifecycle: null,
    preFinalRenderFeedback: null,
    finalRenderFeedback: null,
    metrics: { wordCount: 0, model: "", stages: 0, duration, cost: null, renderChecks: renderCheckCount },
  };
}
