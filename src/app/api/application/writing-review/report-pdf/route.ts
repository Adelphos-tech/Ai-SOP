// ============================================================
// POST /api/application/writing-review/report-pdf
// Downloadable PDF of a detection run. The run payload comes from
// the client (runs are browser-local); all document text, student,
// application and version data is re-fetched server-side and
// findings are re-derived — highlights can't be forged.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import {
  getStudent,
  getApplication,
  getDocument,
  getDocumentVersion,
  validateDocumentOwnership,
  validateVersionOwnership,
} from "@/lib/application/application-repository";
import { generateDetectionReportPdf } from "@/lib/writing-review/report-pdf";
import { listDetectorDescriptors } from "@/lib/writing-review/detectors";
import { exportLimiter } from "@/lib/concurrency/resource-limiter";
import { ResourceBusyError } from "@/lib/concurrency/resource-limiter";
import { computeContentHash } from "@/lib/writing-review/detectors";

const KNOWN_DETECTORS = new Set(listDetectorDescriptors().map(d => d.detector));
const MAX_PASSAGES = 500;
const MAX_SCORES = 8;

function validRun(run: any): boolean {
  if (!run || typeof run !== "object" || run.id === "demo") return false;
  if (typeof run.versionId !== "string" || !run.versionId) return false;
  if (typeof run.contentHash !== "string" || run.contentHash.length > 64) return false;
  if (typeof run.checkedAt !== "string" || run.checkedAt.length > 40) return false;
  if (!Array.isArray(run.detectors) || !run.detectors.every((d: any) => KNOWN_DETECTORS.has(d))) return false;
  const det = run.detection;
  if (!det || !Array.isArray(det.scores) || det.scores.length > MAX_SCORES) return false;
  if (!Array.isArray(det.passages) || det.passages.length > MAX_PASSAGES) return false;
  for (const s of det.scores) {
    if (s == null || typeof s !== "object" || !KNOWN_DETECTORS.has(s.detector)) return false;
    if (s.scorePercent != null && (typeof s.scorePercent !== "number" || !Number.isFinite(s.scorePercent) || s.scorePercent < 0 || s.scorePercent > 100)) return false;
  }
  for (const p of det.passages) {
    if (p == null || !Number.isInteger(p.start) || !Number.isInteger(p.end) ||
        p.start < 0 || p.end < p.start || p.end > 2_000_000) return false;
    if (!KNOWN_DETECTORS.has(p.detector)) return false;
  }
  return true;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
}

export async function POST(request: NextRequest) {
  try {
    let consultant;
    try { consultant = await requireConsultantSession(request); }
    catch (e) { if (e instanceof AuthError) return authErrorResponse(e); throw e; }

    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    const studentId = body.studentId ?? url.searchParams.get("studentId");
    const applicationId = body.applicationId ?? url.searchParams.get("applicationId");
    const documentId = body.documentId ?? url.searchParams.get("documentId");
    if (!studentId || !applicationId || !documentId) {
      return NextResponse.json({ error: "studentId, applicationId and documentId are required" }, { status: 400 });
    }
    if (!validRun(body.run)) {
      return NextResponse.json({ error: "Invalid report payload." }, { status: 400 });
    }

    await authorizeStudentAccess(consultant, studentId);
    await validateDocumentOwnership(documentId, applicationId, studentId);
    try { await validateVersionOwnership(body.run.versionId, documentId); }
    catch { return NextResponse.json({ error: "Report does not belong to this document." }, { status: 403 }); }

    const [student, application, doc, checkedVersion] = await Promise.all([
      getStudent(studentId), getApplication(applicationId), getDocument(documentId),
      getDocumentVersion(body.run.versionId),
    ]);
    if (!student || !application || !doc || !checkedVersion) {
      return NextResponse.json({ error: "Referenced record not found." }, { status: 404 });
    }
    const currentVersion = doc.currentVersionId ? await getDocumentVersion(doc.currentVersionId) : null;
    const content = checkedVersion.content;
    const contentHash = computeContentHash(content);
    const outdated = body.run.versionId !== doc.currentVersionId || body.run.contentHash !== contentHash;

    // Findings re-derived inside the generator on authoritative
    // The PDF is a clean percentage report — no flagged-sentence
    // data leaves the server, so no findings are derived at all.
    const scores = body.run.detection.scores.filter((s: any) => body.run.detectors.includes(s.detector));
    let timeZone: string | undefined;
    if (typeof body.timeZone === "string" && body.timeZone.length <= 64) {
      try { new Intl.DateTimeFormat("en-US", { timeZone: body.timeZone }); timeZone = body.timeZone; }
      catch { /* invalid zone — generator falls back to Asia/Kolkata */ }
    }

    const release = await exportLimiter.acquire();
    try {
      const { buffer } = await generateDetectionReportPdf({
        studentName: `${student.firstName} ${student.lastName}`.trim(),
        programLine: [application.degree, application.programName].filter(Boolean).join(" ") +
          (application.universityName ? ` — ${application.universityName}` : ""),
        documentTitle: doc.documentTitle || "Statement of Purpose",
        checkedVersionNumber: checkedVersion.versionNumber,
        currentVersionNumber: currentVersion?.versionNumber ?? checkedVersion.versionNumber,
        checkedAt: body.run.checkedAt,
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
        outdated,
        scores,
        content,
        timeZone,
      });
      const date = new Date(body.run.checkedAt);
      const stamp = Number.isNaN(+date) ? "report" : date.toISOString().slice(0, 10);
      const filename =
        `AI-Detection-Report_${sanitizeFilename(`${student.firstName} ${student.lastName}`)}_` +
        `${sanitizeFilename(doc.documentTitle || "Document")}_v${checkedVersion.versionNumber}_${stamp}.pdf`;
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buffer.length.toString(),
          "Cache-Control": "no-store",
        },
      });
    } finally {
      release();
    }
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    if (e instanceof ResourceBusyError) {
      return NextResponse.json({ error: "PDF service is busy — try again shortly." }, { status: 429 });
    }
    return NextResponse.json({ error: e?.message || "PDF generation failed." }, { status: 500 });
  }
}
