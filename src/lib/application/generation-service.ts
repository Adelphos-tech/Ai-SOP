// ============================================================
// SHARED GENERATION SERVICE
// Phase SOP-INFRA-37
// ============================================================
// Single canonical implementation of document generation.
// Called by:
//   /api/application/document/generate  (canonical route)
//   /api/sop/generate                  (legacy bridge)
//
// No route performs an HTTP self-fetch to another route in the
// same process. Both routes are thin transport adapters that
// delegate to this function.
//
// This function performs:
//   1. Relationship validation (loadDocumentGenerationContext)
//   2. API key check
//   3. Pre-generation block check
//   4. Atomic generation lock (acquireGenerationLock)
//   5. GenerationContract construction
//   6. Six-stage pipeline (runApplicationPipeline)
//   7. DocumentVersion persistence
//   8. Generation status update
//   9. FAILED status on any error
// ============================================================

import { loadDocumentGenerationContext, buildPipelineWritingInstructions } from "@/lib/application/generation-context";
import { adaptProfile } from "@/lib/application/profile-adapter";
import { buildQualityRubricInstructions } from "@/lib/application/document-type-config";
import { updateDocumentStatus, createDocumentVersion, acquireGenerationLock } from "@/lib/application/application-repository";
import { runApplicationPipeline, ApplicationPipelineInput } from "@/lib/ai/pipeline/run-application-pipeline";
import { isApiKeyConfigured } from "@/lib/ai/openai-client";
import {
  ResponseComponent,
  PageLimitConstraint,
  GenerationContract,
  ContractWritingRequirement,
  ContractLanguageProfile,
} from "@/lib/requirements/generation-contract-types";
import { computeContractSemanticHash } from "@/lib/requirements/generation-contract";
import { randomUUID } from "crypto";

// Build version identifier for observability
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || `build-${Date.now()}`;

export interface GenerateDocumentInput {
  studentId: string;
  applicationId: string;
  documentId: string;
  requestId?: string; // optional trace ID from the transport layer
}

export interface GenerateDocumentResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Canonical document generation service.
 *
 * Both /api/application/document/generate and /api/sop/generate call
 * this function directly. No HTTP self-fetch is performed.
 *
 * Returns a structured result so each route can map it to its own
   * NextResponse format without duplicating business logic.
 */
export async function generateApplicationDocument(
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  const { studentId, applicationId, documentId } = input;
  const requestId = input.requestId || randomUUID();
  const startTime = Date.now();

  console.log(JSON.stringify({
    event: "generation_service_start",
    requestId,
    studentId,
    applicationId,
    documentId,
    buildId: BUILD_ID,
  }));

  // ===== LOAD GENERATION CONTEXT =====
  const ctxResult = await loadDocumentGenerationContext(studentId, applicationId, documentId);

  if (!ctxResult.ok || !ctxResult.context) {
    console.log(JSON.stringify({
      event: "generation_context_failed",
      requestId,
      documentId,
      error: ctxResult.error,
      durationMs: Date.now() - startTime,
    }));
    return {
      ok: false,
      status: ctxResult.statusCode || 500,
      body: { error: ctxResult.error || "Failed to load generation context" },
    };
  }

  const ctx = ctxResult.context;

  // ===== CHECK API KEY =====
  if (!isApiKeyConfigured()) {
    console.log(JSON.stringify({
      event: "generation_api_key_missing",
      requestId,
      documentId,
      durationMs: Date.now() - startTime,
    }));
    return {
      ok: false,
      status: 503,
      body: { error: "OPENAI_API_KEY_REQUIRED", message: "OpenAI API key is not configured." },
    };
  }

  // ===== CHECK PRE-GENERATION BLOCKS =====
  if (ctx.blocked) {
    console.log(JSON.stringify({
      event: "generation_blocked",
      requestId,
      documentId,
      blockReasons: ctx.blockReasons,
      durationMs: Date.now() - startTime,
    }));
    return {
      ok: false,
      status: 403,
      body: {
        error: "GENERATION_BLOCKED",
        message: "Generation is blocked due to pre-generation completeness issues.",
        blockReasons: ctx.blockReasons,
        completenessIssues: ctx.completenessIssues,
      },
    };
  }

  // ===== ACQUIRE GENERATION LOCK (atomic) =====
  const acquired = await acquireGenerationLock(documentId);
  if (!acquired) {
    console.log(JSON.stringify({
      event: "generation_lock_conflict",
      requestId,
      documentId,
      durationMs: Date.now() - startTime,
    }));
    return {
      ok: false,
      status: 409,
      body: { error: "GENERATION_ALREADY_IN_PROGRESS", message: "A generation is already running for this document." },
    };
  }

  // ===== BUILD PIPELINE INPUT =====
  const profile = adaptProfile(ctx.student, ctx.profile);
  const merged = ctx.mergedPrompt;
  const config = ctx.documentTypeConfig;

  const responseComponent: ResponseComponent = {
    componentId: "RC-DOC",
    label: ctx.document.documentTitle || config.displayName,
    exactPrompt: merged.promptText,
    pageLimit: {
      type: "PER_DOCUMENT" as const,
      maxPages: merged.pageLimit || null,
      status: merged.pageLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    wordLimit: {
      min: merged.wordMin || null,
      max: merged.wordMax || null,
      status: merged.wordMax ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    characterLimit: {
      min: null,
      max: merged.characterLimit || null,
      status: merged.characterLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    requiredTopics: [],
    sourceId: merged.writingRequirementId || "document",
    status: merged.resolutionPath === "OFFICIAL_VERIFIED" ? "VERIFIED" : "MANUAL",
    verifiedAt: new Date().toISOString(),
  };

  const pageLimit: PageLimitConstraint = {
    type: "PER_DOCUMENT",
    maxPages: merged.pageLimit || null,
    status: merged.pageLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
  };

  const pipelineWritingInstructions = buildPipelineWritingInstructions(ctx);
  const qualityRubricInstructions = buildQualityRubricInstructions(config);

  const programContextText = ctx.application
    ? `University: ${ctx.application.universityName}\nProgram: ${ctx.application.programName}\nDegree: ${ctx.application.degree}\nIntake: ${ctx.application.intake} ${ctx.application.intakeYear}\nCountry: ${ctx.application.country}`
    : "";

  const generationId = randomUUID();

  // ===== BUILD GENERATION CONTRACT =====
  const writingRequirement: ContractWritingRequirement = {
    documentType: ctx.document.documentType,
    documentTypeLabel: config.displayName,
    officialPrompt: merged.promptText,
    officialPromptStatus: merged.resolutionPath === "OFFICIAL_VERIFIED" ? "VERIFIED" : "MANUAL",
    wordLimit: {
      min: merged.wordMin || null,
      max: merged.wordMax || null,
      status: merged.wordMax ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    characterLimit: {
      min: null,
      max: merged.characterLimit || null,
      status: merged.characterLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    requiredTopics: [],
    formatInstructions: merged.formattingInstructions ? [merged.formattingInstructions] : [],
    additionalQuestions: [],
    sourceId: merged.writingRequirementId || null,
    responseComponentCount: 1,
  };

  const languageProfile: ContractLanguageProfile = {
    testType: (profile as any).englishProficiency?.testType || "",
    overallScore: (profile as any).englishProficiency?.overallScore || "",
    writingScore: (profile as any).englishProficiency?.writing || "",
    desiredProfile: (profile as any).writingPreferences?.sopWritingProfile?.level || "Natural Professional",
    tone: (profile as any).writingPreferences?.sopWritingProfile?.tone || "Professional & Personal",
    personalization: (profile as any).writingPreferences?.sopWritingProfile?.personalization || "Balanced",
    technicalDetail: (profile as any).writingPreferences?.sopWritingProfile?.technicalDetail || "Medium",
    openingStyle: (profile as any).writingPreferences?.sopWritingProfile?.openingStyle || "Let AI Choose Best Opening",
  };

  const contract: GenerationContract = {
    contractId: "GC-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8),
    createdAt: new Date().toISOString(),
    studentFacts: profile,
    application: {
      country: ctx.application?.country || "",
      university: ctx.application?.universityName || "",
      program: ctx.application?.programName || "",
      degreeLevel: ctx.application?.degree || "",
      intake: ctx.application?.intake || "",
      intakeYear: ctx.application?.intakeYear || "",
    },
    writingRequirement,
    responseComponents: [responseComponent],
    pageLimit,
    programContext: null,
    countryGuidance: null,
    languageProfile,
    facultyAlignment: [],
    verification: {
      requirementsVerified: true,
      aiWritingAllowed: true,
      aiPolicyStatus: "AI_GENERATION_ALLOWED",
      conflicts: [],
      factSheetApproved: true,
    },
    clearedForWriting: true,
    blockingReasons: [],
  };
  contract.contractSemanticHash = computeContractSemanticHash(contract);

  const pipelineInput: ApplicationPipelineInput = {
    profile,
    responseComponents: [responseComponent],
    facultyAlignment: [],
    pageLimit,
    programContextText,
    documentTypeLabel: config.displayName,
    documentTypeConfig: config,
    pipelineWritingInstructions,
    qualityRubricInstructions,
    generationContract: contract,
    execution: {
      generationId,
      mode: "CONTENT_REGENERATION" as const,
    },
  };

  // ===== RUN SIX-STAGE PIPELINE =====
  const result = await runApplicationPipeline(pipelineInput);

  if (result.status === "error") {
    await updateDocumentStatus(documentId, undefined, "FAILED");
    console.log(JSON.stringify({
      event: "generation_pipeline_error",
      requestId,
      generationId,
      documentId,
      error: result.error,
      durationMs: Date.now() - startTime,
    }));
    return {
      ok: false,
      status: 500,
      body: {
        error: result.error || "PIPELINE_ERROR",
        generationId: result.generationId,
        stages: result.metrics.stages,
        partialCost: result.metrics.cost,
      },
    };
  }

  // ===== SAVE DOCUMENT VERSION =====
  const costUsd = result.metrics.cost?.estimatedApiCostUSD || null;
  const costInr = result.metrics.cost?.estimatedApiCostINR || null;
  const model = result.metrics.model || "unknown";

  const crypto = await import("crypto");
  const studentFactsHash = crypto.createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex")
    .substring(0, 16);
  const requirementsHash = crypto.createHash("sha256")
    .update(JSON.stringify({ prompt: merged.promptText, wordMin: merged.wordMin, wordMax: merged.wordMax }))
    .digest("hex")
    .substring(0, 16);

  const version = await createDocumentVersion({
    documentId,
    content: result.finalText,
    contentFormat: "MARKDOWN",
    createdByType: "AI_GENERATED",
    model,
    generationId,
    studentFactsHash,
    requirementsHash,
    costUsd: costUsd || undefined,
    costInr: costInr || undefined,
  });

  // ===== UPDATE GENERATION STATUS =====
  await updateDocumentStatus(documentId, undefined, "GENERATED");

  console.log(JSON.stringify({
    event: "generation_service_success",
    requestId,
    generationId,
    documentId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    durationMs: Date.now() - startTime,
  }));

  return {
    ok: true,
    status: 200,
    body: {
      status: "success",
      generationId,
      documentType: config.displayName,
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        content: result.finalText,
        wordCount: result.metrics.wordCount,
        model,
        costUsd,
        costInr,
        factReview: result.factReview,
        compliance: result.compliance,
      },
      pipeline: {
        stages: result.metrics.stages,
        duration: result.metrics.duration,
        cost: result.metrics.cost ? {
          inputTokens: result.metrics.cost.totalInputTokens,
          cachedInputTokens: result.metrics.cost.totalCachedInputTokens,
          outputTokens: result.metrics.cost.totalOutputTokens,
          totalTokens: result.metrics.cost.totalTokens,
          estimatedUsd: result.metrics.cost.estimatedApiCostUSD,
          estimatedInr: result.metrics.cost.estimatedApiCostINR,
        } : null,
      },
      promptResolution: {
        source: merged.promptSource,
        path: merged.resolutionPath,
        mergedWithDefault: merged.mergedWithDefault,
      },
    },
  };
}

/**
 * Release the generation lock on failure (best-effort).
 * Called by route catch blocks when generateApplicationDocument throws.
 */
export async function releaseGenerationLock(documentId: string): Promise<void> {
  try {
    await updateDocumentStatus(documentId, undefined, "FAILED");
  } catch {
    // best-effort — ignore
  }
}
