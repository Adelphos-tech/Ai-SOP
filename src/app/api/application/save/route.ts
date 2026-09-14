// ============================================================
// POST /api/application/save
// Phase SOP-AI-29
// ============================================================
// Creates student + application + document in one transaction.
// Returns stable IDs.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createStudent,
  getStudentByEmail,
  createApplication,
  createDocument,
  listStudentApplications,
  listApplicationDocuments,
} from "@/lib/application/application-repository";
import {
  CreateStudentInput,
  CreateApplicationInput,
  CreateDocumentInput,
  isValidDocumentType,
  isValidPromptSource,
  isUserSettablePromptSource,
} from "@/lib/application/application-types";
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

    // Authorize student access if an existing studentId is provided
    if (body.student?.id) {
      await authorizeStudentAccess(consultant, body.student.id);
    }

    // Validate required fields
    if (!body.student?.firstName || !body.student?.lastName || !body.student?.email) {
      return NextResponse.json(
        { error: "Student firstName, lastName, and email are required" },
        { status: 400 },
      );
    }
    if (!body.application?.universityName || !body.application?.programName || !body.application?.degree) {
      return NextResponse.json(
        { error: "Application universityName, programName, and degree are required" },
        { status: 400 },
      );
    }
    if (!body.document?.documentType || !body.document?.promptText) {
      return NextResponse.json(
        { error: "Document documentType and promptText are required" },
        { status: 400 },
      );
    }

    // Validate document type
    if (!isValidDocumentType(body.document.documentType)) {
      return NextResponse.json(
        { error: `Invalid document type: ${body.document.documentType}` },
        { status: 400 },
      );
    }

    // Validate prompt source
    const promptSource = body.document.promptSource || "CONSULTANT_PROVIDED";
    if (!isValidPromptSource(promptSource)) {
      return NextResponse.json(
        { error: `Invalid prompt source: ${promptSource}` },
        { status: 400 },
      );
    }

    // Prevent false OFFICIAL_VERIFIED
    if (promptSource === "OFFICIAL_VERIFIED") {
      return NextResponse.json(
        { error: "OFFICIAL_VERIFIED prompt source can only be set by the server" },
        { status: 403 },
      );
    }

    // Step 1: Create or find student
    let student;
    let duplicateWarning = false;
    if (body.student.id) {
      // Use existing student
      const { getStudent } = await import("@/lib/application/application-repository");
      student = await getStudent(body.student.id);
      if (!student) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }
    } else {
      // Check if student with this email already exists
      const existing = await getStudentByEmail(body.student.email);
      if (existing) {
        student = existing;
        duplicateWarning = true;
      } else {
        const studentInput: CreateStudentInput = {
          firstName: body.student.firstName,
          lastName: body.student.lastName,
          email: body.student.email,
          phone: body.student.phone,
          country: body.student.country,
          externalRefId: body.student.externalRefId,
          profileData: body.student.profileData,
        };
        student = await createStudent(studentInput);
      }
    }

    // Step 2: Create application
    const appInput: CreateApplicationInput = {
      studentId: student.id,
      universityName: body.application.universityName,
      programName: body.application.programName,
      degree: body.application.degree,
      department: body.application.department,
      country: body.application.country || "",
      intake: body.application.intake || "",
      intakeYear: body.application.intakeYear || "",
    };
    const application = await createApplication(appInput);

    // Step 3: Create document
    const docInput: CreateDocumentInput = {
      applicationId: application.id,
      documentType: body.document.documentType,
      documentTitle: body.document.documentTitle || body.document.documentType,
      promptText: body.document.promptText,
      promptSource: promptSource,
      wordMin: body.document.wordMin,
      wordMax: body.document.wordMax,
      characterLimit: body.document.characterLimit,
      pageLimit: body.document.pageLimit,
      specialInstructions: body.document.specialInstructions,
      facultyInstructions: body.document.facultyInstructions,
      formattingInstructions: body.document.formattingInstructions,
    };
    const document = await createDocument(docInput);

    return NextResponse.json({
      success: true,
      studentId: student.id,
      applicationId: application.id,
      documentId: document.id,
      student,
      application,
      document,
      duplicateEmailWarning: duplicateWarning,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
