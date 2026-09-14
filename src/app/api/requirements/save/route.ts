// ============================================================
// POST /api/requirements/save
// Phase SOP-AI-32
// ============================================================
// Save a verified requirement set to the persistent DB.
// This is the server-controlled entry point — only the server
// can create OFFICIAL_VERIFIED requirements.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createInstitution,
  findInstitutionByName,
  createProgram,
  findProgram,
  createRequirementSet,
  findRequirementSet,
  updateRequirementSet,
  createWritingRequirement,
  createRequirementSource,
} from "@/lib/application/requirements-repository";
import { computeRequirementSetHash } from "@/lib/application/requirements-types";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await request.json();

    if (!body.university || !body.program || !body.degree || !body.intake || !body.intakeYear) {
      return NextResponse.json(
        { error: "university, program, degree, intake, and intakeYear are required" },
        { status: 400 },
      );
    }

    // Find or create institution
    let institution = await findInstitutionByName(body.university);
    if (!institution) {
      institution = await createInstitution({
        canonicalName: body.university,
        country: body.country,
        officialDomain: body.officialDomain,
      });
    }

    // Find or create program
    let program = await findProgram(institution.id, body.program, body.degree);
    if (!program) {
      program = await createProgram({
        institutionId: institution.id,
        programName: body.program,
        degree: body.degree,
        country: body.country,
        department: body.department,
      });
    }

    // Compute hash
    const hash = computeRequirementSetHash({
      university: body.university,
      program: body.program,
      degree: body.degree,
      intake: body.intake,
      intakeYear: body.intakeYear,
      writingRequirements: (body.writingRequirements || []).map((wr: any) => ({
        documentType: wr.documentType,
        promptText: wr.promptText,
        wordMin: wr.wordMin,
        wordMax: wr.wordMax,
      })),
      aiPolicyStatus: body.aiPolicyStatus,
    });

    // Find or create requirement set
    let reqSet = await findRequirementSet(program.id, body.intake, body.intakeYear);
    if (!reqSet) {
      reqSet = await createRequirementSet({
        programId: program.id,
        intake: body.intake,
        intakeYear: body.intakeYear,
        verificationStatus: body.verificationStatus || "VERIFIED",
        aiPolicyStatus: body.aiPolicyStatus || null,
        aiPolicyData: body.aiPolicyData,
        verifiedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        contentHash: hash,
      });
    } else {
      await updateRequirementSet(reqSet.id, {
        verificationStatus: body.verificationStatus || "VERIFIED",
        aiPolicyStatus: body.aiPolicyStatus,
        aiPolicyData: body.aiPolicyData,
        verifiedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        contentHash: hash,
      });
    }

    // Create writing requirements
    const writingReqs = [];
    for (let i = 0; i < (body.writingRequirements || []).length; i++) {
      const wr = body.writingRequirements[i];
      const created = await createWritingRequirement({
        requirementSetId: reqSet.id,
        documentType: wr.documentType,
        officialTitle: wr.officialTitle || wr.documentType,
        promptText: wr.promptText,
        promptSource: "OFFICIAL_VERIFIED", // Server-controlled
        componentOrder: i,
        required: wr.required !== false,
        wordMin: wr.wordMin,
        wordMax: wr.wordMax,
        characterLimit: wr.characterLimit,
        pageLimit: wr.pageLimit,
        specialInstructions: wr.specialInstructions,
        facultyInstructions: wr.facultyInstructions,
        formattingInstructions: wr.formattingInstructions,
        verificationStatus: "VERIFIED",
      });
      writingReqs.push(created);
    }

    // Create sources
    const sources = [];
    for (const src of (body.sources || [])) {
      const created = await createRequirementSource({
        requirementSetId: reqSet.id,
        writingRequirementId: undefined,
        sourceUrl: src.sourceUrl,
        officialDomain: src.officialDomain,
        sourceTitle: src.sourceTitle,
        sourceScope: src.sourceScope || "UNIVERSITY",
        sourceType: src.sourceType,
        retrievedAt: new Date().toISOString(),
        contentHash: src.contentHash,
        status: "ACTIVE",
      });
      sources.push(created);
    }

    return NextResponse.json({
      success: true,
      institutionId: institution.id,
      programId: program.id,
      requirementSetId: reqSet.id,
      contentHash: hash,
      writingRequirements: writingReqs,
      sources,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
