import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { adaptBenchmarkToProfile, checkReferenceLeakage } from "@/lib/ai/benchmark/adapter";
import { runSopPipeline } from "@/lib/ai/pipeline/run-sop-pipeline";
import { isApiKeyConfigured } from "@/lib/ai/openai-client";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    if (!isApiKeyConfigured()) {
      return NextResponse.json({ error: "OPENAI_API_KEY_REQUIRED" }, { status: 503 });
    }

    const body = await req.json();
    const caseId = body.caseId as string;
    const caseFilePath = body.caseFilePath as string;

    if (!caseId || !caseFilePath) {
      return NextResponse.json({ error: "caseId and caseFilePath required" }, { status: 400 });
    }

    // Read benchmark case
    const caseData = JSON.parse(await fs.readFile(caseFilePath, "utf-8"));

    // Adapt to StudentProfile
    const { profile, referenceSop } = adaptBenchmarkToProfile(caseData);

    // Reference leakage check
    const leakageCheck = checkReferenceLeakage(profile);
    if (!leakageCheck.pass) {
      return NextResponse.json({
        error: "REFERENCE_LEAKAGE_DETECTED",
        issues: leakageCheck.issues,
      }, { status: 400 });
    }

    // Run pipeline
    const pipelineStart = Date.now();
    const result = await runSopPipeline(profile);
    const pipelineEnd = Date.now();

    if (result.status === "error") {
      return NextResponse.json({
        caseId,
        status: "error",
        error: result.error,
        partialCost: result.metrics.cost,
        referenceLeakage: leakageCheck,
      }, { status: 500 });
    }

    return NextResponse.json({
      caseId,
      status: "success",
      referenceLeakage: leakageCheck,
      pipelineResult: {
        status: result.status,
        finalSop: result.finalSop,
        wordCount: result.metrics.wordCount,
        model: result.metrics.model,
        duration: result.metrics.duration,
        stages: result.metrics.stages,
        factReview: {
          pass: result.factReview?.pass ?? false,
          unsupportedClaims: result.factReview?.unsupported_claims ?? [],
          alteredClaims: result.factReview?.altered_claims ?? [],
          ambiguousClaims: result.factReview?.ambiguous_claims ?? [],
        },
        qualityReview: {
          scores: result.qualityReview?.scores ?? null,
          majorIssues: result.qualityReview?.major_issues ?? [],
          recommendedEdits: result.qualityReview?.recommended_edits ?? [],
        },
        languageProfile: {
          level: result.languageProfile?.level ?? "",
          tone: result.languageProfile?.tone ?? "",
        },
        cost: result.metrics.cost,
      },
      referenceSop, // returned for evaluation only, NOT used in generation
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Benchmark run error:", error?.message);
    return NextResponse.json({ error: error?.message || "Benchmark run failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Benchmark runner endpoint. Use POST with caseId and caseFilePath." });
}
