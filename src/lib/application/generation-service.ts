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

import { loadDocumentGenerationContext, buildPipelineWritingInstructions, DocumentGenerationContext } from "@/lib/application/generation-context";
import { adaptProfile } from "@/lib/application/profile-adapter";
import { buildQualityRubricInstructions } from "@/lib/application/document-type-config";
import {
  createDocumentVersion,
  acquireGenerationLock,
  adoptRunOwnership,
  isRunDocumentOwner,
  releaseDocumentGeneration,
  releaseOrphanedDocumentLock,
} from "@/lib/application/application-repository";
import {
  createGenerationRun, cancelRun, completeRun, failRun, markRunRecovering,
  claimRunForResume, getRun, getLatestRun, isActiveGenerationStatus, hasNewerGenerationRun,
  GenerationSupersededError,
  type GenerationRun,
} from "@/lib/application/generation-lifecycle";
import { isSchemaMigrationRequiredError } from "@/lib/application/generation-schema";
import { classifyGenerationError } from "@/lib/application/generation-errors";
import { emitEvent } from "@/lib/observability/events";
import { runApplicationPipeline, ApplicationPipelineInput } from "@/lib/ai/pipeline/run-application-pipeline";
import { isApiKeyConfigured } from "@/lib/ai/openai-client";
import { isProviderCircuitOpen } from "@/lib/ai/openai-transport";
import { markGenerationLive, unmarkGenerationLive } from "@/lib/application/generation-registry";
import type { DocumentVersion } from "@/lib/application/application-types";
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
  /** Restart-recovery: resume an existing active run instead of
   * creating a new one (skips lock acquisition + run creation). */
  resumeRunId?: string;
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
  const resumeRunId = input.resumeRunId || null;

  // In-process live marker — lets restart recovery distinguish a live
  // execution from an orphaned run left by a dead process.
  markGenerationLive(documentId);
  try {
    return await generateApplicationDocumentInner(input, requestId, startTime, resumeRunId);
  } catch (e) {
    // Schema assertion failure — deployment hasn't run the ordering
    // migration. Fail fast with a friendly 503; technical detail in logs.
    if (isSchemaMigrationRequiredError(e)) {
      emitEvent("generation_schema_migration_required", {
        requestId, documentId, missing: e.missing,
      }, "error");
      return {
        ok: false,
        status: 503,
        body: {
          error: "SCHEMA_MIGRATION_REQUIRED",
          message: "Generation is temporarily unavailable because the application database requires an update.",
        },
      };
    }
    throw e;
  } finally {
    unmarkGenerationLive(documentId);
  }
}

async function generateApplicationDocumentInner(
  input: GenerateDocumentInput,
  requestId: string,
  startTime: number,
  resumeRunId: string | null,
): Promise<GenerateDocumentResult> {
  const { studentId, applicationId, documentId } = input;

  emitEvent(resumeRunId ? "generation_service_resume" : "generation_service_start", {
    requestId,
    generationRunId: resumeRunId ?? undefined,
    studentId,
    applicationId,
    documentId,
    resumeRunId,
    buildId: BUILD_ID,
  });

  // ===== LOAD GENERATION CONTEXT =====
  const ctxResult = await loadDocumentGenerationContext(studentId, applicationId, documentId);

  if (!ctxResult.ok || !ctxResult.context) {
    emitEvent("generation_context_failed", {
      requestId,
      documentId,
      errorCode: ctxResult.error || "GENERATION_CONTEXT_FAILED",
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      status: ctxResult.statusCode || 500,
      body: { error: ctxResult.error || "Failed to load generation context" },
    };
  }

  const ctx = ctxResult.context;

  // ===== CHECK API KEY =====
  if (!isApiKeyConfigured()) {
    emitEvent("generation_api_key_missing", {
      requestId,
      documentId,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      status: 503,
      body: { error: "OPENAI_API_KEY_REQUIRED", message: "OpenAI API key is not configured." },
    };
  }

  // ===== CHECK PRE-GENERATION BLOCKS =====
  if (ctx.blocked) {
    emitEvent("generation_blocked", {
      requestId,
      documentId,
      blockReasons: ctx.blockReasons,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      // 422 — business prerequisites incomplete, not an authorization failure.
      status: 422,
      body: {
        error: "GENERATION_BLOCKED",
        message: "Generation is blocked due to pre-generation completeness issues.",
        blockReasons: ctx.blockReasons,
        completenessIssues: ctx.completenessIssues,
      },
    };
  }

  // ===== PROVIDER CIRCUIT BREAKER =====
  // Multiple independent generations hitting genuine provider
  // failures → temporarily reject new generations. A slow document
  // never opens the circuit — only terminal provider errors do.
  if (!resumeRunId && isProviderCircuitOpen()) {
    emitEvent("generation_circuit_open", {
      requestId,
      documentId,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      status: 503,
      body: { error: "AI_SERVICE_TEMPORARILY_UNAVAILABLE", message: "The AI service is temporarily unavailable. Please try again shortly." },
    };
  }

  // Run id — generated BEFORE the lock so lock acquisition can
  // atomically name this run the document's authoritative generation
  // (application_documents.active_generation_run_id).
  const generationId = resumeRunId || randomUUID();

  // ===== ACQUIRE GENERATION LOCK / CLAIM RESUME (atomic) =====
  // Fresh path: conditional UPDATE takes the document lock AND writes
  // this run as the document's generation owner in one statement.
  // Resume path: CAS-claim the run row, then CAS-adopt document
  // ownership — a run superseded by a newer active run can never
  // resume, never touch the document, and never re-bill provider work.
  // Correlation keys for every downstream event + ledger row. The
  // attempt_seq is the authoritative ordering key — always emitted.
  let runMeta: { attemptSeq: number | null; recoveryCount: number } = {
    attemptSeq: null, recoveryCount: 0,
  };

  if (resumeRunId) {
    const claim = await claimResumeOwnership(documentId, generationId);
    if (claim.outcome !== "ok") {
      if (claim.outcome === "superseded") {
        return supersedeRun(generationId, documentId, requestId, startTime);
      }
      emitEvent("generation_resume_rejected", {
        requestId, generationId, generationRunId: generationId,
        documentId, reason: claim.outcome,
        durationMs: Date.now() - startTime,
      });
      return {
        ok: false,
        status: 409,
        body: {
          error: "GENERATION_NOT_RESUMABLE",
          message: "This generation run is no longer active — it was cancelled, completed, or superseded.",
        },
      };
    }
    if (claim.run) {
      runMeta = { attemptSeq: claim.run.attemptSeq, recoveryCount: claim.run.recoveryCount };
      emitEvent("generation_recovery_claimed", {
        requestId, generationId, generationRunId: generationId, documentId,
        attemptSeq: runMeta.attemptSeq, recoveryCount: runMeta.recoveryCount,
        stage: claim.run.currentStage,
        providerResponseId: claim.run.providerResponseId,
      });
    }
  } else {
    const acquired = await acquireGenerationLock(documentId, generationId);
    if (!acquired) {
      emitEvent("generation_lock_conflict", {
        requestId,
        documentId,
        durationMs: Date.now() - startTime,
      });
      return {
        ok: false,
        status: 409,
        body: { error: "GENERATION_ALREADY_IN_PROGRESS", message: "A generation is already running for this document." },
      };
    }
  }

  // ===== BUILD PIPELINE INPUT =====
  const profile = adaptProfile(ctx.student, ctx.profile);
  const merged = ctx.mergedPrompt;
  const config = ctx.documentTypeConfig;

  const artifacts = buildGenerationArtifacts(ctx, profile);
  const { responseComponent, pageLimit, pipelineWritingInstructions, qualityRubricInstructions, programContextText, contract } = artifacts;

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
      generationRunId: generationId,
      documentId,
      attemptSeq: runMeta.attemptSeq,
      requestId,
      recoveryCount: runMeta.recoveryCount,
      // Resume MUST restore persisted checkpoints — CONTENT_REGENERATION
      // would re-pay for every completed stage.
      mode: resumeRunId ? "TECHNICAL_STAGE_RETRY" as const : "CONTENT_REGENERATION" as const,
    },
  };

  // ===== PERSIST GENERATION RUN (stage progress + cancellation) =====
  // Resume path reuses the existing run row — no new attempt record.
  try {
    if (!resumeRunId) {
      await createGenerationRun({
        id: generationId,
        documentId,
        applicationId,
        studentId,
      });
      // Fetch the DB-assigned attempt_seq — the authoritative ordering
      // key every downstream event and ledger row must carry.
      const created = await getRun(generationId);
      if (created) {
        runMeta = { attemptSeq: created.attemptSeq, recoveryCount: created.recoveryCount };
        pipelineInput.execution!.attemptSeq = runMeta.attemptSeq;
        pipelineInput.execution!.recoveryCount = runMeta.recoveryCount;
      }
    }
  } catch (e) {
    // Lifecycle persistence must not block generation — the pipeline
    // still enforces boundaries only when the row exists. NEVER silent:
    // losing the run row means recovery/cancellation evidence is gone.
    emitEvent("generation_run_create_failed", {
      requestId, generationId, generationRunId: generationId, documentId,
      errorCode: "GENERATION_STATE_PERSISTENCE_FAILED",
      detail: e instanceof Error ? e.message : String(e),
    }, "error");
  }

  // ===== RUN SIX-STAGE PIPELINE =====
  const result = await runApplicationPipeline(pipelineInput);

  // ===== CANCELLED — authoritative stop, release lock =====
  if (result.status === "cancelled") {
    await cancelRun(generationId);
    // Release the document generation lock — owner-guarded: if this
    // run was superseded mid-flight, the newer run's state stands.
    await releaseDocumentGeneration(documentId, generationId, "NOT_STARTED");
    emitEvent("generation_cancelled", {
      requestId,
      generationId,
      generationRunId: generationId,
      attemptSeq: runMeta.attemptSeq,
      documentId,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: true,
      status: 200,
      body: { status: "cancelled", generationId, documentId },
    };
  }

  if (result.status === "error") {
    // Superseded mid-pipeline: a newer run owns this document — mark
    // this run FAILED and leave the document/state to the new owner.
    if (result.error === "RUN_SUPERSEDED") {
      return supersedeRun(generationId, documentId, requestId, startTime);
    }
    // Recoverable failure (e.g. stage SLA fired while the provider
    // response is still in flight): mark the run RECOVERING — the
    // heartbeat goes stale and status-endpoint recovery resumes the SAME
    // run, polling the SAME provider response. No duplicate paid call.
    // Document stays GENERATING → generation lock held, UI shows the
    // recovering state. If the recovery budget is exhausted, fail hard.
    if (result.recoverable) {
      const marked = await markRunRecovering(generationId, result.error || "RECOVERABLE");
      if (marked) {
        emitEvent("generation_run_recovering", {
          requestId, generationId, generationRunId: generationId, documentId,
          attemptSeq: runMeta.attemptSeq,
          recoveryCount: runMeta.recoveryCount + 1,
          errorCode: result.error || "RECOVERABLE",
          durationMs: Date.now() - startTime,
        });
        return {
          ok: true,
          status: 200,
          body: {
            status: "recovering",
            code: "GENERATION_PROVIDER_DELAY",
            generationId: result.generationId,
            message: "Generation is taking longer than expected. D-Vivid is recovering automatically.",
          },
        };
      }
      // Recovery budget exhausted → fall through to normal FAILED path.
    }
    const normalized = classifyGenerationError(result.error);
    await failRun(generationId, result.error || "PIPELINE_ERROR");
    await releaseDocumentGeneration(documentId, generationId, "FAILED");
    emitEvent("generation_pipeline_error", {
      requestId,
      generationId,
      generationRunId: generationId,
      attemptSeq: runMeta.attemptSeq,
      documentId,
      errorCode: normalized.code,
      errorClass: normalized.class,
      detail: (result.error || "").slice(0, 300),
      durationMs: Date.now() - startTime,
    }, "error");
    return {
      ok: false,
      status: 500,
      body: {
        // Frontend contract: stable code + friendly message — never the
        // raw stage/provider string.
        error: normalized.userMessage,
        code: normalized.code,
        generationId: result.generationId,
        stages: result.metrics.stages,
        partialCost: result.metrics.cost,
      },
    };
  }

  // ===== SAVE DOCUMENT VERSION =====
  // Ownership re-check: a newer run may have acquired the document
  // between the last stage boundary and finalization. A superseded
  // run must not publish a version or flip document state.
  if (!(await isRunDocumentOwner(documentId, generationId))) {
    return supersedeRun(generationId, documentId, requestId, startTime);
  }

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

  // Ownership is re-enforced ATOMICALLY inside the version transaction
  // (document row FOR UPDATE + owner/newer-run check) — the soft check
  // above plus this guard together close the TOCTOU window.
  let version: DocumentVersion;
  try {
    version = await createDocumentVersion({
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
      expectedGenerationRunId: generationId,
    });
  } catch (e) {
    if (e instanceof GenerationSupersededError) {
      return supersedeRun(generationId, documentId, requestId, startTime);
    }
    throw e;
  }

  // ===== UPDATE GENERATION STATUS =====
  // completeRun is a CAS on (active status + document ownership) — a
  // cancel racing completion, or a superseding run, produces exactly
  // one winner; a CANCELLED/superseded state is never overwritten.
  const completed = await completeRun(generationId, result.warnings || []);
  if (!completed) {
    // CAS lost — either a cancel raced completion (release the lock
    // and report cancelled) or this run was superseded (yield).
    const run = await getRun(generationId);
    if (run?.status === "CANCEL_REQUESTED" || run?.status === "CANCELLED") {
      await cancelRun(generationId);
      await releaseDocumentGeneration(documentId, generationId, "NOT_STARTED");
      return {
        ok: true,
        status: 200,
        body: { status: "cancelled", generationId, documentId },
      };
    }
    return supersedeRun(generationId, documentId, requestId, startTime);
  }
  await releaseDocumentGeneration(documentId, generationId, "GENERATED");

  emitEvent("generation_service_success", {
    requestId,
    generationId,
    generationRunId: generationId,
    attemptSeq: runMeta.attemptSeq,
    documentId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    durationMs: Date.now() - startTime,
  });
  if (resumeRunId) {
    emitEvent("generation_recovery_completed", {
      requestId, generationId, generationRunId: generationId, documentId,
      attemptSeq: runMeta.attemptSeq, recoveryCount: runMeta.recoveryCount,
      durationMs: Date.now() - startTime,
    });
  }

  return {
    ok: true,
    status: 200,
    body: {
      status: "success",
      generationId,
      documentType: config.displayName,
      warnings: result.warnings || [],
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
 * Claim + adopt ownership for a resume request. Returns:
 *   "ok"          — run claimed and this run owns the document
 *   "not_found"   — no such run / run belongs to a different document
 *   "not_active"  — run is terminal, CANCEL_REQUESTED, or already
 *                   claimed by another resumer
 *   "superseded"  — a newer active run owns the document
 * On "ok" the claimed run row is returned for event correlation
 * (attemptSeq / recoveryCount / currentStage / providerResponseId).
 */
async function claimResumeOwnership(
  documentId: string,
  runId: string,
): Promise<{ outcome: "ok" | "not_found" | "not_active" | "superseded"; run: GenerationRun | null }> {
  const run = await getRun(runId);
  if (!run || run.documentId !== documentId) return { outcome: "not_found", run: null };
  if (!isActiveGenerationStatus(run.status)) return { outcome: "not_active", run };
  // Exactly-one-claimer CAS: RECOVERING/QUEUED flip to RUNNING; a
  // RUNNING run is claimable only when its heartbeat is stale. The CAS
  // also fails when a NEWER run exists for the document (any status —
  // a later attempt supersedes regardless of how it ended).
  if (!(await claimRunForResume(runId))) {
    if (await hasNewerGenerationRun(documentId, runId)) return { outcome: "superseded", run };
    return { outcome: "not_active", run };
  }
  if (!(await adoptRunOwnership(documentId, runId))) return { outcome: "superseded", run };
  return { outcome: "ok", run };
}

/**
 * A superseded run loses all document authority. Mark its run row
 * FAILED (terminal — never resumes again), best-effort cancel its
 * in-flight provider response if any, and DO NOT touch
 * application_documents — the newer run owns it.
 */
async function supersedeRun(
  runId: string,
  documentId: string,
  requestId: string,
  startTime: number,
): Promise<GenerateDocumentResult> {
  try {
    const run = await getRun(runId);
    await failRun(runId, "SUPERSEDED_BY_NEWER_RUN");
    if (
      run?.providerResponseId &&
      ["queued", "in_progress"].includes(run.providerResponseStatus || "")
    ) {
      try {
        const { getStageTransport } = await import("@/lib/ai/openai-transport");
        await getStageTransport().cancelBackgroundStage(run.providerResponseId);
      } catch (e) {
        emitEvent("provider_cancel_failed", {
          requestId, generationId: runId, generationRunId: runId, documentId,
          providerResponseId: run.providerResponseId,
          detail: e instanceof Error ? e.message : String(e),
        }, "warn");
      }
    }
    // Supersession evidence must name BOTH attempts — oldAttemptSeq is
    // this run's; newAttemptSeq is the latest run for the document
    // (the superseding owner, strict attempt_seq ordering).
    const newer = await getLatestRun(documentId).catch(() => null);
    emitEvent("generation_superseded", {
      requestId, generationId: runId, generationRunId: runId, documentId,
      oldAttemptSeq: run?.attemptSeq ?? null,
      newAttemptSeq: newer?.attemptSeq ?? null,
      stage: run?.currentStage ?? null,
      providerResponseId: run?.providerResponseId ?? null,
      reason: "SUPERSEDED_BY_NEWER_RUN",
      durationMs: Date.now() - startTime,
    });
  } catch (e) {
    emitEvent("generation_supersede_error", {
      requestId, generationId: runId, generationRunId: runId, documentId,
      detail: e instanceof Error ? e.message : String(e),
    }, "error");
  }
  return {
    ok: false,
    status: 409,
    body: {
      error: "GENERATION_SUPERSEDED",
      message: "A newer generation run now owns this document.",
      generationId: runId,
    },
  };
}

/**
 * Build every deterministic generation artifact from a loaded context.
 * Extracted so the zero-token preflight (scripts/generation-preflight.ts)
 * uses the exact production construction — no duplicated logic to drift.
 */
export function buildGenerationArtifacts(ctx: DocumentGenerationContext, profile: any) {
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
    // Topics inherited from consultant-entered University Requirements are
    // "DECLARED" — they reach Planner/Writer/QR prompts but are NOT subject
    // to the hard mandatory-evidence gate, which exists to protect
    // OFFICIAL_VERIFIED requirement topics. Marking consultant topics
    // REQUIRED would block generation on pattern-matched evidence checks
    // designed for verified official requirements.
    additionalQuestions: merged.additionalQuestions || [],
    requiredTopics: (merged.requiredTopics || []).map(t => ({
      topic: t,
      status: merged.writingRequirementId ? "REQUIRED" : "DECLARED",
      sourceId: merged.writingRequirementId || "university_requirements",
      sourceQuote: t,
    })),
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

  // ===== GENERATION CONTRACT =====
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
    requiredTopics: merged.requiredTopics || [],
    formatInstructions: merged.formattingInstructions ? [merged.formattingInstructions] : [],
    additionalQuestions: merged.additionalQuestions || [],
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

  return {
    responseComponent,
    pageLimit,
    pipelineWritingInstructions,
    qualityRubricInstructions,
    programContextText,
    writingRequirement,
    languageProfile,
    contract,
  };
}

export async function releaseGenerationLock(documentId: string): Promise<void> {
  try {
    // Route-level catch-all: only release when no active run owns the
    // document — a live run's recovery path stays authoritative.
    await releaseOrphanedDocumentLock(documentId);
  } catch {
    // best-effort — ignore
  }
}
