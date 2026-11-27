// ============================================================
// POST /api/standalone-studio/report-pdf
// Downloadable PDF of a standalone detection run — reuses
// generateDetectionReportPdf. The run payload comes from the client
// (runs are browser-local); it is validated and bounded here, and
// the checked text is re-validated against the shared text limits.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { generateDetectionReportPdf } from "@/lib/writing-review/report-pdf";
import { listDetectorDescriptors } from "@/lib/writing-review/detectors";
import { STANDALONE_MAX_CHARS, standaloneTextError } from "@/lib/writing-review/standalone";
import { countWords } from "@/lib/writing-review/document-structure";

const KNOWN_DETECTORS = new Set(listDetectorDescriptors().map(d => d.detector));
const MAX_PASSAGES = 500;
const MAX_SCORES = 8;

function validScores(scores: any): boolean {
  if (!Array.isArray(scores) || scores.length > MAX_SCORES) return false;
  return scores.every((s: any) =>
    s && typeof s === "object" && KNOWN_DETECTORS.has(s.detector)
    && (s.scorePercent == null || (typeof s.scorePercent === "number" && s.scorePercent >= 0 && s.scorePercent <= 100)));
}

function validPassages(passages: any, contentLength: number): boolean {
  if (!Array.isArray(passages) || passages.length > MAX_PASSAGES) return false;
  return passages.every((p: any) =>
    p && Number.isInteger(p.start) && Number.isInteger(p.end)
    && p.start >= 0 && p.end >= p.start && p.end <= Math.max(contentLength, STANDALONE_MAX_CHARS)
    && KNOWN_DETECTORS.has(p.detector));
}

export async function POST(request: NextRequest) {
  try {
    await requireConsultantSession(request);
    const body = await request.json().catch(() => ({}));

    const textError = standaloneTextError(body.content);
    if (textError) return NextResponse.json({ error: textError }, { status: 400 });

    const det = body.detection;
    if (!det || !validScores(det.scores) || !validPassages(det.passages ?? [], body.content.length)) {
      return NextResponse.json({ error: "Invalid detection run payload" }, { status: 400 });
    }

    const { buffer } = await generateDetectionReportPdf({
      studentName: "Standalone Check",
      programLine: "Humanizer & AI Check — pasted text",
      documentTitle: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Standalone text",
      checkedVersionNumber: 1,
      currentVersionNumber: 1,
      checkedAt: typeof det.checkedAt === "string" ? det.checkedAt : new Date().toISOString(),
      wordCount: countWords(body.content),
      outdated: false,
      scores: det.scores,
      content: body.content,
      timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ai-detection-report.pdf"`,
      },
    });
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Report failed" }, { status: 500 });
  }
}
