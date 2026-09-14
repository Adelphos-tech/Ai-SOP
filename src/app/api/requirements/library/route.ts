// ============================================================
// GET /api/requirements/library
// Phase SOP-AI-32
// ============================================================
// List/search requirement sets in the library
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  listRequirementSets,
  getProgram,
  getInstitution,
  listWritingRequirements,
  listRequirementSources,
  searchInstitutions,
} from "@/lib/application/requirements-repository";
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
    const query = searchParams.get("q");

    if (query) {
      // Search institutions by name
      const institutions = await searchInstitutions(query);
      return NextResponse.json({ institutions, requirementSets: [] });
    }

    // List all requirement sets with their program/institution info
    const reqSets = await listRequirementSets(50);
    const enriched = await Promise.all(
      reqSets.map(async (rs) => {
        const program = await getProgram(rs.programId);
        const institution = program ? await getInstitution(program.institutionId) : null;
        const writingReqs = await listWritingRequirements(rs.id);
        const sources = await listRequirementSources(rs.id);
        return {
          requirementSet: rs,
          program,
          institution,
          writingRequirements: writingReqs,
          sources,
        };
      }),
    );

    return NextResponse.json({ requirementSets: enriched });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
