// ============================================================
// POST /api/standalone-studio/detect
// AI-detection run on submitted text for the standalone module —
// the same runDetection pipeline (detector validation, spend
// ledger, cooldown, per-detector isolation) as the document
// Studio. No document row; the check key is namespaced per
// consultant so cooldowns/dedup stay per-user.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { runDetection } from "@/lib/writing-review/detection";
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

    const outcome = await runDetection(`standalone:${consultant.id}`, {
      detectors: Array.isArray(body.detectors) ? body.detectors : [],
      confirmPaid: body.confirmPaid === true,
      baseVersionId: STANDALONE_VERSION_ID,
      content: body.content,
      operationId,
      actorId: consultant.id,
      ids: {},
      signal: request.signal,
    });
    switch (outcome.kind) {
      case "OK":
        return NextResponse.json({ detection: outcome.detection, estimatedCostUsd: outcome.estimatedCostUsd });
      case "NOT_CONFIGURED":
      case "CONSENT_REQUIRED":
        return NextResponse.json({ detection: outcome.detection, notice: outcome.notice });
      case "OVER_BUDGET":
        return NextResponse.json({ error: outcome.notice }, { status: 402 });
      case "TOO_LONG":
        return NextResponse.json({ error: outcome.notice }, { status: 413 });
      case "RATE_LIMITED":
        return NextResponse.json({ error: outcome.notice }, { status: 429 });
      case "DUPLICATE":
        return NextResponse.json({ error: outcome.notice }, { status: 409 });
      case "CANCELLED":
        return NextResponse.json({ error: "Check cancelled." }, { status: 499 });
    }
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
