// ============================================================
// POST /api/application/delete
// ============================================================
// Permanently deletes ONE application and its owned data
// (documents, versions, generation runs/stage responses).
// NEVER touches: student, students.profile_data, other
// applications, shared program/requirement library data.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getApplication,
  deleteApplicationCascade,
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
    if (!body.applicationId || !body.studentId) {
      return NextResponse.json(
        { error: "applicationId and studentId are required" },
        { status: 400 },
      );
    }

    // Ownership: the application must belong to the stated student —
    // applicationId alone is never trusted.
    const application = await getApplication(body.applicationId);
    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    if (application.studentId !== body.studentId) {
      return NextResponse.json(
        { error: "Application does not belong to this student" },
        { status: 403 },
      );
    }

    await authorizeStudentAccess(consultant, body.studentId);

    const deleted = await deleteApplicationCascade(body.applicationId);
    if (!deleted) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    console.warn(
      `[application-delete] applicationId=${body.applicationId} studentId=${body.studentId} university="${application.universityName}" consultant=${consultant.id}`,
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete application." },
      { status: 500 },
    );
  }
}
