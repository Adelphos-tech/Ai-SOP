// ============================================================
// GET /api/application/student
// Phase SOP-AI-29
// ============================================================
// Get student by ID, email, or search by name
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getStudent, getStudentByEmail, searchStudents, getStudentProfile } from "@/lib/application/application-repository";
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
    const id = searchParams.get("id");
    const email = searchParams.get("email");
    const query = searchParams.get("q");
    const includeProfile = searchParams.get("profile") === "true";

    // Authorize student access if a student id is provided
    if (id) {
      await authorizeStudentAccess(consultant, id);
    }

    if (id) {
      const student = await getStudent(id);
      if (!student) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }
      if (includeProfile) {
        const profile = await getStudentProfile(id);
        return NextResponse.json({ student, profile });
      }
      return NextResponse.json({ student });
    }

    if (email) {
      const student = await getStudentByEmail(email);
      if (!student) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }
      return NextResponse.json({ student });
    }

    if (query) {
      const students = await searchStudents(query);
      return NextResponse.json({ students });
    }

    return NextResponse.json({ error: "Provide id, email, or q parameter" }, { status: 400 });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
