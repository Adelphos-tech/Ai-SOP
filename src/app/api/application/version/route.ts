// ============================================================
// POST /api/application/version
// Phase SOP-AI-29, Phase SOP-AI-34
// ============================================================
// Create a new document version
// Phase 34: Consultant edits use saveConsultantVersion which
// forces createdByType = CONSULTANT_EDITED server-side.
// AI generation still uses createDocumentVersion directly.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createDocumentVersion,
  listDocumentVersions,
  saveConsultantVersion,
  validateDocumentOwnership,
  getDocument,
  getApplication,
} from "@/lib/application/application-repository";
import { CreateDocumentVersionInput } from "@/lib/application/application-types";
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

    if (!body.documentId || !body.content) {
      return NextResponse.json(
        { error: "documentId and content are required" },
        { status: 400 },
      );
    }

    // Authorize student access if studentId is provided
    if (body.studentId) {
      await authorizeStudentAccess(consultant, body.studentId);
    }

    // Phase SOP-AI-34: Consultant edit path
    // If the request is a consultant edit (has studentId + applicationId for validation
    // and does NOT have AI-specific fields like model/generationId), use the
    // saveConsultantVersion path which forces CONSULTANT_EDITED server-side.
    const isConsultantEdit = body.studentId && body.applicationId && !body.model && !body.generationId;

    if (isConsultantEdit) {
      // Validate ownership: application belongs to student, document belongs to application
      try {
        await validateDocumentOwnership(body.documentId, body.applicationId, body.studentId);
      } catch (err: any) {
        return NextResponse.json(
          { error: err?.message || "Access denied" },
          { status: 403 },
        );
      }

      try {
        const version = await saveConsultantVersion({
          documentId: body.documentId,
          content: body.content,
          baseVersionId: body.baseVersionId,
          contentFormat: body.contentFormat,
        });
        return NextResponse.json({ success: true, version });
      } catch (err: any) {
        const message = err?.message || "Failed to save version";
        // "No changes to save" is a validation warning, not a server error
        if (message.includes("No changes to save") || message.includes("empty")) {
          return NextResponse.json({ error: message }, { status: 400 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    // AI generation path (existing behavior)
    // Only the server-side generation route should call this path.
    // Browser cannot forge AI_GENERATED because:
    // 1. This path requires model/generationId which browsers don't have
    // 2. The generation route calls createDocumentVersion directly, not via HTTP
    const input: CreateDocumentVersionInput = {
      documentId: body.documentId,
      content: body.content,
      contentFormat: body.contentFormat || "MARKDOWN",
      createdByType: body.createdByType || "SYSTEM",
      model: body.model,
      generationId: body.generationId,
      studentFactsHash: body.studentFactsHash,
      requirementsHash: body.requirementsHash,
      costUsd: body.costUsd,
      costInr: body.costInr,
    };

    const version = await createDocumentVersion(input);

    return NextResponse.json({ success: true, version });
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
    try {
      await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");

    if (!documentId) {
      return NextResponse.json(
        { error: "documentId parameter is required" },
        { status: 400 },
      );
    }

    const versions = await listDocumentVersions(documentId);
    return NextResponse.json({ versions });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
