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
  getConsultantSession,
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
import { runDetection, RYNE_MAX_CHARS } from "@/lib/writing-review/detection";
import { runRewrite } from "@/lib/writing-review/rewrite";
import { runDocumentHumanize } from "@/lib/writing-review/document-humanizer";
import { isFixableFinding } from "@/lib/writing-review/fix-batch";

async function loadReviewContext(request: NextRequest) {
  // Brick 4A: real session auth — requireConsultantSession() is a
  // documented dummy bypass and must NOT gate document content or
  // paid provider calls. Fail closed: no valid session → 401.
  const session = await getConsultantSession(request);
  if (!session) {
    throw new AuthError(401, "UNAUTHENTICATED", "Authentication required. Please log in.");
  }
  const consultant = session.consultant;
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
  return { consultant, document, versions, current };
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
          .filter(d => d.integration === "RYNE_AI_SCORE" && d.configured && !d.disabledReason)
          .map(d => d.detector),
        maxDetectorsPerRun: Number(process.env.RYNE_MAX_DETECTORS_PER_RUN ?? 3),
        // Per-detector billing is unverified — the UI gets the approved
        // reservation ceiling to display honestly, never an invented price.
        pricingUnverified: true,
        reservationCeilingUsd: (() => {
          const n = Number(process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        configured: listDetectorDescriptors().some(d => d.configured),
        rewritePricing: { balancedPer1k: 0.08, titanPer1k: 0.50 },
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
    const { consultant, current } = ctx as any;
    if (!current) {
      return NextResponse.json({ error: "Document has no generated version to review." }, { status: 400 });
    }
    // Brick 4B-C1/C2: a stable operationId is required for paid
    // actions so retries of one user action cannot double-bill across
    // processes; a new deliberate action sends a fresh id.
    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (body.action === "humanize-document") {
      // Full-document humanization of the AUTHORIZED saved version —
      // the client names the version it is looking at; the text itself
      // is always read server-side. Nothing is written to the document.
      if (body.baseVersionId !== current.id) {
        return NextResponse.json(
          { error: "The document was saved since this page loaded. Reload to humanize the latest version." },
          { status: 409 });
      }
      if (!UUID_RE.test(operationId)) {
        return NextResponse.json({ error: "A valid operationId (UUID) is required." }, { status: 400 });
      }
      const out = await runDocumentHumanize({
        content: current.content,
        versionId: current.id,
        mode: body.mode === "titan" ? "titan" : "balanced",
        confirmPaid: body.confirmPaid === true,
        operationId,
        actorId: consultant.id,
        ids: {
          studentId: url.searchParams.get("studentId") ?? undefined,
          applicationId: url.searchParams.get("applicationId") ?? undefined,
          documentId: url.searchParams.get("documentId") ?? undefined,
        },
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
    }
    if (body.action === "rewrite") {
      // Brick 3: rewrite ONLY the selected passage, and only after
      // verifying the text exists in the authorized current version —
      // the client cannot make us send arbitrary text.
      const passageText = String(body.passageText ?? "");
      if (!passageText || !current.content.includes(passageText)) {
        return NextResponse.json(
          { error: "Selected text was not found in the current document version. Reload the review and try again." },
          { status: 409 });
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
        return NextResponse.json(
          { error: "A valid operationId (UUID) is required for a rewrite." }, { status: 400 });
      }
      // Headings are structure, not prose — refused before any paid call.
      if (!isFixableFinding({ text: passageText })) {
        return NextResponse.json(
          { error: "Headings are kept exactly as written and cannot be rewritten." }, { status: 400 });
      }
      const mode = body.mode === "titan" ? "titan" : "balanced";
      const out = await runRewrite({
        text: passageText,
        mode,
        confirmPaid: body.confirmPaid === true,
        operationId,
        actorId: consultant.id,
        ids: {
          studentId: url.searchParams.get("studentId") ?? undefined,
          applicationId: url.searchParams.get("applicationId") ?? undefined,
          documentId: url.searchParams.get("documentId") ?? undefined,
          versionId: current.id,
        },
        signal: request.signal,
      });
      switch (out.kind) {
        case "OK":
          return NextResponse.json({ suggestion: out.suggestion });
        case "NOT_CONFIGURED":
        case "CONSENT_REQUIRED":
          return NextResponse.json({ error: out.notice }, { status: 400 });
        case "OVER_BUDGET":
          return NextResponse.json({ error: out.notice }, { status: 402 });
        case "TOO_LONG":
          return NextResponse.json({ error: out.notice }, { status: 413 });
        case "DUPLICATE":
          return NextResponse.json({ error: out.notice }, { status: 409 });
        case "CANCELLED":
          return NextResponse.json({ error: "Rewrite cancelled." }, { status: 499 });
        case "ERROR":
          return NextResponse.json({ error: out.message }, { status: 502 });
      }
    }
    if (body.action !== "recheck") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
      return NextResponse.json(
        { error: "A valid operationId (UUID) is required for a detection run." }, { status: 400 });
    }
    // Optional text override: the Check-AI badge on the unsaved
    // humanized draft sends the exact draft text; the saved version's
    // own text is still read server-side and never trusted from the
    // client. The result's contentHash identifies which text scored.
    const suppliedText = typeof body.text === "string" ? body.text : null;
    if (suppliedText !== null && (!suppliedText.trim() || suppliedText.length > RYNE_MAX_CHARS)) {
      return NextResponse.json(
        { error: `text must be 1–${RYNE_MAX_CHARS.toLocaleString()} characters when supplied.` }, { status: 400 });
    }
    // Brick 2/4B-C1: server-side Ryne calls — consent + persistent
    // budget ledger + timeout + cooldown + per-detector isolation
    // enforced inside runDetection.
    const docId = url.searchParams.get("documentId")!;
    const outcome = await runDetection(docId, {
      detectors: Array.isArray(body.detectors) ? body.detectors : [],
      confirmPaid: body.confirmPaid === true,
      baseVersionId: current.id,
      content: suppliedText ?? current.content,
      operationId,
      actorId: consultant.id,
      ids: {
        studentId: url.searchParams.get("studentId") ?? undefined,
        applicationId: url.searchParams.get("applicationId") ?? undefined,
        versionId: current.id,
      },
      signal: request.signal,
    });
    if (outcome.kind === "OK" && process.env.WRITING_REVIEW_DEBUG === "1") {
      // Safe diagnostics: lengths/hashes/ids/scores only — never text or keys.
      console.log("[writing-review:recheck]", JSON.stringify({
        op: operationId, doc: docId,
        textOverride: suppliedText !== null,
        contentLength: (suppliedText ?? current.content).length,
        savedHash: computeContentHash(current.content),
        checkedHash: outcome.detection.contentHash,
        baseVersionId: outcome.detection.baseVersionId,
        checkedAt: outcome.detection.checkedAt,
        scores: outcome.detection.scores.map(s => ({ d: s.detector, st: s.status, pct: s.scorePercent, src: s.source })),
      }));
    }
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
      case "DUPLICATE":
        return NextResponse.json({ error: outcome.notice }, { status: 409 });
      case "CANCELLED":
        return NextResponse.json({ error: "Check cancelled." }, { status: 499 });
    }
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
