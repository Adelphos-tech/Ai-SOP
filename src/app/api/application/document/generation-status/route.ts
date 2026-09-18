// ============================================================
// GET /api/application/document/generation-status
// ============================================================
// Lightweight generation-status endpoint for live progress polling.
// Returns only the fields the UI needs — never prompts, evidence,
// model internals, or raw stage output.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

// Polling endpoint — must always return live status, never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { getDbPool } from "@/lib/application/db";
import {
  getLatestRun,
  isHeartbeatStale,
  ACTIVE_RUN_STATUSES,
} from "@/lib/application/generation-lifecycle";
import { maybeRecoverRun } from "@/lib/application/generation-recovery";

export async function GET(req: NextRequest) {
  try {
    let consultant;
    try {
      consultant = await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const documentId = req.nextUrl.searchParams.get("documentId");
    const studentId = req.nextUrl.searchParams.get("studentId");
    if (!documentId || !studentId) {
      return NextResponse.json({ error: "documentId and studentId are required" }, { status: 400 });
    }
    await authorizeStudentAccess(consultant, studentId);

    const pool = getDbPool();
    const [docRows] = await pool.execute(
      `SELECT generation_status, review_status FROM application_documents WHERE id = ?`,
      [documentId],
    );
    const doc = (docRows as any[])[0];
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const run = await getLatestRun(documentId);

    // No persisted run — derive a minimal status from the document row
    // (covers generations started before run persistence existed).
    if (!run) {
      const docStatus = doc.generation_status as string;
      return NextResponse.json({
        generationId: null,
        status:
          docStatus === "GENERATING" ? "RUNNING" :
          docStatus === "GENERATED" ? "COMPLETED" :
          docStatus === "FAILED" ? "FAILED" : "IDLE",
        currentStage: null,
        completedStages: 0,
        totalStages: 6,
        startedAt: null,
        currentStageStartedAt: null,
        lastHeartbeatAt: null,
        heartbeatStale: docStatus === "GENERATING",
        cancelRequestedAt: null,
        completedAt: null,
        failedAt: null,
        failureMessage: null,
        documentGenerationStatus: docStatus,
        reviewStatus: doc.review_status,
      });
    }

    // Restart recovery: an active run whose heartbeat is old and has no
    // live in-process execution is orphaned — resume its pipeline
    // (fire-and-forget; the response still reflects current DB state).
    if (ACTIVE_RUN_STATUSES.includes(run.status)) {
      maybeRecoverRun(run);
    }

    return NextResponse.json({
      generationId: run.id,
      status: run.status,
      currentStage: run.currentStage,
      completedStages: run.completedStages,
      totalStages: run.totalStages,
      startedAt: run.generationStartedAt,
      currentStageStartedAt: run.currentStageStartedAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
      heartbeatStale: isHeartbeatStale(run),
      cancelRequestedAt: run.cancelRequestedAt,
      completedAt: run.completedAt,
      failedAt: run.failedAt,
      cancelledAt: run.cancelledAt,
      failureMessage: run.status === "FAILED" ? run.failureMessage : null,
      documentGenerationStatus: doc.generation_status,
      reviewStatus: doc.review_status,
      active: ACTIVE_RUN_STATUSES.includes(run.status),
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("generation-status error:", error);
    return NextResponse.json({ error: "Failed to load generation status" }, { status: 500 });
  }
}
