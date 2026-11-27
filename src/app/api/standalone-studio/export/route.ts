// ============================================================
// POST /api/standalone-studio/export
// Download the submitted/humanized text as .docx or .pdf for the
// standalone module — reuses the same DOCX generator as document
// export (whitespace already normalized there) and a minimal
// plain-text PDF. Auth-protected, length-validated.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { generateDocx } from "@/lib/application/document-export";
import { generateTextPdf } from "@/lib/writing-review/plain-export";
import { standaloneTextError } from "@/lib/writing-review/standalone";

export async function POST(request: NextRequest) {
  try {
    await requireConsultantSession(request);
    const body = await request.json().catch(() => ({}));

    const textError = standaloneTextError(body.content);
    if (textError) return NextResponse.json({ error: textError }, { status: 400 });

    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : "Humanizer & AI Check";

    if (body.format === "docx") {
      const buf = await generateDocx(body.content);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="humanized.docx"`,
        },
      });
    }
    if (body.format === "pdf") {
      const { buffer } = await generateTextPdf(title, body.content);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="humanized.pdf"`,
        },
      });
    }
    return NextResponse.json({ error: "format must be docx or pdf" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Export failed" }, { status: 500 });
  }
}
