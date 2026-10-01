// ============================================================
// DOCLING SERVICE CLIENT
// ============================================================
// Internal-only HTTP call to the cv-parser sidecar service.
// Never exposed publicly — cv-upload route stays the public entry.
// ============================================================

import { ParsedDocumentSchema, type ParsedDocument } from "./resume-candidate.schema";

const SERVICE_URL = process.env.CV_PARSER_SERVICE_URL || "http://127.0.0.1:8099";
const TIMEOUT_MS = Number(process.env.CV_PARSER_TIMEOUT_MS || 120000);

export class DoclingServiceError extends Error {
  code: string;
  constructor(message: string, code = "DOCLING_SERVICE_ERROR") {
    super(message);
    this.code = code;
  }
}

export async function doclingHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a CV file buffer to the Docling service.
 * Returns the structured ParsedDocument (blocks/pages), NOT a profile.
 */
export async function parseWithDocling(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);

  let res: Response;
  try {
    res = await fetch(`${SERVICE_URL}/parse`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new DoclingServiceError(
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "Parser service timed out."
        : "Parser service is unavailable.",
      e?.name === "TimeoutError" || e?.name === "AbortError" ? "DOCLING_TIMEOUT" : "DOCLING_UNREACHABLE",
    );
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new DoclingServiceError(
      data?.detail || `Parser service error (${res.status})`,
      res.status === 400 ? "DOCLING_UNREADABLE" : "DOCLING_SERVICE_ERROR",
    );
  }

  const json = await res.json();
  const parsed = ParsedDocumentSchema.safeParse(json);
  if (!parsed.success) {
    throw new DoclingServiceError("Parser service returned an unexpected response.", "DOCLING_BAD_RESPONSE");
  }
  return parsed.data;
}

/**
 * Free local OCR fallback — RapidOCR via the same internal sidecar.
 * ONLY for image-only/scanned files where the normal chain produced
 * no usable text; the Node orchestrator decides when to call this.
 */
export async function ocrWithService(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);

  let res: Response;
  try {
    res = await fetch(`${SERVICE_URL}/ocr`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new DoclingServiceError(
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "OCR service timed out."
        : "OCR service is unavailable.",
      e?.name === "TimeoutError" || e?.name === "AbortError" ? "OCR_TIMEOUT" : "OCR_UNREACHABLE",
    );
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail: string = data?.detail || `OCR service error (${res.status})`;
    throw new DoclingServiceError(
      detail,
      detail.includes("OCR_NO_IMAGE_CONTENT") ? "OCR_NO_IMAGE_CONTENT"
        : res.status === 413 ? "OCR_LIMIT_EXCEEDED"
        : res.status === 400 ? "OCR_UNREADABLE"
        : "OCR_SERVICE_ERROR",
    );
  }

  const json = await res.json();
  const parsed = ParsedDocumentSchema.safeParse(json);
  if (!parsed.success) {
    throw new DoclingServiceError("OCR service returned an unexpected response.", "OCR_BAD_RESPONSE");
  }
  return parsed.data;
}

export interface PdfImageInspection {
  pages: number;
  imageCount: number;
  /** Images rendered large enough to plausibly carry document content. */
  contentImageCount: number;
  contentImagePixels: number;
}

/**
 * Structural PDF image inspection — no OCR. Used by the orchestrator to
 * detect image-dominant PDFs (thin text layer + page-sized CV images)
 * that would otherwise silently lose the image-borne content.
 */
export async function inspectPdfWithService(buffer: Buffer, filename: string): Promise<PdfImageInspection> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);

  let res: Response;
  try {
    res = await fetch(`${SERVICE_URL}/inspect`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    throw new DoclingServiceError(
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "Inspect service timed out."
        : "Inspect service is unavailable.",
      e?.name === "TimeoutError" || e?.name === "AbortError" ? "INSPECT_TIMEOUT" : "INSPECT_UNREACHABLE",
    );
  }
  if (!res.ok) {
    throw new DoclingServiceError(`Inspect service error (${res.status})`, "INSPECT_FAILED");
  }
  const json = await res.json();
  return {
    pages: Number(json?.pages) || 0,
    imageCount: Number(json?.imageCount) || 0,
    contentImageCount: Number(json?.contentImageCount) || 0,
    contentImagePixels: Number(json?.contentImagePixels) || 0,
  };
}
