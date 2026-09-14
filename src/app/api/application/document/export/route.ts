// ============================================================
// POST /api/application/document/export
// Phase SOP-AI-34A
// ============================================================
// Export a document version as PDF or DOCX.
// Preview mode: any saved version. Final mode: requires approved version.
// Server loads the actual version content — browser sends IDs only.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  validateDocumentOwnership,
  validateVersionOwnership,
  getDocument,
  getDocumentVersion,
  getApplication,
  getStudent,
} from "@/lib/application/application-repository";
import {
  exportDocument,
  countPdfPages,
  ExportFormat,
  ExportMode,
} from "@/lib/application/document-export";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { ResourceBusyError } from "@/lib/concurrency/resource-limiter";

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

    if (!body.studentId || !body.applicationId || !body.documentId || !body.versionId) {
      return NextResponse.json(
        { error: "studentId, applicationId, documentId, and versionId are required" },
        { status: 400 },
      );
    }

    // Authorize student access
    await authorizeStudentAccess(consultant, body.studentId);

    const format: ExportFormat = (body.format || "PDF").toUpperCase() === "DOCX" ? "DOCX" : "PDF";
    const mode: ExportMode = (body.mode || "PREVIEW").toUpperCase() === "FINAL" ? "FINAL" : "PREVIEW";

    // Validate ownership: student → application → document
    try {
      await validateDocumentOwnership(body.documentId, body.applicationId, body.studentId);
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Access denied" },
        { status: 403 },
      );
    }

    // Validate version belongs to document
    let version;
    try {
      version = await validateVersionOwnership(body.versionId, body.documentId);
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Version access denied" },
        { status: 403 },
      );
    }

    // Get document for approval check and limits
    const doc = await getDocument(body.documentId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // For FINAL mode, version must be the approved version
    if (mode === "FINAL") {
      if (!doc.approvedVersionId) {
        return NextResponse.json(
          { error: "Approve a document version before final export." },
          { status: 400 },
        );
      }
      if (body.versionId !== doc.approvedVersionId) {
        return NextResponse.json(
          { error: "Final export must use the approved version." },
          { status: 400 },
        );
      }
    }

    // Physical page limit validation for FINAL export
    if (mode === "FINAL" && doc.pageLimit && format === "PDF") {
      const pageCount = await countPdfPages(version.content);
      if (pageCount > doc.pageLimit) {
        return NextResponse.json(
          { error: `Final export blocked: ${pageCount} pages exceeds the limit of ${doc.pageLimit}.` },
          { status: 400 },
        );
      }
    }

    // Get student and application for filename
    const student = await getStudent(body.studentId);
    const application = await getApplication(body.applicationId);
    if (!student || !application) {
      return NextResponse.json({ error: "Student or application not found" }, { status: 404 });
    }

    const studentName = `${student.firstName} ${student.lastName}`;
    const documentType = doc.documentType.replace(/_/g, " ");

    const result = await exportDocument({
      content: version.content,
      format,
      mode,
      studentName,
      universityName: application.universityName,
      documentType,
      versionNumber: version.versionNumber,
      isApproved: mode === "FINAL",
    });

    // Return as downloadable file
    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    headers.set("Content-Length", result.buffer.length.toString());

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: error.message, code: "EXPORT_BUSY" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
