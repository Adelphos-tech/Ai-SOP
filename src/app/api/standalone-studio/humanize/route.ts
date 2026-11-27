// ============================================================
// POST /api/standalone-studio/humanize
// Full-document humanization of submitted text for the standalone
// module — the exact same runDocumentHumanize pipeline (section
// guard, retry ledger accounting, proofreader) as the document
// Studio, just without a document row. Auth + consent + limits
// are identical to the document route.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { runDocumentHumanize } from "@/lib/writing-review/document-humanizer";
import { normalizeRyneModel } from "@/lib/writing-review/ryne-models";
import { STANDALONE_VERSION_ID, UUID_RE, standaloneTextError } from "@/lib/writing-review/standalone";

export async function POST(request: NextRequest) {
  try {
    const consultant = await requireConsultantSession(request);
    const body = await request.json().catch(() => ({}));

    const textError = standaloneTextError(body.content);
    if (textError) return NextResponse.json({ error: textError }, { status: 400 });

    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    if (!UUID_RE.test(operationId)) {
      return NextResponse.json({ error: "A valid operationId (UUID) is required." }, { status: 400 });
    }

    const out = await runDocumentHumanize({
      content: body.content,
      versionId: STANDALONE_VERSION_ID,
      mode: normalizeRyneModel(body.mode),
      confirmPaid: body.confirmPaid === true,
      operationId,
      actorId: consultant.id,
      ids: { documentId: "standalone" },
      signal: request.signal,
    });
    switch (out.kind) {
      case "OK": return NextResponse.json({ result: out.result });
      case "NOT_CONFIGURED":
      case "CONSENT_REQUIRED": return NextResponse.json({ error: out.notice }, { status: 400 });
      case "OVER_BUDGET": return NextResponse.json({ error: out.notice }, { status: 402 });
      case "TOO_LONG": return NextResponse.json({ error: out.notice }, { status: 413 });
      case "DUPLICATE": return NextResponse.json({ error: out.notice }, { status: 409 });
      case "CANCELLED": return NextResponse.json({ error: "Humanization cancelled." }, { status: 499 });
      case "ERROR": return NextResponse.json({ error: out.message, retryable: out.retryable }, { status: 502 });
    }
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
