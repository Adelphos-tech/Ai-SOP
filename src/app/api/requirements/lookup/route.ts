// ============================================================
// GET /api/requirements/lookup
// Phase SOP-AI-32
// ============================================================
// Look up saved requirements by university/program/degree/intake
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { findRequirementSetByAppIdentity } from "@/lib/application/requirements-repository";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function GET(request: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const university = searchParams.get("university");
    const program = searchParams.get("program");
    const degree = searchParams.get("degree");
    const intake = searchParams.get("intake");
    const intakeYear = searchParams.get("intakeYear");
    const country = searchParams.get("country") || undefined;

    if (!university || !program || !degree || !intake || !intakeYear) {
      return NextResponse.json(
        { error: "university, program, degree, intake, and intakeYear are required" },
        { status: 400 },
      );
    }

    const result = await findRequirementSetByAppIdentity({
      university,
      program,
      degree,
      intake,
      intakeYear,
      country,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
