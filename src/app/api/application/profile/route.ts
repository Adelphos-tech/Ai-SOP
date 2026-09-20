// ============================================================
// GET/PUT /api/application/profile
// Phase SOP-AI-30
// ============================================================
// GET: Load student profile from server (includes _revision)
// PUT: Save student profile to server (conditional on revision)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStudent,
  getStudentProfile,
  getStudentProfileRevision,
  saveStudentProfile,
  saveStudentProfileConditional,
} from "@/lib/application/application-repository";
import { getProfileReadiness } from "@/lib/application/intake-completion";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function GET(request: NextRequest) {
  try {
    // Auth
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    await authorizeStudentAccess(consultant, studentId);

    const student = await getStudent(studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const profile = await getStudentProfile(studentId);
    const revision = await getStudentProfileRevision(studentId);

    return NextResponse.json({
      student,
      profile,
      hasServerProfile: profile !== null,
      revision,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Auth
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await request.json();

    if (!body.studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }
    if (!body.profileData) {
      return NextResponse.json({ error: "profileData is required" }, { status: 400 });
    }

    await authorizeStudentAccess(consultant, body.studentId);

    // Validate student exists
    const student = await getStudent(body.studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Conditional save: if expectedRevision provided, use conditional write
    if (typeof body.expectedRevision === "number") {
      // An explicit profile save IS the deliberate Student Details edit —
      // sync the students row identity from personalData atomically.
      const pd = body.profileData?.personalData || {};
      const saved = await saveStudentProfileConditional(
        body.studentId,
        body.profileData,
        body.expectedRevision,
        { firstName: pd.firstName, lastName: pd.lastName, email: pd.email },
      );
      if (!saved) {
        return NextResponse.json(
          { error: "Profile was modified by another session. Please refresh and retry.", code: "PROFILE_CHANGED" },
          { status: 409 },
        );
      }
      const newRevision = await getStudentProfileRevision(body.studentId);
      // Canonical readiness from the SAVED row — never the request body.
      const savedProfile = await getStudentProfile(body.studentId);
      const readiness = getProfileReadiness(savedProfile);
      return NextResponse.json({
        success: true,
        revision: newRevision,
        readiness: {
          complete: readiness.canGenerate,
          missingSections: readiness.weakAreas,
          missingCount: readiness.weakAreas.length,
        },
      });
    }

    // Non-conditional save (backward compatible) — increment revision
    const currentRev = await getStudentProfileRevision(body.studentId);
    const profileWithRev = { ...body.profileData, _revision: currentRev + 1 };
    await saveStudentProfile(body.studentId, profileWithRev);

    const savedProfile = await getStudentProfile(body.studentId);
    const readiness = getProfileReadiness(savedProfile);
    return NextResponse.json({
      success: true,
      revision: currentRev + 1,
      readiness: {
        complete: readiness.canGenerate,
        missingSections: readiness.weakAreas,
        missingCount: readiness.weakAreas.length,
      },
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
