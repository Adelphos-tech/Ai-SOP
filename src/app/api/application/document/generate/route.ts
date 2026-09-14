// ============================================================
// POST /api/application/document/generate
// Phase SOP-AI-33 / Phase SOP-INFRA-37
// ============================================================
// Canonical document generation endpoint.
// Input: { studentId, applicationId, documentId }
//
// This route is a thin transport adapter. All generation logic
// lives in the shared server-only function:
//   generateApplicationDocument()
//
// No HTTP self-fetch to another route in the same process.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { generateApplicationDocument, releaseGenerationLock } from "@/lib/application/generation-service";
import { randomUUID } from "crypto";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 300;

/**
 * Sanitize error messages to prevent leaking internal infrastructure details
 * (IP addresses, ports, file paths, stack traces) to clients.
 */
function sanitizeErrorMessage(msg: string | undefined): string {
  if (!msg) return "An unexpected error occurred during generation.";
  // Strip common internal patterns
  return msg
    .replace(/127\.0\.0\.1:\d+/g, "[internal]")
    .replace(/localhost:\d+/g, "[internal]")
    .replace(/\/opt\/[^\s'"]+/g, "[path]")
    .replace(/\/home\/[^\s'"]+/g, "[path]")
    .replace(/ERR_SSL_\w+/g, "[ssl-error]")
    .substring(0, 500); // prevent overly long error messages
}

export async function POST(req: NextRequest) {
  let documentId: string | undefined;
  try {
    // ===== AUTH =====
    let consultant;
    try {
      consultant = await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json();
    documentId = body.documentId;

    if (!body.studentId || !body.applicationId || !body.documentId) {
      return NextResponse.json(
        { error: "studentId, applicationId, and documentId are required" },
        { status: 400 },
      );
    }

    // Authorize student access
    await authorizeStudentAccess(consultant, body.studentId);

    const requestId = (req.headers.get("x-request-id") || randomUUID()) as string;

    const result = await generateApplicationDocument({
      studentId: body.studentId,
      applicationId: body.applicationId,
      documentId: body.documentId,
      requestId,
    });

    return NextResponse.json(result.body, { status: result.status });

  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Document generation error:", error);
    if (documentId) {
      await releaseGenerationLock(documentId);
    }
    // Sanitize error — do not expose internal paths, ports, or stack traces
    const safeMessage = sanitizeErrorMessage(error?.message);
    return NextResponse.json(
      { error: safeMessage },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Document generation endpoint. POST with { studentId, applicationId, documentId } to generate.",
  });
}
