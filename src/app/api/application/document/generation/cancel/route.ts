// ============================================================
// POST /api/application/document/generation/cancel
// ============================================================
// Authoritative backend cancellation.
//
// 1. Finds the document's active generation run.
// 2. Atomically sets CANCEL_REQUESTED (CAS — only from active states).
// 3. The pipeline checks cancellation before/after every stage, so no
//    new stage can begin; an in-flight model call is aborted via signal.
// 4. If the run's heartbeat is already stale (process gone), the run
//    is finalized as CANCELLED immediately and the doc lock released.
// 5. Terminal runs return 409 — a completed document is never reverted.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { getDbPool } from "@/lib/application/db";
import {
  requestCancelGeneration,
  cancelRun,
  isHeartbeatStale,
} from "@/lib/application/generation-lifecycle";
import { updateDocumentStatus } from "@/lib/application/application-repository";

export async function POST(req: NextRequest) {
  try {
    let consultant;
    try {
      consultant = await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json();
    const { studentId, applicationId, documentId } = body || {};
    if (!studentId || !applicationId || !documentId) {
      return NextResponse.json(
        { error: "studentId, applicationId, and documentId are required" },
        { status: 400 },
      );
    }
    await authorizeStudentAccess(consultant, studentId);

    const cancel = await requestCancelGeneration(documentId);

    if (cancel.result === "NOT_FOUND") {
      // No run row — possibly a generation started before run tracking,
      // or a stale GENERATING flag. If the doc lock is stale, release it.
      const pool = getDbPool();
      const [rows] = await pool.execute(
        `SELECT generation_status, generation_started_at FROM application_documents WHERE id = ?`,
        [documentId],
      );
      const doc = (rows as any[])[0];
      if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      if (doc.generation_status === "GENERATING") {
        const stale = !doc.generation_started_at ||
          Date.now() - new Date(doc.generation_started_at).getTime() > 10 * 60 * 1000;
        if (stale) {
          await updateDocumentStatus(documentId, undefined, "NOT_STARTED");
          return NextResponse.json({ status: "CANCELLED", message: "Stale generation cleared." });
        }
        return NextResponse.json(
          { status: "RUNNING", message: "Generation is running but its status record is unavailable. Try again shortly." },
          { status: 202 },
        );
      }
      return NextResponse.json({ error: "GENERATION_NOT_RUNNING" }, { status: 409 });
    }

    if (cancel.result === "ALREADY_TERMINAL") {
      return NextResponse.json(
        { error: "GENERATION_ALREADY_COMPLETED", status: cancel.run?.status },
        { status: 409 },
      );
    }

    // CANCELLED already (idempotent retry) or CANCEL_REQUESTED.
    if (cancel.result === "CANCELLED") {
      return NextResponse.json({ status: "CANCELLED" });
    }

    // Cancel the in-flight provider response if one exists — applies
    // to background responses (queued/in_progress are cancellable).
    // Best-effort: the pipeline's poll loop also observes
    // CANCEL_REQUESTED and cancels/finalizes from its side.
    if (cancel.run?.providerResponseId) {
      try {
        const { getStageTransport } = await import("@/lib/ai/openai-transport");
        await getStageTransport().cancelBackgroundStage(cancel.run.providerResponseId);
      } catch { /* provider cancel is best-effort */ }
    }

    // Heartbeat already stale → the process is gone; finalize now.
    if (cancel.run && isHeartbeatStale(cancel.run)) {
      await cancelRun(cancel.run.id);
      await updateDocumentStatus(documentId, undefined, "NOT_STARTED");
      return NextResponse.json({ status: "CANCELLED", message: "Generation was interrupted and has been cancelled." });
    }

    return NextResponse.json({ status: "CANCEL_REQUESTED" });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("generation cancel error:", error);
    return NextResponse.json({ error: "Failed to cancel generation" }, { status: 500 });
  }
}
