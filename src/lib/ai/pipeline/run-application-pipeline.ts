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
import { checkMandatoryTopicEvidence } from "@/lib/requirements/generation-gate";
import { runPreFinalRender } from "@/lib/render/pre-final-render";
import { runFinalRender } from "@/lib/render/final-render";
import { RenderFeedback, RenderLifecycleResult } from "@/lib/render/render-lifecycle-types";
import { computeHash, CheckpointHashes } from "../pipeline-checkpoint";
import { resolveNarrativeProfile, buildNarrativePlannerGuidance, buildNarrativeWriterRules, applyVisaReturnHomeRequirement } from "../../application/narrative-profile";
import {
  createStageExecution,
  EXECUTION_STAGES,
  ExecutionStage,
  ExecutionMode,
  StageExecution,
  StageExecutionError,
} from "./stage-execution";
import { AttemptAccounting } from "../attempt-accounting";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";

export interface ApplicationPipelineExecution {
  generationId: string;
  mode: ExecutionMode;
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

export interface ApplicationPipelineResult {
  status: "success" | "error";
  error?: string;
  generationId?: string;
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

async function callOpenAIForStage(
  stage: StageName,
  systemPrompt: string,
  userPrompt: string
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
  });

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
        const result = await callOpenAIForStage(stage as StageName, system, user);
        await onUsage(result.stageUsage);
        return result;
      },
    });
  } catch (error: any) {
    if (error instanceof StageExecutionError) {
      return errorResult(error.code, pipelineStart, renderCheckCount, generationId);
    }
    return errorResult(error?.message || "STAGE_EXECUTION_INIT_FAILED", pipelineStart, renderCheckCount, generationId);
  }

  const stageUsages: StageUsage[] = [];

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
      return errorResult("MISSING_REQUIRED_STUDENT_INFORMATION", pipelineStart, renderCheckCount, generationId);
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
    const plannerResult = await stageExecution.execute(
      "planner", plannerPrompt.system, plannerPrompt.user
    );
    const plan = JSON.parse(plannerResult.content);
    stageUsages.push(plannerResult.stageUsage);

    // STAGE 2: WRITER (Phase 14: closed-world with evidence packets)
    // Phase 33: Use document-type-specific writing instructions if provided
    const writingInstructions = input.pipelineWritingInstructions
      ? `${input.pipelineWritingInstructions}\n\nDesired level: ${aiInput.writingPreferences.level || "Natural Professional"}. Tone: ${aiInput.writingPreferences.tone || "Professional & Personal"}.${narrativeProfile ? `\n\n${buildNarrativeWriterRules(narrativeProfile)}` : ""}`
      : `Desired level: ${aiInput.writingPreferences.level || "Natural Professional"}. Tone: ${aiInput.writingPreferences.tone || "Professional & Personal"}.${narrativeProfile ? `\n\n${buildNarrativeWriterRules(narrativeProfile)}` : ""}`;

    // Phase 14: Build per-component evidence packets
    // The Planner may return primaryEvidenceIds (proper IDs) or factsToUse (descriptive text).
    // Only use primaryEvidenceIds if they look like actual ledger IDs; otherwise fall back to all entries.
    const plannerSelection = (plan.componentPlans || plan.responses || []).map((p: any) => {
      const primaryIds: string[] = Array.isArray(p.primaryEvidenceIds) ? p.primaryEvidenceIds : [];
      const secondaryIds: string[] = Array.isArray(p.secondaryEvidenceIds) ? p.secondaryEvidenceIds : [];
      // Only use them if they look like ledger IDs (contain a dash and aren't full sentences)
      const looksLikeIds = primaryIds.every((id: string) => typeof id === "string" && id.length < 50 && id.includes("-"));
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
    const writerResult = await stageExecution.execute(
      "writer", writerPrompt.system, writerPrompt.user
    );
    const writerOutput = JSON.parse(writerResult.content);
    stageUsages.push(writerResult.stageUsage);

    // Phase 14: Deterministic Writer evidence validation (no AI call)
    const writerValidation = validateWriterEvidenceReferences({ packets: evidencePackets, writerOutput });
    if (!writerValidation.valid) {
      await stageExecution.finish(false);
      const reason = "WRITER_EVIDENCE_REFERENCE_VIOLATION";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview: null, calibratedOutput: null,
        evidenceLedger, accounting: stageExecution.accounting(),
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
        topics: rc.requiredTopics.map((t: any) => ({
          topicId: t.topic,
          text: t.topic,
          requirementType: "MANDATORY_REQUIRED_TOPIC" as const,
          sourceRequirementId: rc.sourceId || "CONTRACT",
          sourceUrl: undefined,
          mandatory: true,
        })),
      }));

    // STAGE 3: QUALITY REVIEWER (receives the Evidence Ledger + evidence packets)
    const qualityPrompt = buildGenericQualityReviewerPrompt(
      writerOutput, input.responseComponents, input.facultyAlignment, evidenceLedger, evidencePackets, input.qualityRubricInstructions
    );
    const qualityResult = await stageExecution.execute(
      "qualityReviewer", qualityPrompt.system, qualityPrompt.user
    );
    const qualityReview: QualityReviewOutput = JSON.parse(qualityResult.content);
    // Phase 38A: Validate Quality Reviewer output against typed contract
    const qualityValidation = validateQualityReviewOutput(qualityReview);
    if (!qualityValidation.valid) {
      await stageExecution.finish(false);
      const reason = "QUALITY_REVIEWER_OUTPUT_INVALID";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: null,
        evidenceLedger, accounting: stageExecution.accounting(),
      });
    }
    stageUsages.push(qualityResult.stageUsage);

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
    const calibratePrompt = buildGenericLanguageCalibratorPrompt(writerOutput, languageProfile);
    const calibrateResult = await stageExecution.execute(
      "languageCalibrator", calibratePrompt.system, calibratePrompt.user
    );
    const calibrated = JSON.parse(calibrateResult.content);
    stageUsages.push(calibrateResult.stageUsage);

    // Phase 16: Build calibrated claims and validate Language Calibrator claim preservation
    const calibratedClaims: CalibratedClaim[] = [];
    const calResponses = calibrated.responses || calibrated.componentPlans || [];
    for (const resp of calResponses) {
      const claimMap = resp.claimMap || [];
      for (const cm of claimMap) {
        if (cm.rewrittenText !== null && cm.rewrittenText !== undefined) {
          const wClaim = writerClaims.find(wc => wc.claimId === cm.claimId);
          calibratedClaims.push({
            claimId: cm.claimId,
            componentId: resp.componentId,
            rewrittenText: cm.rewrittenText,
            evidenceIds: wClaim?.evidenceIds || [],
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

    const languageCalibratorClaimValidation = validateLanguageCalibratorClaims({
      writerClaims,
      calibratedClaims,
    });
    if (!languageCalibratorClaimValidation.valid) {
      await stageExecution.finish(false);
      const reason = "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        evidenceLedger, accounting: stageExecution.accounting(),
      });
    }

    // ===== DETERMINISTIC PRE-FINAL RENDER (NO OpenAI call) =====
    const calibratedResponses: Array<{ componentId: string; label: string; text: string }> =
      (calibrated.responses || calibrated.componentPlans || []).map((r: any) => ({
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

    // The action planner fails closed when required topic coverage is unknown,
    // evidence is missing, or the pre-final render is invalid. The pipeline must
    // NOT proceed to the Finalizer in those cases — there is no authorized scope.
    if (actionPlan.blocked) {
      await stageExecution.finish(false);
      const reason = actionPlan.blockingIssues?.[0]?.code || "ACTION_PLAN_BLOCKED";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        actionPlan, evidenceLedger, accounting: stageExecution.accounting(),
      });
    }

    // Phase 16: Check for missing mandatory topics with no adequate evidence
    const missingMandatoryCheck = checkMissingMandatoryTopics({
      actionPlan,
      requiredTopics: requiredTopicProvenance,
    });
    if (missingMandatoryCheck.blocked) {
      await stageExecution.finish(false);
      const reason = "MISSING_REQUIRED_STUDENT_INFORMATION";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        actionPlan, evidenceLedger, accounting: stageExecution.accounting(),
      });
    }

    // STAGE 5: BOUNDED FINALIZER (receives action plan + render feedback)
    // buildBoundedFinalizerPrompt throws BoundedFinalizerBlockedError if the
    // action plan is internally inconsistent.
    // Phase 34C: Pass calibratedClaims for expectedClaimIds and add retry loop
    // for FINALIZER_METADATA_INCOMPLETE with corrective feedback.
    let finalizerPrompt;
    try {
      finalizerPrompt = buildBoundedFinalizerPrompt({
        calibratedOutput: { responses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })) },
        responseComponents: input.responseComponents,
        actionPlan,
        evidenceLedger,
        renderFeedback: preFinalFeedback,
        calibratedClaims: calibratedClaims.map(c => ({ claimId: c.claimId, componentId: c.componentId })),
      });
    } catch (error) {
      await stageExecution.finish(false);
      const reason = error instanceof BoundedFinalizerBlockedError
        ? "BOUNDED_FINALIZER_BLOCKED"
        : (error as Error)?.message || "BOUNDED_FINALIZER_BLOCKED";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        actionPlan, evidenceLedger, accounting: stageExecution.accounting(),
      });
    }

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

    // Phase 34C: Retry loop for FINALIZER_METADATA_INCOMPLETE
    // When the Finalizer returns empty claim metadata, retry with corrective
    // feedback telling the model exactly which claim IDs to classify.
    // Uses existing technical retry infrastructure (maxTechnicalRetries = 2).
    // Stages 1-4 are NOT re-executed — only the Finalizer OpenAI call is retried.
    let finalizerResult;
    let finalizerRetryCount = 0;
    const maxFinalizerRetries = 2;
    while (true) {
      try {
        finalizerResult = await stageExecution.execute(
          "finalizer", finalizerPrompt.system, finalizerPrompt.user,
          { freezeComponentIds, expectedClaimIds: expectedClaimIdsMap }
        );
        break;
      } catch (error: any) {
        const isMetadataIncomplete = error?.code === "FINALIZER_METADATA_INCOMPLETE";
        if (!isMetadataIncomplete || finalizerRetryCount >= maxFinalizerRetries) {
          // Not retryable or retry limit exceeded — fail closed
          await stageExecution.finish(false);
          const reason = isMetadataIncomplete
            ? "FINALIZER_METADATA_INCOMPLETE_RETRY_EXHAUSTED"
            : (error?.message || "FINALIZER_EXECUTION_FAILED");
          return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
            planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
            actionPlan, evidenceLedger, accounting: stageExecution.accounting(),
          });
        }
        // Phase 34C: Build corrective retry prompt
        finalizerRetryCount++;
        // Determine which components had empty metadata from the error message
        // and build corrective feedback with their expected claim IDs
        const failedComponents = actionPlan.plans
          .filter(p => p.action !== "FREEZE")
          .map(p => ({
            componentId: p.componentId,
            expectedClaimIds: expectedClaimIdsMap.get(p.componentId) ?? [],
          }))
          .filter(fc => fc.expectedClaimIds.length > 0);

        finalizerPrompt = buildBoundedFinalizerPrompt({
          calibratedOutput: { responses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })) },
          responseComponents: input.responseComponents,
          actionPlan,
          evidenceLedger,
          renderFeedback: preFinalFeedback,
          calibratedClaims: calibratedClaims.map(c => ({ claimId: c.claimId, componentId: c.componentId })),
          retryCorrection: { failedComponents },
        });
      }
    }
    const finalized = JSON.parse(finalizerResult.content);
    stageUsages.push(finalizerResult.stageUsage);

    // Normalise responses
    const rawResponses: any[] = finalized.responses || finalized.componentPlans || [];
    const responses: ApplicationResponseItem[] = rawResponses.map((r: any) => ({
      componentId: r.componentId,
      title: r.title || r.componentId,
      text: r.text || "",
    }));

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
      }
    }

    // ===== DETERMINISTIC FINALIZER GUARD (NO OpenAI call) =====
    // Validate the Finalizer output against the action plan BEFORE stage 6.
    // A guard failure is a content failure: the pipeline must not present
    // unverified final text to the student.
    const finalizerGuard = validateFinalizerOutput({
      actionPlan,
      calibratedResponses: calibratedResponses.map(r => ({ componentId: r.componentId, text: r.text })),
      finalResponses: responses.map(r => ({ componentId: r.componentId, text: r.text, repairReferences: (rawResponses.find((rr: any) => rr.componentId === r.componentId)?.repairReferences) })),
      finalRenderFeedback: finalFeedback,
      evidenceLedger,
      responseComponents: input.responseComponents,
    });

    if (!finalizerGuard.passed) {
      await stageExecution.finish(false);
      const reason = finalizerGuard.violations[0] || "FINALIZER_GUARD_FAILED";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        finalizedOutput: finalized, actionPlan, finalizerGuard, evidenceLedger,
        accounting: stageExecution.accounting(),
      });
    }

    // ===== DETERMINISTIC CLAIM PROVENANCE VALIDATION (Phase 16, NO OpenAI call) =====
    // Phase 21: Strict Finalizer output parsing.
    // Distinguish FIELD_MISSING from FIELD_EXPLICITLY_RETURNED_EMPTY.
    // For non-FREEZE actions, missing claim metadata is TECHNICAL_STAGE_OUTPUT_INVALID.
    const finalizerClaimOutputs: FinalizerClaimOutput[] = rawResponses.map((r: any) => {
      const hasRetained = "retainedClaimIds" in r;
      const hasRemoved = "removedClaimIds" in r;
      const hasRepair = "repairClaims" in r;
      // Check if any required field is missing for non-FREEZE actions
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

    const claimProvenanceValidation = validateFinalizerClaims({
      preFinalClaims: calibratedClaims,
      finalizerOutputs: finalizerClaimOutputs,
      actionPlan,
      requiredTopics: requiredTopicProvenance,
    });

    if (!claimProvenanceValidation.valid) {
      await stageExecution.finish(false);
      const reason = claimProvenanceValidation.violations[0]?.code || "CLAIM_PROVENANCE_VIOLATION";
      return errorResult(reason, pipelineStart, renderCheckCount, generationId, {
        planner: plan, writerOutput, qualityReview, calibratedOutput: calibrated,
        finalizedOutput: finalized, actionPlan, finalizerGuard, evidenceLedger,
        claimProvenanceValidation, writerClaims, calibratedClaims,
        accounting: stageExecution.accounting(),
      });
    }

    // STAGE 6: FINAL FACT REVIEWER — audits the ACTUAL final text
    // Phase 19: Final Fact Reviewer receives canonical bundle text
    // (includes projectClarifications and all evidence categories)
    const factPrompt = buildGenericFinalFactReviewerPrompt(
      responses.map(r => ({ componentId: r.componentId, text: r.text })),
      studentFactsText, programFactsText, input.facultyAlignment, input.responseComponents,
      input.documentTypeConfig ? `DOCUMENT TYPE: ${input.documentTypeConfig.displayName}\nWRITING PERSPECTIVE: ${input.documentTypeConfig.writingPerspective}\n${input.documentTypeConfig.recommenderPerspectiveRequired ? "RECOMMENDER SAFETY: Claims about recommender observations, relationship duration, courses taught, or performance rankings must be supported by approved evidence." : ""}${input.documentTypeConfig.visaSpecificEvidence ? "VISA SAFETY: Claims about financial assets, family obligations, property, or immigration intent must be supported by approved evidence." : ""}` : undefined
    );
    const factResult = await stageExecution.execute(
      "factReviewer", factPrompt.system, factPrompt.user
    );
    const factReview: FactReviewOutput = JSON.parse(factResult.content);
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
    const postChecks = runPostFinalChecks(responses, input.responseComponents.length);

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
    return {
      status: "error",
      error: error?.message || "PIPELINE_ERROR",
      generationId,
      planner: null, writerOutput: null, qualityReview: null, factReview: null,
      calibratedOutput: null, finalizedOutput: null,
      compliance: null, responses: [], finalText: "",
      renderLifecycle: null, preFinalRenderFeedback: null, finalRenderFeedback: null,
      accounting,
      metrics: { wordCount: 0, model: "", stages: stageUsages.length, duration, cost, renderChecks: renderCheckCount },
    };
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
