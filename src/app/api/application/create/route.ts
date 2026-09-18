// ============================================================
// POST /api/application/create
// Phase SOP-AI-30
// ============================================================
// Create a new application for an EXISTING student.
// Reuses studentId — does NOT create a new student.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStudent,
  createApplication,
  listStudentApplications,
} from "@/lib/application/application-repository";
import { CreateApplicationInput } from "@/lib/application/application-types";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  try {
    // ===== AUTH =====
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

    // Authorize student access
    await authorizeStudentAccess(consultant, body.studentId);
    if (!body.universityName || !body.programName || !body.degree) {
      return NextResponse.json(
        { error: "universityName, programName, and degree are required" },
        { status: 400 },
      );
    }

    // Validate student exists
    const student = await getStudent(body.studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const appInput: CreateApplicationInput = {
      studentId: body.studentId,
      universityName: String(body.universityName).trim(),
      programName: body.programName,
      degree: body.degree,
      department: body.department,
      country: body.country || "",
      intake: body.intake || "",
      intakeYear: body.intakeYear || "",
    };

    const application = await createApplication(appInput);

    const applications = await listStudentApplications(body.studentId);

    return NextResponse.json({
      success: true,
      application,
      student,
      totalApplications: applications.length,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
