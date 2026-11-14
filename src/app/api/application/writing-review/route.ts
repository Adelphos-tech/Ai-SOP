// ============================================================
// GET/POST /api/application/writing-review
// Brick 1: loads the document + its current version for the AI
// Writing Review workspace, and reports real detector/provider
// connectivity. Makes NO paid provider calls and returns no
// fabricated scores.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getDocument,
  listDocumentVersions,
  validateDocumentOwnership,
} from "@/lib/application/application-repository";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import {
  computeContentHash,
  listDetectorStatuses,
  ryneRewriteStatus,
  listDetectorDescriptors,
} from "@/lib/writing-review/detectors";
import { runDetection } from "@/lib/writing-review/detection";

async function loadReviewContext(request: NextRequest) {
  const consultant = await requireConsultantSession(request);
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId");
  const applicationId = searchParams.get("applicationId");
  const studentId = searchParams.get("studentId");
  if (!documentId || !applicationId || !studentId) {
    return { error: NextResponse.json(
      { error: "documentId, applicationId and studentId are required" }, { status: 400 }) };
  }
  await authorizeStudentAccess(consultant, studentId);
  try {
    await validateDocumentOwnership(documentId, applicationId, studentId);
  } catch (err: any) {
    return { error: NextResponse.json({ error: err?.message || "Access denied" }, { status: 403 }) };
  }
  const document = await getDocument(documentId);
  if (!document) {
    return { error: NextResponse.json({ error: "Document not found" }, { status: 404 }) };
  }
  const versions = await listDocumentVersions(documentId);
  const current = versions.find(v => v.id === document.currentVersionId)
    || versions[versions.length - 1]
    || null;
  return { document, versions, current };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await loadReviewContext(request);
    if ("error" in ctx && ctx.error) return ctx.error;
    const { document, versions, current } = ctx as any;

    return NextResponse.json({
      document,
      versions: versions.map((v: any) => ({
        id: v.id, versionNumber: v.versionNumber, createdByType: v.createdByType,
        createdAt: v.createdAt,
      })),
      currentVersion: current && {
        id: current.id,
        versionNumber: current.versionNumber,
        content: current.content,
        contentFormat: current.contentFormat,
        contentHash: computeContentHash(current.content),
        wordCount: current.content.trim().split(/\s+/).filter(Boolean).length,
        createdByType: current.createdByType,
        createdAt: current.createdAt,
      },
      detectors: listDetectorStatuses(),
      rewriteProvider: ryneRewriteStatus(),
      detectionConfig: {
        runnable: listDetectorDescriptors()
          .filter(d => d.integration === "RYNE_AI_SCORE" && d.configured)
          .map(d => d.detector),
        maxDetectorsPerRun: Number(process.env.RYNE_MAX_DETECTORS_PER_RUN ?? 3),
        estimatedPerDetectorUsd: Number(process.env.RYNE_COST_PER_DETECTOR_USD ?? 0.02),
        configured: listDetectorDescriptors().some(d => d.configured),
      },
      detection: null, // no check has run; no fabricated findings
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

/** POST {action: "recheck"} — Brick 1 has no connected provider, so a
 *  recheck honestly reports that no detector could run instead of
 *  inventing results. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    // allow params in body or query
    for (const k of ["documentId", "applicationId", "studentId"]) {
      if (!url.searchParams.get(k) && body[k]) url.searchParams.set(k, body[k]);
    }
    const fakeRequest = new NextRequest(url.toString(), { headers: request.headers });
    const ctx = await loadReviewContext(fakeRequest);
    if ("error" in ctx && ctx.error) return ctx.error;
    const { current } = ctx as any;
    if (!current) {
      return NextResponse.json({ error: "Document has no generated version to review." }, { status: 400 });
    }
    if (body.action !== "recheck") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    // Brick 2: server-side Ryne calls — consent + budget + timeout +
    // cooldown + per-detector isolation enforced inside runDetection.
    const docId = url.searchParams.get("documentId")!;
    const outcome = await runDetection(docId, {
      detectors: Array.isArray(body.detectors) ? body.detectors : [],
      confirmPaid: body.confirmPaid === true,
      baseVersionId: current.id,
      content: current.content,
      signal: request.signal,
    });
    switch (outcome.kind) {
      case "OK":
        return NextResponse.json({
          detection: outcome.detection,
          estimatedCostUsd: outcome.estimatedCostUsd,
        });
      case "NOT_CONFIGURED":
      case "CONSENT_REQUIRED":
        return NextResponse.json({
          detection: outcome.detection, notice: outcome.notice,
        });
      case "OVER_BUDGET":
        return NextResponse.json({ error: outcome.notice }, { status: 402 });
      case "TOO_LONG":
        return NextResponse.json({ error: outcome.notice }, { status: 413 });
      case "RATE_LIMITED":
        return NextResponse.json({ error: outcome.notice }, { status: 429 });
      case "CANCELLED":
        return NextResponse.json({ error: "Check cancelled." }, { status: 499 });
    }
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
