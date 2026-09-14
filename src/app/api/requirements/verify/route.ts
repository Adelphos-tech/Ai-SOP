import { NextRequest, NextResponse } from "next/server";
import { checkGenerationGate } from "@/lib/requirements/generation-gate";
import { VerifiedApplicationBrief } from "@/lib/requirements/types";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json();
    const { profile, brief } = body as { profile: any; brief: VerifiedApplicationBrief | null };

    if (!profile) {
      return NextResponse.json({ error: "profile is required" }, { status: 400 });
    }

    const gateResult = checkGenerationGate(profile, brief || null);

    return NextResponse.json({
      allowed: gateResult.allowed,
      blockingIssues: gateResult.blockingIssues,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Gate check error:", error?.message);
    return NextResponse.json({ error: error?.message || "Gate check failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Requirements verification gate. Use POST with profile and brief." });
}
