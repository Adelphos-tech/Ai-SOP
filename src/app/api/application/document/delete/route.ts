// ============================================================
// POST /api/application/document/delete
// ============================================================
// Permanently deletes ONE document and its owned data
// (versions, generation runs/stage responses).
// NEVER touches: student, profile_data, application, other
// documents, shared program/requirement library data.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getDocument,
  getApplication,
  deleteDocumentCascade,
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
    if (!body.documentId || !body.applicationId || !body.studentId) {
      return NextResponse.json(
        { error: "documentId, applicationId and studentId are required" },
        { status: 400 },
      );
    }

    // Ownership: the document must exist and belong to the stated application.
    const document = await getDocument(body.documentId);
    if (!document) {
      return NextResponse.json(
        { error: "Document not found", code: "DOCUMENT_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (document.applicationId !== body.applicationId) {
      return NextResponse.json(
        { error: "Document does not belong to this application", code: "DOCUMENT_APPLICATION_MISMATCH" },
        { status: 403 },
      );
    }

    // Verify the application belongs to the stated student —
    // applicationId alone is never trusted.
    const application = await getApplication(body.applicationId);
    if (!application) {
      return NextResponse.json(
        { error: "Application not found", code: "APPLICATION_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (application.studentId !== body.studentId) {
      return NextResponse.json(
        { error: "Application does not belong to this student", code: "APPLICATION_STUDENT_MISMATCH" },
        { status: 403 },
      );
    }

    await authorizeStudentAccess(consultant, body.studentId);

    const result = await deleteDocumentCascade(body.documentId, body.applicationId);
    if (result === "NOT_FOUND") {
      return NextResponse.json(
        { error: "Document not found", code: "DOCUMENT_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (result === "MISMATCH") {
      return NextResponse.json(
        { error: "Document does not belong to this application", code: "DOCUMENT_APPLICATION_MISMATCH" },
        { status: 403 },
      );
    }
    if (result === "GENERATING") {
      return NextResponse.json(
        {
          error: "Cannot delete a document while generation is in progress. Cancel the generation first.",
          code: "DOCUMENT_GENERATION_IN_PROGRESS",
        },
        { status: 409 },
      );
    }

    console.warn(
      `[document-delete] documentId=${body.documentId} applicationId=${body.applicationId} studentId=${body.studentId} type="${document.documentType}" title="${document.documentTitle}" consultant=${consultant.id}`,
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete document.", code: "DELETE_FAILED" },
      { status: 500 },
    );
  }
}
