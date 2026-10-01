// ============================================================
// AFFINDA TEST-ONLY CLIENT (BENCHMARK)
// ============================================================
// Isolated vendor client for the resume-parser benchmark.
// - API key from env only (AFFINDA_API_KEY). Never hardcoded.
// - No profile writes, no DB access, no production routing.
// - Raw vendor responses are returned to the caller and written
//   ONLY to test-output/affinda/raw/ (gitignored). Never logged.
//
// Required env:
//   AFFINDA_API_KEY          Bearer API key (app.affinda.com -> API Keys)
//   AFFINDA_WORKSPACE_ID     Workspace identifier
//   AFFINDA_DOCUMENT_TYPE_ID Resume Parser document type identifier
//                            (AFFINDA_COLLECTION_ID accepted as alias)
// Optional env:
//   AFFINDA_BASE_URL         default https://api.affinda.com
//                            (api.us1.affinda.com / api.eu1.affinda.com)
//   AFFINDA_TIMEOUT_MS       default 120000
//   AFFINDA_DELETE_AFTER_PARSE default "1" — delete doc on Affinda's
//                            side as soon as parsing finishes
// ============================================================

export type AffindaFailureCode =
  | "PARSER_REJECTED"       // vendor rejected the document (400/422)
  | "NOT_A_RESUME"          // parsed but isResumeProbability ~ 0
  | "LOW_EXTRACTION_QUALITY" // parsed but quality metadata is low
  | "EMPTY_STRUCTURED_RESULT" // 200 but no usable structured fields
  | "VENDOR_TIMEOUT"
  | "VENDOR_UNAVAILABLE"    // network/5xx
  | "VENDOR_UNAUTHENTICATED" // 401/403
  | "VENDOR_ERROR";

export interface AffindaCallMeta {
  httpStatus: number;
  durationMs: number;
  identifier?: string;
  /** extraction-quality metadata from vendor response */
  extractionQuality?: string;
  isResumeProbability?: number;
  parserVersion?: string;
  schemaVersion?: string;
  pageCount?: number;
  fileName?: string;
}

export interface AffindaCallResult {
  ok: boolean;
  meta: AffindaCallMeta;
  /** Full vendor JSON. Callers must persist to ignored artifacts only. */
  raw?: any;
  failureCode?: AffindaFailureCode;
  /** Short non-PII error detail (vendor error code/message, truncated). */
  errorDetail?: string;
}

export class AffindaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffindaConfigError";
  }
}

export interface AffindaConfig {
  apiKey: string;
  workspaceId: string;
  documentTypeId: string;
  baseUrl: string;
  timeoutMs: number;
  deleteAfterParse: boolean;
}

export function getAffindaConfig(env: NodeJS.ProcessEnv = process.env): AffindaConfig {
  const apiKey = env.AFFINDA_API_KEY?.trim();
  const workspaceId = env.AFFINDA_WORKSPACE_ID?.trim();
  const documentTypeId = (env.AFFINDA_DOCUMENT_TYPE_ID || env.AFFINDA_COLLECTION_ID || "").trim();
  const baseUrl = (env.AFFINDA_BASE_URL || "https://api.affinda.com").replace(/\/+$/, "");
  const timeoutMs = Number(env.AFFINDA_TIMEOUT_MS || 120000);
  const deleteAfterParse = (env.AFFINDA_DELETE_AFTER_PARSE || "1") !== "0";

  const missing: string[] = [];
  if (!apiKey) missing.push("AFFINDA_API_KEY");
  if (!workspaceId) missing.push("AFFINDA_WORKSPACE_ID");
  if (!documentTypeId) missing.push("AFFINDA_DOCUMENT_TYPE_ID (or AFFINDA_COLLECTION_ID)");
  if (missing.length) {
    throw new AffindaConfigError(`Missing env: ${missing.join(", ")}`);
  }
  return { apiKey: apiKey!, workspaceId: workspaceId!, documentTypeId, baseUrl, timeoutMs, deleteAfterParse };
}

export function affindaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    getAffindaConfig(env);
    return true;
  } catch {
    return false;
  }
}

/** Truncate an error body so it can be logged without leaking CV content. */
function safeErrorSnippet(body: unknown): string {
  let s: string;
  try {
    s = typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    s = String(body);
  }
  return s.slice(0, 300);
}

/**
 * Upload a CV file to Affinda POST /v3/documents (synchronous wait=true).
 * Returns HTTP status, timing, raw response and vendor quality metadata.
 */
export async function parseWithAffinda(
  buffer: Buffer,
  filename: string,
  cfg: AffindaConfig = getAffindaConfig(),
): Promise<AffindaCallResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);
  form.append("workspace", cfg.workspaceId);
  form.append("documentType", cfg.documentTypeId);
  form.append("wait", "true");
  form.append("compact", "false");
  if (cfg.deleteAfterParse) form.append("deleteAfterParse", "true");

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/v3/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e: any) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      ok: false,
      meta: { httpStatus: 0, durationMs: Date.now() - started },
      failureCode: timeout ? "VENDOR_TIMEOUT" : "VENDOR_UNAVAILABLE",
      errorDetail: String(e?.message || e).slice(0, 200),
    };
  }
  const durationMs = Date.now() - started;

  const text = await res.text();
  let json: any = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const failureCode: AffindaFailureCode =
      res.status === 401 || res.status === 403
        ? "VENDOR_UNAUTHENTICATED"
        : res.status === 400 || res.status === 422
          ? "PARSER_REJECTED"
          : res.status >= 500
            ? "VENDOR_UNAVAILABLE"
            : "VENDOR_ERROR";
    return {
      ok: false,
      meta: { httpStatus: res.status, durationMs },
      raw: json,
      failureCode,
      errorDetail: safeErrorSnippet(json ?? text),
    };
  }

  const meta: AffindaCallMeta = {
    httpStatus: res.status,
    durationMs,
    identifier: json?.meta?.identifier ?? json?.identifier,
    fileName: json?.meta?.fileName,
    pageCount: json?.meta?.pages?.length ?? json?.meta?.pageCount,
    extractionQuality:
      json?.meta?.extractionQuality ??
      json?.meta?.document?.extractionQuality ??
      json?.extractionQuality,
    isResumeProbability:
      json?.data?.isResumeProbability ?? json?.meta?.isResumeProbability,
    parserVersion: json?.meta?.parserVersion ?? json?.meta?.extractorVersion,
    schemaVersion: json?.meta?.schemaVersion,
  };

  // Classify empty/low-quality successes
  const d = json?.data;
  const structured =
    (d?.name?.raw ? 1 : 0) +
    (Array.isArray(d?.education) ? d.education.length : 0) +
    (Array.isArray(d?.workExperience) ? d.workExperience.length : 0) +
    (Array.isArray(d?.skills) ? d.skills.length : 0) +
    (Array.isArray(d?.emails) ? d.emails.length : 0);
  if (structured === 0) {
    return { ok: true, meta, raw: json, failureCode: "EMPTY_STRUCTURED_RESULT" };
  }
  if (typeof meta.isResumeProbability === "number" && meta.isResumeProbability < 0.3) {
    return { ok: true, meta, raw: json, failureCode: "NOT_A_RESUME" };
  }
  if (meta.extractionQuality && /low|poor/i.test(String(meta.extractionQuality))) {
    return { ok: true, meta, raw: json, failureCode: "LOW_EXTRACTION_QUALITY" };
  }

  return { ok: true, meta, raw: json };
}
