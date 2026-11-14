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
} from "@/lib/writing-review/detectors";

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
    const detectors = listDetectorStatuses();
    const runnable = detectors.filter(d => d.status !== "NOT_CONNECTED" && d.status !== "UNAVAILABLE");
    if (runnable.length === 0) {
      return NextResponse.json({
        detection: {
          baseVersionId: current.id,
          contentHash: computeContentHash(current.content),
          checkedAt: new Date().toISOString(),
          scores: detectors,
          passages: [],
        },
        notice: "No AI detector is connected yet, so nothing was checked. Connect Ryne (RYNE_API_KEY) to enable detection.",
      });
    }
    // Brick 2: run configured providers and map genuine responses.
    return NextResponse.json({ error: "Detection providers are not implemented yet." }, { status: 501 });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
