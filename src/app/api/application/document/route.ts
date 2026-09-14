// ============================================================
// POST /api/application/document
// Phase SOP-AI-29
// ============================================================
// Create a new document for an existing application
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createDocument, getDocument, listApplicationDocuments } from "@/lib/application/application-repository";
import {
  CreateDocumentInput,
  isValidDocumentType,
  isValidPromptSource,
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

    if (!body.applicationId || !body.documentType || !body.promptText) {
      return NextResponse.json(
        { error: "applicationId, documentType, and promptText are required" },
        { status: 400 },
      );
    }

    if (!isValidDocumentType(body.documentType)) {
      return NextResponse.json(
        { error: `Invalid document type: ${body.documentType}` },
        { status: 400 },
      );
    }

    const promptSource = body.promptSource || "CONSULTANT_PROVIDED";
    if (!isValidPromptSource(promptSource)) {
      return NextResponse.json(
        { error: `Invalid prompt source: ${promptSource}` },
        { status: 400 },
      );
    }

    if (promptSource === "OFFICIAL_VERIFIED") {
      // Only allowed when a writingRequirementId is provided (from verified requirement)
      if (!body.writingRequirementId) {
        return NextResponse.json(
          { error: "OFFICIAL_VERIFIED prompt source can only be set by the server when linked to a verified writing requirement" },
          { status: 403 },
        );
      }
    }

    if (promptSource === "DVIVID_DEFAULT_TEMPLATE") {
      // Only allowed when the server's resolve-prompt flow applies it
      if (!body.writingRequirementId) {
        return NextResponse.json(
          { error: "DVIVID_DEFAULT_TEMPLATE prompt source is server-controlled and applied by the resolve-prompt flow" },
          { status: 403 },
        );
      }
    }

    const docInput: CreateDocumentInput = {
      applicationId: body.applicationId,
      documentType: body.documentType,
      documentTitle: body.documentTitle || body.documentType,
      promptText: body.promptText,
      promptSource,
      wordMin: body.wordMin,
      wordMax: body.wordMax,
      characterLimit: body.characterLimit,
      pageLimit: body.pageLimit,
      specialInstructions: body.specialInstructions,
      facultyInstructions: body.facultyInstructions,
      formattingInstructions: body.formattingInstructions,
    };

    const document = await createDocument(docInput);

    // Link document to writing requirement if provided
    if (body.writingRequirementId) {
      const { linkDocumentToWritingRequirement } = await import("@/lib/application/requirements-repository");
      await linkDocumentToWritingRequirement(document.id, body.writingRequirementId);
    }

    return NextResponse.json({ success: true, document });
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
    const applicationId = searchParams.get("applicationId");
    const studentId = searchParams.get("studentId");

    // Authorize student access if studentId is provided
    if (studentId) {
      await authorizeStudentAccess(consultant, studentId);
    }

    if (id) {
      const document = await getDocument(id);
      if (!document) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      // Validate ownership if studentId provided
      if (studentId) {
        const { getApplication } = await import("@/lib/application/application-repository");
        const app = await getApplication(document.applicationId);
        if (!app || app.studentId !== studentId) {
          return NextResponse.json({ error: "Document does not belong to this student" }, { status: 403 });
        }
      }
      return NextResponse.json({ document });
    }

    if (applicationId) {
      // Validate application belongs to student if studentId provided
      if (studentId) {
        const { getApplication } = await import("@/lib/application/application-repository");
        const app = await getApplication(applicationId);
        if (!app || app.studentId !== studentId) {
          return NextResponse.json({ error: "Application does not belong to this student" }, { status: 403 });
        }
      }
      const documents = await listApplicationDocuments(applicationId);
      return NextResponse.json({ documents });
    }

    return NextResponse.json(
      { error: "Provide id or applicationId parameter" },
      { status: 400 },
    );
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
