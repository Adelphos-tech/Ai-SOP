// ============================================================
// POST /api/application/document
// Phase SOP-AI-29
// ============================================================
// Create a new document for an existing application
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createDocument, createOfficialDocument, getDocument, listApplicationDocuments } from "@/lib/application/application-repository";
import { getDefaultTemplate } from "@/lib/application/default-templates";
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

    if (!body.applicationId || !body.documentType) {
      return NextResponse.json(
        { error: "applicationId and documentType are required" },
        { status: 400 },
      );
    }

    if (!isValidDocumentType(body.documentType)) {
      return NextResponse.json(
        { error: `Invalid document type: ${body.documentType}` },
        { status: 400 },
      );
    }

    // Prompt requirement is document-type specific. Optional types (Visa SOP,
    // cover letter, LOR, ...) fall through to the existing default-template
    // path — no new resolution chain is invented here.
    const { isPromptRequired } = await import("@/lib/application/document-prompt-ui");
    if (!body.promptText) {
      if (isPromptRequired(body.documentType)) {
        return NextResponse.json(
          { error: "promptText is required for this document type" },
          { status: 400 },
        );
      }
      body.promptText = getDefaultTemplate(body.documentType).promptText;
      body.promptSource = "DVIVID_DEFAULT_TEMPLATE";
    }

    const promptSource = body.promptSource || "CONSULTANT_PROVIDED";
    if (!isValidPromptSource(promptSource)) {
      return NextResponse.json(
        { error: `Invalid prompt source: ${promptSource}` },
        { status: 400 },
      );
    }

    // Server-resolved prompt sources (OFFICIAL_VERIFIED, DVIVID_DEFAULT_TEMPLATE)
    // are produced by the resolve-prompt flow. They must go through
    // createOfficialDocument with verification, not the user-settable
    // createDocument path which rejects them.
    let effectivePromptSource = promptSource;
    let useOfficialCreate = false;

    if (promptSource === "OFFICIAL_VERIFIED") {
      if (!body.writingRequirementId) {
        return NextResponse.json(
          { error: "OFFICIAL_VERIFIED prompt source requires a verified writing requirement. Use Auto-Resolve or select an official requirement.", code: "MISSING_WRITING_REQUIREMENT" },
          { status: 400 },
        );
      }
      // Verify the writing requirement exists and matches the document type
      const { getWritingRequirement } = await import("@/lib/application/requirements-repository");
      const wr = await getWritingRequirement(body.writingRequirementId);
      if (!wr) {
        return NextResponse.json(
          { error: "The selected official requirement was not found.", code: "WRITING_REQUIREMENT_NOT_FOUND" },
          { status: 400 },
        );
      }
      if (wr.documentType !== body.documentType) {
        return NextResponse.json(
          { error: "The selected official requirement does not match this document type.", code: "WRITING_REQUIREMENT_TYPE_MISMATCH" },
          { status: 400 },
        );
      }
      useOfficialCreate = true;
    }

    if (promptSource === "DVIVID_DEFAULT_TEMPLATE") {
      // Verify the prompt actually is the server's default template for this
      // document type. If the consultant edited the template text, the source
      // is effectively consultant-provided — store it that way instead.
      const template = getDefaultTemplate(body.documentType);
      if (body.promptText.trim() === template.promptText.trim()) {
        useOfficialCreate = true;
      } else {
        effectivePromptSource = "CONSULTANT_PROVIDED";
      }
    }

    const docInput: CreateDocumentInput = {
      applicationId: body.applicationId,
      documentType: body.documentType,
      documentTitle: body.documentTitle || body.documentType,
      promptText: body.promptText,
      promptSource: effectivePromptSource,
      wordMin: body.wordMin,
      wordMax: body.wordMax,
      characterLimit: body.characterLimit,
      pageLimit: body.pageLimit,
      specialInstructions: body.specialInstructions,
      facultyInstructions: body.facultyInstructions,
      formattingInstructions: body.formattingInstructions,
    };

    const document = useOfficialCreate
      ? await createOfficialDocument(docInput)
      : await createDocument(docInput);

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
