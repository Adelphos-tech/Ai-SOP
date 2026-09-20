// ============================================================
// POST /api/application/cv-upload
// ============================================================
// Accepts a CV file (PDF/DOCX/TXT), saves it to private storage,
// parses it using rule-based extraction, and returns structured data.
//
// Security:
//   - Requires authenticated consultant session
//   - Authorizes student access
//   - Early size rejection (Content-Length before reading body)
//   - Rate limiting (per IP, in-memory)
//   - File type validation (extension + magic bytes + DOCX ZIP inspection)
//   - ZIP bomb protection
//   - SHA-256 dedup (same file = same storage, no duplicate)
//   - Private storage outside deployment tree
//   - Profile revision returned for optimistic concurrency on apply
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { parseCVFile, CVParseFailure, ParsedCV } from "@/lib/application/cv-parser";
import { parseWithDocling, DoclingServiceError } from "@/lib/application/docling-client";
import { mapDoclingToParsedCV, CV_MAPPER_VERSION } from "@/lib/application/cv-mapper-docling";
import { getStudent } from "@/lib/application/application-repository";
import { getStudentProfileRevision } from "@/lib/application/application-repository";
import { validateDocx } from "@/lib/application/docx-validator";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limiter";
import { cvParseLimiter, ResourceBusyError } from "@/lib/concurrency/resource-limiter";

export const maxDuration = 60;

// Private storage OUTSIDE the deployment tree
const CV_STORAGE = process.env.SOP_CV_STORAGE || "/opt/sop-ai-data/cv";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [".pdf", ".docx", ".txt"];

// Rate limit: 30 uploads per 15 min per IP
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

// Build ID for structured logging
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "unknown";

/**
 * Structured log for CV parse failures — searchable, no CV text leaked.
 */
function logCVParseFailure(args: {
  event: string;
  reason: string;
  studentId: string;
  mimeType: string;
  fileSize: number;
  buildId: string;
}): void {
  console.log(JSON.stringify({
    event: args.event,
    reason: args.reason,
    studentId: args.studentId,
    mimeType: args.mimeType,
    fileSize: args.fileSize,
    buildId: args.buildId,
  }));
}

export async function POST(request: NextRequest) {
  try {
    // ===== AUTH =====
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    // ===== EARLY SIZE REJECTION =====
    // Check Content-Length before reading the body
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_FILE_SIZE + 1024) {
      // Allow 1KB overhead for multipart form boundaries
      return NextResponse.json(
        { error: "File too large. Maximum size: 10 MB.", code: "FILE_TOO_LARGE" },
        { status: 413 },
      );
    }

    // ===== RATE LIMIT =====
    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`cv-upload:${clientIp}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    // ===== PARSE FORM DATA =====
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const studentId = formData.get("studentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    // ===== AUTHORIZATION =====
    await authorizeStudentAccess(consultant, studentId);

    // Validate student exists
    const student = await getStudent(studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // ===== FILE TYPE VALIDATION =====
    const filename = file.name.toLowerCase();
    const ext = "." + filename.split(".").pop();
    if (!ALLOWED_TYPES.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext}. Supported: PDF, DOCX, TXT.` },
        { status: 400 },
      );
    }

    // ===== FILE SIZE VALIDATION (actual) =====
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size: 10 MB." },
        { status: 400 },
      );
    }

    // ===== READ BUFFER + MAGIC BYTES =====
    const buffer = Buffer.from(await file.arrayBuffer());

    if (ext === ".pdf" && buffer.length >= 4) {
      if (!buffer.subarray(0, 4).toString("ascii").startsWith("%PDF")) {
        return NextResponse.json(
          { error: "File appears to not be a valid PDF." },
          { status: 400 },
        );
      }
    } else if (ext === ".docx") {
      // Full DOCX validation: ZIP structure + required entries + zip bomb protection
      const docxResult = validateDocx(buffer);
      if (!docxResult.valid) {
        return NextResponse.json(
          { error: docxResult.error || "Invalid DOCX file." },
          { status: 400 },
        );
      }
    }

    // ===== SHA-256 DEDUP =====
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const studentDir = join(CV_STORAGE, studentId);
    const hashFilePath = join(studentDir, `${fileHash}.bin`);
    const metaFilePath = join(studentDir, `${fileHash}.meta.json`);

    // Check if this exact file already exists for this student
    let existingMeta: any = null;
    try {
      const metaContent = await readFile(metaFilePath, "utf-8");
      existingMeta = JSON.parse(metaContent);
    } catch {
      // Not found — new upload
    }

    // ===== PARSE ENGINE (declared early — dedup reuse depends on it) =====
    // CV_PARSER_ENGINE=legacy (default) | docling
    // Optional fallback: CV_PARSER_FALLBACK=legacy retries via the
    // legacy parser when the docling service fails.
    const parserEngine = process.env.CV_PARSER_ENGINE === "docling" ? "docling" : "legacy";
    const fallbackToLegacy = process.env.CV_PARSER_FALLBACK === "legacy";

    if (existingMeta) {
      // Idempotent reuse ONLY when the stored parse came from the same
      // engine AND mapper version — a pre-fix cached result must never
      // replay a broken parse for the same file hash.
      const metaEngine = existingMeta.parsed?.parserMeta?.engine || "legacy";
      const metaMapperV = existingMeta.parsed?.parserMeta?.mapperVersion || "";
      const currentMapperV = parserEngine === "docling" ? CV_MAPPER_VERSION : "";
      if (metaEngine === parserEngine && metaMapperV === currentMapperV) {
        const revision = await getStudentProfileRevision(studentId);
        return NextResponse.json({
          success: true,
          filename: existingMeta.filename,
          savedFilename: existingMeta.savedFilename,
          fileHash,
          uploadedAt: existingMeta.uploadedAt,
          reused: true,
          parsed: existingMeta.parsed,
          profileRevision: revision,
        });
      }
      // Parser changed → fall through to re-parse and overwrite meta.
      logCVParseFailure({
        event: "cv_parse_stale_meta_reparse",
        reason: `${metaEngine}@${metaMapperV || "0"} → ${parserEngine}@${currentMapperV || "0"}`,
        studentId, mimeType: file.type || ext, fileSize: buffer.length, buildId: BUILD_ID,
      });
    }

    // ===== SAVE FILE =====
    await mkdir(studentDir, { recursive: true });

    // Sanitize filename
    const sanitized = file.name
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .replace(/\.{2,}/g, "_");
    const savedFilename = `cv-${Date.now()}-${sanitized}`;

    await writeFile(hashFilePath, buffer);

    let parsed: ParsedCV;
    try {
      const release = await cvParseLimiter.acquire();
      try {
        if (parserEngine === "docling") {
          try {
            const doc = await parseWithDocling(buffer, file.name);
            parsed = mapDoclingToParsedCV(doc);
          } catch (docErr: any) {
            if (!fallbackToLegacy) throw docErr;
            logCVParseFailure({
              event: "cv_parse_docling_fallback",
              reason: docErr?.code || "DOCLING_SERVICE_ERROR",
              studentId, mimeType: file.type || ext, fileSize: buffer.length, buildId: BUILD_ID,
            });
            parsed = await parseCVFile(buffer, file.name);
          }
        } else {
          parsed = await parseCVFile(buffer, file.name);
        }
      } finally {
        release();
      }
    } catch (parseError: any) {
      // Concurrency rejection
      if (parseError instanceof ResourceBusyError) {
        return NextResponse.json(
          { error: parseError.message, code: "CV_PARSE_BUSY" },
          { status: 503 },
        );
      }
      // Deterministic failure classification — return controlled 400
      const code = parseError?.code || "PARSE_FAILED";
      const userMessage = parseError?.userMessage || "We could not process this file. Please try a different PDF or DOCX, or enter the details manually.";
      const mimeType = file.type || ext;
      logCVParseFailure({
        event: "cv_parse_failure",
        reason: code,
        studentId,
        mimeType,
        fileSize: buffer.length,
        buildId: BUILD_ID,
      });
      return NextResponse.json(
        { error: userMessage, code },
        { status: 400 },
      );
    }

    // ===== SAVE METADATA (for dedup) =====
    const meta = {
      filename: file.name,
      savedFilename,
      fileHash,
      uploadedAt: new Date().toISOString(),
      uploadedBy: consultant.id,
      parsed,
    };
    await writeFile(metaFilePath, JSON.stringify(meta));

    // ===== RETURN WITH PROFILE REVISION =====
    const revision = await getStudentProfileRevision(studentId);

    return NextResponse.json({
      success: true,
      filename: file.name,
      savedFilename,
      fileHash,
      uploadedAt: meta.uploadedAt,
      reused: false,
      parsed,
      profileRevision: revision,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    // Structured log for unexpected errors — no stack traces or CV content
    const code = error?.code || "PARSE_FAILED";
    logCVParseFailure({
      event: "cv_upload_error",
      reason: code,
      studentId: "unknown",
      mimeType: "unknown",
      fileSize: 0,
      buildId: BUILD_ID,
    });
    // Never expose parser stack traces to the client
    const safeMessage = error?.userMessage || "Failed to process CV. Please try a different file.";
    return NextResponse.json({ error: safeMessage, code }, { status: 400 });
  }
}
