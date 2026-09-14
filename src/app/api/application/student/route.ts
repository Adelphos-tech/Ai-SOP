// ============================================================
// GET  /api/application/student   — Get student by ID, email, or search by name
// POST /api/application/student   — Create a new student (canonical New Applicant flow)
// Phase SOP-AI-29 + UX flow consolidation
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStudent,
  getStudentByEmail,
  searchStudents,
  listStudents,
  getStudentProfile,
  createStudent,
} from "@/lib/application/application-repository";
import { CreateStudentInput } from "@/lib/application/application-types";
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

    if (!body.firstName || !body.lastName || !body.email) {
      return NextResponse.json(
        { error: "firstName, lastName, and email are required" },
        { status: 400 },
      );
    }

    // Reuse existing student if one with this email already exists (idempotent)
    const existing = await getStudentByEmail(body.email);
    if (existing) {
      return NextResponse.json({ student: existing, duplicate: true });
    }

    const studentInput: CreateStudentInput = {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      country: body.country,
      externalRefId: body.externalRefId,
      profileData: body.profileData,
    };

    const student = await createStudent(studentInput);
    return NextResponse.json({ student, duplicate: false });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

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
    const listMode = searchParams.get("list") === "true";
    const pageLimit = searchParams.get("limit");
    const offset = searchParams.get("offset");

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

    // List mode with pagination (also supports search query)
    if (listMode || query) {
      const result = await listStudents({
        limit: pageLimit ? parseInt(pageLimit) : 25,
        offset: offset ? parseInt(offset) : 0,
        query: query || undefined,
      });
      return NextResponse.json({
        students: result.students,
        total: result.total,
        limit: pageLimit ? parseInt(pageLimit) : 25,
        offset: offset ? parseInt(offset) : 0,
      });
    }

    return NextResponse.json({ error: "Provide id, email, list=true, or q parameter" }, { status: 400 });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
