// ============================================================
// POST /api/application/version/approve
// Phase SOP-AI-34
// ============================================================
// Approve a specific document version as the final document.
// Server validates ownership and hard constraints (word/char limits).
// Does NOT alter version text.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  approveDocumentVersion,
  validateDocumentOwnership,
} from "@/lib/application/application-repository";
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

    if (!body.documentId || !body.versionId || !body.studentId || !body.applicationId) {
      return NextResponse.json(
        { error: "documentId, versionId, studentId, and applicationId are required" },
        { status: 400 },
      );
    }

    // Authorize student access
    await authorizeStudentAccess(consultant, body.studentId);

    // Validate ownership: application belongs to student, document belongs to application
    try {
      await validateDocumentOwnership(body.documentId, body.applicationId, body.studentId);
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Access denied" },
        { status: 403 },
      );
    }

    const result = await approveDocumentVersion(body.documentId, body.versionId);

    return NextResponse.json({
      success: true,
      document: result.document,
      version: result.version,
      // Warnings the consultant overrode — audit trail for the UI.
      warningsOverridden: result.warningsOverridden,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    const message = error?.message || "Internal server error";
    // Only real technical/data problems fail — never quality warnings.
    const isHardFailure =
      message.includes("not found") || message.includes("empty version") ||
      message.includes("Access denied") || message.includes("does not belong");
    return NextResponse.json({ error: message }, { status: isHardFailure ? 400 : 500 });
  }
}
