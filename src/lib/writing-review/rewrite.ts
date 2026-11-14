// ============================================================
// AI Writing Review — server-side sentence refinement (Brick 3)
// Calls Ryne's documented POST /api/humanizer/models/supernova for
// the single selected passage. Consent + per-call cost estimate +
// shared daily spend ledger + timeout + in-flight dedup; no
// automatic retries (a duplicate call may be billable). Key stays
// server-side; provider errors are sanitized before returning.
// ============================================================

import {
  checkSpend,
  dailyBudgetUsd,
  refundSpend,
  ryneBaseUrl,
  sanitizeMessage,
} from "./detection";
import { computeContentHash } from "./detectors";

const TIMEOUT_MS = 45_000; // rewrites are slower than scoring
const MAX_CHARS = 20_000;  // single-passage guard; well under Ryne limits

/** Documented pricing: Balanced $0.08/1K words, Titan $0.50/1K words. */
export const REWRITE_PRICE_PER_1K_USD = { balanced: 0.08, titan: 0.50 } as const;
export type RewriteMode = keyof typeof REWRITE_PRICE_PER_1K_USD;

export function rewriteCostUsd(text: string, mode: RewriteMode): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / 1000) * REWRITE_PRICE_PER_1K_USD[mode];
}

export interface RewriteRequestOptions {
  /** Exact passage text, verified against the authorized version. */
  text: string;
  mode: RewriteMode;
  /** Required — consent to send the passage to Ryne. */
  confirmPaid: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export interface RewriteSuggestion {
  content: string;
  mode: RewriteMode;
  /** Beast Mode detector score when Ryne returns one. Never billed
   *  separately; may be absent (aiScoreUnavailable). */
  aiScore?: number;
  aiScoreUnavailable?: boolean;
  estimatedCostUsd: number;
}

export type RewriteOutcome =
  | { kind: "NOT_CONFIGURED"; notice: string }
  | { kind: "CONSENT_REQUIRED"; notice: string }
  | { kind: "OVER_BUDGET"; notice: string }
  | { kind: "TOO_LONG"; notice: string }
  | { kind: "CANCELLED" }
  | { kind: "ERROR"; message: string; retryable: boolean }
  | { kind: "OK"; suggestion: RewriteSuggestion };

const inFlight = new Map<string, Promise<RewriteOutcome>>();

function ryneKey(): string | null {
  const k = process.env.RYNE_API_KEY?.trim();
  return k || null;
}

/**
 * Rewrite one selected passage. `text` must already be verified by the
 * caller against the authorized document version — this function never
 * fabricates content around it.
 */
export async function runRewrite(opts: RewriteRequestOptions): Promise<RewriteOutcome> {
  if (opts.signal?.aborted) return { kind: "CANCELLED" };

  const key = ryneKey();
  if (!key) {
    return {
      kind: "NOT_CONFIGURED",
      notice: "Ryne is not configured — set RYNE_API_KEY on the server to enable rewrites. No charges were made.",
    };
  }
  const mode = opts.mode === "titan" ? "titan" : "balanced";
  const text = opts.text.trim();
  if (!opts.confirmPaid || !text) {
    return {
      kind: "CONSENT_REQUIRED",
      notice: "Explicit consent is required before passage text is sent to Ryne.",
    };
  }
  if (text.length > MAX_CHARS) {
    return { kind: "TOO_LONG", notice: `Passage is ${text.length} chars; limit is ${MAX_CHARS}.` };
  }

  const est = rewriteCostUsd(text, mode);
  if (!checkSpend(est)) {
    return {
      kind: "OVER_BUDGET",
      notice: `Daily Ryne spend cap (~$${dailyBudgetUsd().toFixed(2)}) reached. Estimated cost blocked: ~$${est.toFixed(4)}.`,
    };
  }

  // Dedup: identical in-flight rewrites share one paid call.
  const fk = `${computeContentHash(text)}:${mode}`;
  const existing = inFlight.get(fk);
  if (existing) { refundSpend(est); return existing; }

  const run = (async (): Promise<RewriteOutcome> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const onOuter = () => ac.abort();
    opts.signal?.addEventListener("abort", onOuter);
    try {
      const res = await (opts.fetcher ?? fetch)(
        `${ryneBaseUrl()}/api/humanizer/models/supernova`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,                     // only the selected passage
            user_id: key,             // server-side key
            humanizerMode: mode,      // documented mode selector
            shouldStream: false,      // single JSON response
            mode: "normal",           // beast_mode stays on; score not billed separately
            beast_mode: true,
            tone: "academic",
            purpose: "statement of purpose / admissions essay",
            language: "english",      // Titan is English-only per docs
          }),
          signal: ac.signal,
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          kind: "ERROR",
          message: sanitizeMessage(
            `Ryne returned HTTP ${res.status}${data?.error_msg || data?.status ? ` — ${data?.error_msg ?? data?.status}` : ""}`),
          retryable: res.status >= 500 || res.status === 429,
        };
      }
      const content = typeof data?.content === "string" ? data.content.trim() : "";
      if (!content) {
        return { kind: "ERROR", message: "Ryne returned an empty rewrite.", retryable: true };
      }
      return {
        kind: "OK",
        suggestion: {
          content,
          mode,
          aiScore: typeof data.aiScore === "number" ? data.aiScore : undefined,
          aiScoreUnavailable: data.aiScoreUnavailable === true,
          estimatedCostUsd: est,
        },
      };
    } catch (err: any) {
      const cancelled = ac.signal.aborted && opts.signal?.aborted;
      return {
        kind: cancelled ? "CANCELLED" : "ERROR",
        message: cancelled
          ? "Cancelled."
          : err?.name === "AbortError"
            ? `No response within ${TIMEOUT_MS / 1000}s.`
            : sanitizeMessage(err?.message || "Network error"),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuter);
    }
  })().finally(() => inFlight.delete(fk));
  inFlight.set(fk, run);
  return run;
}


