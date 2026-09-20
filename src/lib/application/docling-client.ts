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
