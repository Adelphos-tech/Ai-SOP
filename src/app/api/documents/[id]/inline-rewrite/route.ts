// ============================================================
// POST /api/documents/[id]/inline-rewrite
// Rewrites a user-selected span via OpenAI (never Ryne).
// Same session + document access checks as the other document routes:
// consultant session → document → application → student authorization.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { getApplication, getDocument } from "@/lib/application/application-repository";
import { inlineRewrite, InlineRewriteInputError } from "@/lib/application/inline-rewrite";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // ===== AUTH =====
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const documentId = params.id;
    const doc = await getDocument(documentId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const app = await getApplication(doc.applicationId);
    if (!app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    try {
      await authorizeStudentAccess(consultant, app.studentId);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }

    const result = await inlineRewrite(body);
    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof InlineRewriteInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AuthError) return authErrorResponse(e);
    if (e?.message === "OPENAI_NOT_CONFIGURED") {
      return NextResponse.json({ error: "AI rewriting is not configured" }, { status: 503 });
    }
    console.error("[inline-rewrite] failed:", e?.message ?? e);
    return NextResponse.json({ error: "Rewrite failed — please try again" }, { status: 502 });
  }
}
