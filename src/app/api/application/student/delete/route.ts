// ============================================================
// POST /api/application/student/delete
// ============================================================
// Permanently deletes ONE student and everything they own:
// profile_data + all applications + documents + versions +
// generation runs/stage responses. Shared program/requirement
// library data is never touched.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
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
    if (!deleted) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    console.warn(
      `[student-delete] studentId=${body.studentId} name="${student.firstName} ${student.lastName}" email=${student.email} consultant=${consultant.id}`,
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete student." },
      { status: 500 },
    );
  }
}
