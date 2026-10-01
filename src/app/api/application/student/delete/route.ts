// ============================================================
// POST /api/application/student/delete
// ============================================================
// Permanently deletes ONE student and everything they own:
// profile_data + all applications + documents + versions +
// generation runs/stage responses. Shared program/requirement
// library data is never touched.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { emitEvent } from "@/lib/observability/events";
import {
  getStudent,
  deleteStudentCascade,
} from "@/lib/application/application-repository";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  try {
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

    const student = await getStudent(body.studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await authorizeStudentAccess(consultant, body.studentId);

    const deleted = await deleteStudentCascade(body.studentId);
    if (deleted === "NOT_FOUND") {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    if (deleted === "GENERATING") {
      return NextResponse.json(
        {
          error: "Cannot delete a student while generation is in progress. Cancel the generation first.",
          code: "GENERATION_IN_PROGRESS",
        },
        { status: 409 },
      );
    }

    // Audit event — ids only, never name/email (PII).
    emitEvent("student_deleted", {
      studentId: body.studentId,
      actorId: consultant.id,
    }, "warn");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: "Failed to delete student.", code: "STUDENT_DELETE_FAILED" },
      { status: 500 },
    );
  }
}
