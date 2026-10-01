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
import { classifyGenerationError } from "@/lib/application/generation-errors";
import { randomUUID } from "crypto";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { ResourceBusyError } from "@/lib/concurrency/resource-limiter";

export const maxDuration = 300;

/**
 * Route boundary: the client receives a stable code + consultant-safe
 * copy only. Raw technical detail (provider bodies, SQL, stack traces,
 * Zod paths) stays in server logs.
 */

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
    if (error instanceof ResourceBusyError) {
      if (documentId) {
        await releaseGenerationLock(documentId);
      }
      return NextResponse.json(
        { error: error.message, code: "RENDER_BUSY" },
        { status: 503 },
      );
    }
    console.error("Document generation error:", error);
    if (documentId) {
      await releaseGenerationLock(documentId);
    }
    const normalized = classifyGenerationError(error?.message);
    return NextResponse.json(
      { error: normalized.userMessage, code: normalized.code },
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
