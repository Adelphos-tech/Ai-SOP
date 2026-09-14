/**
 * @file route.ts
 * @description
 * POST /api/sop/generate-mit-cee
 *
 * THIN ADAPTER over the generic application pipeline.
 * Loads the verified MIT CEE artifacts and delegates to the generic pipeline.
 * Contains NO MIT-specific pipeline logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runApplicationPipeline, ApplicationPipelineInput } from "@/lib/ai/pipeline/run-application-pipeline";
import { isApiKeyConfigured } from "@/lib/ai/openai-client";
import { buildGenerationContract, validateContractForWriting } from "@/lib/requirements/generation-contract";
import { ResponseComponent, FacultyAlignment, PageLimitConstraint } from "@/lib/requirements/generation-contract-types";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 300;

const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");

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
    const profile = body.profile;
    if (!profile || profile.factSheetApproval?.approved !== true) {
      return errorResponse(403, "FACT_SHEET_NOT_APPROVED");
    }
    const execution = body.execution;
    if (execution !== undefined && (
      !execution || typeof execution !== "object" || Array.isArray(execution) ||
      !["CONTENT_REGENERATION", "TECHNICAL_STAGE_RETRY"].includes(execution.mode)
    )) {
      return errorResponse(400, "INVALID_EXECUTION");
    }

    // ===== LOAD VERIFIED ARTIFACTS (adapter-only responsibility) =====
    const brief = JSON.parse(await fs.readFile(path.join(ARTIFACT_BASE, "verified-application-brief.json"), "utf-8"));
    const aiPolicy = JSON.parse(await fs.readFile(path.join(ARTIFACT_BASE, "ai-usage-policy.json"), "utf-8"));
    const rcData = JSON.parse(await fs.readFile(path.join(ARTIFACT_BASE, "response-components.json"), "utf-8"));
    const proposalsData = JSON.parse(await fs.readFile(path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json"), "utf-8"));

    const responseComponents: ResponseComponent[] = rcData.responseComponents;
    const pageLimit: PageLimitConstraint = rcData.totalPageLimit;

    const facultyAlignment: FacultyAlignment[] = proposalsData.proposals
      .filter((p: any) => p.status === "STUDENT_APPROVED" &&
        typeof p.approvedAt === "string" && Number.isFinite(Date.parse(p.approvedAt)) &&
        !p.rejectedAt && Array.isArray(p.verifiedFacultyEvidence) && p.verifiedFacultyEvidence.length > 0 &&
        Array.isArray(p.studentInterestEvidence) && p.studentInterestEvidence.length > 0)
      .map((p: any) => ({
        facultyName: p.facultyName,
        verifiedProgramFactSource: p.verifiedFacultyEvidence[0],
        studentInterestEvidence: p.studentInterestEvidence,
        alignmentReason: p.alignmentReason,
        status: "STUDENT_APPROVED" as const,
      }));

    if (facultyAlignment.length === 0) {
      return errorResponse(422, "MISSING_FACULTY_APPROVAL");
    }

    const identity = brief.applicationIdentity;
    const approvalIdentity = proposalsData.applicationIdentity;
    const application = profile.application;
    if (!identity || !approvalIdentity || !application ||
      approvalIdentity.university !== identity.university ||
      approvalIdentity.program !== identity.program ||
      approvalIdentity.intake !== `${identity.intake} ${identity.intakeYear}` ||
      application.targetCountry !== identity.country ||
      application.targetUniversity !== identity.university ||
      application.targetProgram !== identity.program ||
      application.degreeLevel !== identity.degreeLevel ||
      application.intake !== identity.intake ||
      application.intakeYear !== identity.intakeYear
    ) {
      return errorResponse(403, "APPLICATION_IDENTITY_MISMATCH");
    }

    // ===== BUILD GENERATION CONTRACT =====
    const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
      responseComponents, pageLimit, facultyAlignment, programContext: null,
    });

    if (contractResult.status !== "CLEARED" || !contractResult.contract) {
      return NextResponse.json(
        { error: contractResult.status, blockingIssues: contractResult.blockingReasons, missingRequiredInformation: contractResult.missingRequiredInformation },
        { status: contractResult.status === "MISSING_REQUIRED_STUDENT_INFORMATION" ? 422 : 403 }
      );
    }

    const validation = validateContractForWriting(contractResult.contract);
    if (!validation.valid) {
      return NextResponse.json({ error: "CONTRACT_VALIDATION_FAILED", reason: validation.reason }, { status: 403 });
    }

    // ===== GENERIC PIPELINE =====
    const contract = contractResult.contract;
    const pipelineInput: ApplicationPipelineInput = {
      profile,
      generationContract: contract,
      requirementsBrief: brief,
      aiPolicy,
      responseComponents: contract.responseComponents,
      facultyAlignment: contract.facultyAlignment,
      pageLimit: contract.pageLimit,
      programContextText: contract.programContext ? JSON.stringify(contract.programContext) : "",
      documentTypeLabel: contract.writingRequirement.documentTypeLabel,
      execution: execution === undefined ? undefined : {
        generationId: execution.generationId,
        mode: execution.mode,
      },
    };

    const result = await runApplicationPipeline(pipelineInput);

    if (result.status === "error") {
      return NextResponse.json({ error: result.error, generationId: result.generationId, stages: result.metrics.stages, partialCost: result.metrics.cost }, { status: 500 });
    }

    return NextResponse.json({
      status: result.status,
      generationId: result.generationId,
      documentType: pipelineInput.documentTypeLabel,
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
      generationContract: {
        status: contractResult.status,
        clearedForWriting: contractResult.contract.clearedForWriting,
      },
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
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "MIT CEE adapter endpoint. Delegates to generic pipeline." });
}
