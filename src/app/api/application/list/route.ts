// ============================================================
// GET /api/application/list
// Phase SOP-AI-29
// ============================================================
// List applications for a student, or documents for an application
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  listStudentApplications,
  listApplicationDocuments,
  listAllApplications,
  getApplication,
} from "@/lib/application/application-repository";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function GET(request: NextRequest) {
  try {
    // ===== AUTH =====
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const applicationId = searchParams.get("applicationId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 200);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

    // Authorize student access if studentId is provided
    if (studentId) {
      await authorizeStudentAccess(consultant, studentId);
    }

    if (studentId) {
      const applications = await listStudentApplications(studentId, limit, offset);
      return NextResponse.json({ applications });
    }

    if (applicationId) {
      const application = await getApplication(applicationId);
      if (!application) {
        return NextResponse.json({ error: "Application not found" }, { status: 404 });
      }
      const documents = await listApplicationDocuments(applicationId, limit, offset);
      return NextResponse.json({ application, documents });
    }

    // No filter: list all applications across all students (cross-student listing page)
    const applications = await listAllApplications(limit, offset);
    return NextResponse.json({ applications });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
