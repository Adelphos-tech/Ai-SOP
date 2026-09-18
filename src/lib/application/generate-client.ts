// ============================================================
// GENERATE CLIENT — single-submit guarantee
// ============================================================
// createSingleFlightSubmitter ensures ONE user click → ONE POST.
// A second invocation while a request is in flight returns the SAME
// promise instead of firing another request — no reliance on React
// state/render timing.
// ============================================================

export interface GenerateStartResult {
  ok: boolean;
  status: number;
  data: Record<string, any>;
}

export async function requestGenerate(body: {
  studentId: string; applicationId: string; documentId: string;
}): Promise<GenerateStartResult> {
  const res = await fetch("/api/application/document/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Guard shared by View / Edit-from-here — a version action is valid
 * iff the version has loadable string content. No status rules. */
export function resolveVersionContent(v: { content?: unknown } | null | undefined):
  { ok: true; content: string } | { ok: false; error: string } {
  if (!v || typeof v.content !== "string" || !v.content.length) {
    return { ok: false, error: "Could not load this version." };
  }
  return { ok: true, content: v.content };
}

/** Wraps an async fn so concurrent invocations share one in-flight
 * promise — rapid double-clicks produce exactly one request. */
export function createSingleFlightSubmitter<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  let inFlight: Promise<R> | null = null;
  return (...args: T) => {
    if (inFlight) return inFlight;
    inFlight = fn(...args).finally(() => { inFlight = null; });
    return inFlight;
  };
}
