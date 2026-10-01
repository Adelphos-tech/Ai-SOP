// ============================================================
// POST /api/application/delete
// ============================================================
// Permanently deletes ONE application and its owned data
// (documents, versions, generation runs/stage responses).
// NEVER touches: student, students.profile_data, other
// applications, shared program/requirement library data.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { emitEvent } from "@/lib/observability/events";
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
    if (deleted === "NOT_FOUND") {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    if (deleted === "GENERATING") {
      return NextResponse.json(
        {
          error: "Cannot delete an application while generation is in progress. Cancel the generation first.",
          code: "GENERATION_IN_PROGRESS",
        },
        { status: 409 },
      );
    }

    // Audit event — ids only; university name is org data, not PII.
    emitEvent("application_deleted", {
      applicationId: body.applicationId,
      studentId: body.studentId,
      university: application.universityName,
      actorId: consultant.id,
    }, "warn");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: "Failed to delete application.", code: "APPLICATION_DELETE_FAILED" },
      { status: 500 },
    );
  }
}
