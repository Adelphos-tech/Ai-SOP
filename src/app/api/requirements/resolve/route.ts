import { NextRequest, NextResponse } from "next/server";
import { resolveRequirements } from "@/lib/requirements/resolver";
import { RequirementsResolutionRequest } from "@/lib/requirements/types";
import {
  generateApplicationId,
  computeContextContentHash,
  deriveApplicationVerificationStatus,
  VerifiedApplicationContext,
  APPLICATION_CONTEXT_SCHEMA_VERSION,
} from "@/lib/requirements/application-context";
import { saveVerifiedApplicationContext } from "@/lib/requirements/application-context-repository";
import { buildStudentDeclaredResponseComponents } from "@/lib/requirements/student-declared-requirements";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json() as RequirementsResolutionRequest;

    if (!body?.applicationIdentity) {
      return NextResponse.json(
        { error: "applicationIdentity is required" },
        { status: 400 }
      );
    }

    const ai = body.applicationIdentity;
    if (!ai.country || !ai.university || !ai.program) {
      return NextResponse.json(
        { error: "country, university, and program are required in applicationIdentity" },
        { status: 400 }
      );
    }

    const result = await resolveRequirements({
      applicationIdentity: ai,
      forceRefresh: body.forceRefresh,
      studentProvidedRequirementsUrl: body.studentProvidedRequirementsUrl,
      studentProvidedAiPolicyUrl: body.studentProvidedAiPolicyUrl,
    });

    // If resolution produced a valid brief + AI policy, persist the
    // canonical VerifiedApplicationContext to the server-side store.
    if (result.brief && result.aiPolicy) {
      const applicationId = generateApplicationId(ai);
      const contentHash = computeContextContentHash(result.brief, result.aiPolicy);
      const verificationStatus = deriveApplicationVerificationStatus(
        result.brief,
        result.aiPolicy,
      );

      // Derive response components from the brief (not from student-declared data)
      const responseComponents = buildStudentDeclaredResponseComponents(result.brief);

      const ctx: VerifiedApplicationContext = {
        applicationId,
        schemaVersion: APPLICATION_CONTEXT_SCHEMA_VERSION,
        applicationIdentity: ai,
        brief: result.brief,
        aiPolicy: result.aiPolicy,
        responseComponents: responseComponents,
        facultyContext: [],
        officialSources: result.brief.sources,
        verificationStatus,
        verifiedAt: result.brief.verification.verifiedAt,
        contentHash,
        cacheKey: result.brief.cacheKey,
        createdAt: new Date().toISOString(),
        expiresAt: result.brief.expiresAt,
        fromFixture: false,
      };

      await saveVerifiedApplicationContext(ctx);

      // Return the applicationId so the browser can reference it
      return NextResponse.json({
        ...result,
        applicationId,
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Requirements resolution error:", error?.message);
    return NextResponse.json(
      { error: error?.message || "Requirements resolution failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Requirements resolver endpoint. Use POST with applicationIdentity." });
}
