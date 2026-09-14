/**
 * @file route.ts
 * @description
 * POST /api/sop/generate-application
 *
 * GENERIC endpoint for application document generation.
 * Driven entirely by the GenerationContract built from:
 *   approved student facts + verified requirements + AI policy +
 *   program context + approved faculty alignments + language profile.
 *
 * No university-specific logic. Works with any application that has
 * verified requirements and permits AI generation.
 *
 * MAX_PIPELINE_CALLS: 6
 */

import { NextRequest, NextResponse } from "next/server";
import { runApplicationPipeline, ApplicationPipelineInput } from "@/lib/ai/pipeline/run-application-pipeline";
import { isApiKeyConfigured } from "@/lib/ai/openai-client";
import { buildGenerationContract, validateContractForWriting } from "@/lib/requirements/generation-contract";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 300;

function errorResponse(status: number, reason: string) {
  return NextResponse.json({ success: false, reason }, { status });
}

export async function POST(req: NextRequest) {
  if (!isApiKeyConfigured()) {
    return errorResponse(503, "OPENAI_API_KEY_REQUIRED");
  }

  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(400, "INVALID_REQUEST");
    }
    if (JSON.stringify(body).length > 500000) {
      return errorResponse(413, "REQUEST_BODY_TOO_LARGE");
    }
    const execution = body.execution;
    if (execution !== undefined && (
      !execution || typeof execution !== "object" || Array.isArray(execution) ||
      !["CONTENT_REGENERATION", "TECHNICAL_STAGE_RETRY"].includes(execution.mode)
    )) {
      return errorResponse(400, "INVALID_EXECUTION");
    }
    const profile = body.profile;
    const brief = body.brief || body.requirementsBrief;
    const aiPolicy = body.aiPolicy || body.aiUsagePolicy;
    const responseComponents = body.responseComponents || [];
    const pageLimit = body.pageLimit || { type: "PER_DOCUMENT", maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" };
    const facultyAlignment = body.facultyAlignment || [];

    if (!profile || typeof profile !== "object") {
      return errorResponse(400, "PROFILE_REQUIRED");
    }
    if (profile.factSheetApproval?.approved !== true) {
      return errorResponse(403, "FACT_SHEET_NOT_APPROVED");
    }
    if (!brief) {
      return errorResponse(422, "APPLICATION_REQUIREMENTS_UNVERIFIED");
    }
    if (!aiPolicy) {
      return errorResponse(422, "APPLICATION_AI_POLICY_BLOCK");
    }
    if (!Array.isArray(responseComponents) || !responseComponents.length) {
      return errorResponse(422, "NO_RESPONSE_COMPONENTS");
    }
    if (!Array.isArray(facultyAlignment)) {
      return errorResponse(400, "INVALID_FACULTY_ALIGNMENT");
    }

    // ===== BUILD GENERATION CONTRACT =====
    const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
      responseComponents,
      pageLimit,
      facultyAlignment,
      programContext: body.programContext || null,
    });

    if (contractResult.status === "APPLICATION_AI_POLICY_BLOCK") {
      return NextResponse.json({ error: "APPLICATION_AI_POLICY_BLOCK", blockingIssues: contractResult.blockingReasons }, { status: 403 });
    }
    if (contractResult.status === "APPLICATION_REQUIREMENTS_UNVERIFIED") {
      return NextResponse.json({ error: "APPLICATION_REQUIREMENTS_UNVERIFIED", blockingIssues: contractResult.blockingReasons }, { status: 403 });
    }
    if (contractResult.status === "APPLICATION_REQUIREMENT_CONFLICT") {
      return NextResponse.json({ error: "APPLICATION_REQUIREMENT_CONFLICT", blockingIssues: contractResult.blockingReasons }, { status: 403 });
    }
    if (contractResult.status === "MISSING_REQUIRED_STUDENT_INFORMATION") {
      return NextResponse.json({ error: "MISSING_REQUIRED_STUDENT_INFORMATION", blockingIssues: contractResult.blockingReasons, missingRequiredInformation: contractResult.missingRequiredInformation }, { status: 422 });
    }
    if (contractResult.status !== "CLEARED" || !contractResult.contract) {
      return NextResponse.json({ error: "CONTRACT_NOT_CLEARED", status: contractResult.status, blockingIssues: contractResult.blockingReasons }, { status: 403 });
    }

    const validation = validateContractForWriting(contractResult.contract);
    if (!validation.valid) {
      return NextResponse.json({ error: "CONTRACT_VALIDATION_FAILED", reason: validation.reason }, { status: 403 });
    }

    // ===== RUN GENERIC 6-STAGE PIPELINE =====
    const contract = contractResult.contract;
    const documentTypeLabel = contract.writingRequirement.documentTypeLabel;
    const pipelineInput: ApplicationPipelineInput = {
      profile,
      generationContract: contract,
      requirementsBrief: brief,
      aiPolicy,
      responseComponents: contract.responseComponents,
      facultyAlignment: contract.facultyAlignment,
      pageLimit: contract.pageLimit,
      programContextText: contract.programContext ? JSON.stringify(contract.programContext) : "",
      documentTypeLabel,
      execution: execution === undefined ? undefined : {
        generationId: execution.generationId,
        mode: execution.mode,
      },
    };

    const result = await runApplicationPipeline(pipelineInput);

    if (result.status === "error") {
      return NextResponse.json({ error: result.error || "PIPELINE_ERROR", generationId: result.generationId, stages: result.metrics.stages, partialCost: result.metrics.cost }, { status: 500 });
    }

    return NextResponse.json({
      status: result.status,
      generationId: result.generationId,
      documentType: documentTypeLabel,
      responseComponentCount: result.responses.length,
      responses: result.responses,
      finalText: result.finalText,
      wordCount: result.metrics.wordCount,
      model: result.metrics.model,
      stages: result.metrics.stages,
      duration: result.metrics.duration,
      planner: result.planner,
      qualityReview: result.qualityReview,
      factReview: result.factReview,
      compliance: result.compliance,
      cost: result.metrics.cost ? {
        usage: {
          inputTokens: result.metrics.cost.totalInputTokens,
          cachedInputTokens: result.metrics.cost.totalCachedInputTokens,
          outputTokens: result.metrics.cost.totalOutputTokens,
          totalTokens: result.metrics.cost.totalTokens,
        },
        estimatedUsd: result.metrics.cost.estimatedApiCostUSD,
        estimatedInr: result.metrics.cost.estimatedApiCostINR,
        exchangeRate: result.metrics.cost.exchangeRate,
        stages: result.metrics.cost.stages,
      } : null,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Application generation error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Generic application generation endpoint. Use POST." });
}
