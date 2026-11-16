// ============================================================
// AI Writing Review — server-side sentence refinement (Brick 3)
// Calls Ryne's documented POST /api/humanizer/models/supernova for
// the single selected passage. Consent + per-call cost estimate +
// shared daily spend ledger + timeout + in-flight dedup; no
// automatic retries (a duplicate call may be billable). Key stays
// server-side; provider errors are sanitized before returning.
// ============================================================

import {
  paidCallsEnabled,
  ryneBaseUrl,
  sanitizeMessage,
} from "./detection";
import { createHash, randomUUID } from "crypto";
import {
  canonicalUnitsKey,
  getOperation,
  markUnknown,
  refundSpend as refundLedgerEvent,
  reserveSpend,
  settleSpend,
  type OperationRecord,
} from "./spend-ledger";

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
  /** Stable id for retries of ONE logical user action — a new
   *  deliberate rewrite must pass a fresh id. Generated when absent. */
  operationId?: string;
  /** Authenticated consultant id — recorded on the ledger event. */
  actorId?: string | null;
  /** Authorization context recorded on the ledger event. */
  ids?: { studentId?: string; applicationId?: string; documentId?: string; versionId?: string };
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
  /** Same operationId already recorded — identical retry or a
   *  rejected id reuse with different parameters. Never re-billed. */
  | { kind: "DUPLICATE"; notice: string }
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
  // Brick 4A kill switch — hard OFF before consent, spend reservation
  // or any network call.
  if (!paidCallsEnabled()) {
    return {
      kind: "NOT_CONFIGURED",
      notice: "Ryne paid calls are disabled — set RYNE_PAID_CALLS_ENABLED=1 on the server to enable rewrites. No text was sent and no charges were made.",
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

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // Dedup BEFORE reserving spend: a concurrent retry of the SAME
  // logical operation shares the leader's paid call and must not
  // create a second reservation. The key is scoped to the operation id,
  // the authenticated actor/document/version AND the mode + passage —
  // identical text from a different consultant, document, version or
  // deliberate new operation is a separate billable run, and an
  // operation id reused for another passage or mode falls through to
  // the ledger's identity check instead of sharing this result.
  // The run promise is registered synchronously so the dedup window
  // covers the awaited identity claim and reservation too.
  const operationId = opts.operationId ?? randomUUID();
  const fk = [
    operationId,
    opts.actorId ?? "",
    opts.ids?.documentId ?? "",
    opts.ids?.versionId ?? "",
    mode,
    createHash("sha256").update(text).digest("hex"),
  ].join("|");
  const existing = inFlight.get(fk);
  if (existing) return existing;

  const run = (async (): Promise<RewriteOutcome> => {
    // Brick 4B-C2: durable per-word reservation BEFORE any provider call,
    // claimed atomically with the operation identity — the same ledger
    // and counters detection uses, so both features share one budget.
    const wantUnitsKey = canonicalUnitsKey([{ unit: mode, quantity: words }]);
    const opIdentityMatches = (op: OperationRecord | null) =>
      !!op &&
      op.requestKind === "HUMANIZER" &&
      op.actorId === (opts.actorId ?? null) &&
      op.studentId === (opts.ids?.studentId ?? null) &&
      op.applicationId === (opts.ids?.applicationId ?? null) &&
      op.documentId === (opts.ids?.documentId ?? null) &&
      op.versionId === (opts.ids?.versionId ?? null) &&
      op.unitsKey === wantUnitsKey;
    let prior: OperationRecord | null;
    try {
      prior = await getOperation(operationId);
    } catch {
      return {
        kind: "NOT_CONFIGURED",
        notice: "Paid rewriting is blocked — spend ledger unavailable: no connection. No text was sent and no charges were made.",
      };
    }
    if (prior) {
      return {
        kind: "DUPLICATE",
        notice: opIdentityMatches(prior)
          ? "This rewrite is already recorded — a duplicate submission was ignored and no additional charge was made."
          : "This rewrite identifier was already used for a different request — it cannot be reused. Start a new rewrite.",
      };
    }

    const reservation = await reserveSpend({
      operationId,
      kind: "HUMANIZER",
      units: [{ unit: mode, quantity: words }],
      actorId: opts.actorId ?? null,
      ids: {
        studentId: opts.ids?.studentId,
        applicationId: opts.ids?.applicationId,
        documentId: opts.ids?.documentId,
        versionId: opts.ids?.versionId,
      },
    });
    switch (reservation.kind) {
      case "UNAVAILABLE":
        return { kind: "NOT_CONFIGURED", notice: `Paid rewriting is blocked — ${reservation.message}. No text was sent and no charges were made.` };
      case "UNPRICED":
        return { kind: "NOT_CONFIGURED", notice: `Paid rewriting is blocked — ${reservation.reason}. No text was sent and no charges were made.` };
      case "OVER_BUDGET":
        return {
          kind: "OVER_BUDGET",
          notice: `Ryne ${reservation.scope === "total" ? "overall" : "daily"} spend cap (~$${reservation.limitUsd.toFixed(2)}) reached. Estimated reservation blocked: ~$${reservation.attemptedUsd.toFixed(4)} (unverified estimate — quoted per-word prices are not provider-confirmed).`,
        };
      case "FOLLOWER":
        return {
          kind: "DUPLICATE",
          notice: opIdentityMatches(reservation.operation)
            ? "This rewrite is already recorded — a duplicate submission was ignored and no additional charge was made."
            : "This rewrite identifier was already used for a different request — it cannot be reused. Start a new rewrite.",
        };
    }
    const event = reservation.events[0];

    // Cancellation after the reservation but before dispatch: provably
    // unbilled → release the event as REFUNDED.
    if (opts.signal?.aborted) {
      await refundLedgerEvent(event.id, "CANCELLED_PRE_SEND").catch(() => false);
      return { kind: "CANCELLED" };
    }

    const call = await callRyneHumanizer({ text, mode, key, signal: opts.signal, fetcher: opts.fetcher });
    if (!call.ok) {
      // Ambiguous — the request may have been billed; keep the
      // reservation as UNKNOWN, never silently released.
      await markUnknown(event.id, call.code).catch(() => {});
      return call.code === "CANCELLED"
        ? { kind: "CANCELLED" }
        : { kind: "ERROR", message: call.message, retryable: call.retryable };
    }
    const settled = await settleSpend(event.id, { outcome: "OK" }).catch(() => false);
    if (!settled) await markUnknown(event.id, "SETTLEMENT_FAILED").catch(() => {});
    return {
      kind: "OK",
      suggestion: {
        content: call.content,
        mode,
        aiScore: call.aiScore,
        aiScoreUnavailable: call.aiScoreUnavailable,
        // Reserved amount — internal estimate only, never a
        // provider-confirmed charge.
        estimatedCostUsd: reservation.totalUsd,
      },
    };
  })().finally(() => inFlight.delete(fk));
  inFlight.set(fk, run);
  return run;
}



export type HumanizerCall =
  | { ok: true; content: string; aiScore?: number; aiScoreUnavailable: boolean }
  | { ok: false; code: string; message: string; retryable: boolean };

/**
 * One documented POST /api/humanizer/models/supernova call. Never
 * retries (a repeat may be billable). Errors are sanitized; an empty
 * rewrite is an error, never returned as content.
 */
export async function callRyneHumanizer(opts: {
  text: string; mode: RewriteMode; key: string;
  signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<HumanizerCall> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onOuter = () => ac.abort();
  opts.signal?.addEventListener("abort", onOuter);
  try {
    const res = await (opts.fetcher ?? fetch)(`${ryneBaseUrl()}/api/humanizer/models/supernova`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        user_id: opts.key,          // server-side key
        humanizerMode: opts.mode,   // documented mode selector
        shouldStream: false,        // single JSON response
        mode: "normal",             // beast_mode stays on; score not billed separately
        beast_mode: true,
        tone: "academic",           // required by Balanced; ignored by Titan
        purpose: "statement of purpose / admissions essay",
        language: "english",        // Titan is English-only per docs
      }),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error === true) {
      const detail = data?.error_msg ?? data?.code ?? data?.status;
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: sanitizeMessage(`Ryne returned HTTP ${res.status}${detail ? ` — ${detail}` : ""}`),
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const content = typeof data?.content === "string" ? data.content.trim() : "";
    if (!content) return { ok: false, code: "EMPTY_RESPONSE", message: "Ryne returned an empty rewrite.", retryable: true };
    return {
      ok: true,
      content,
      aiScore: typeof data.aiScore === "number" ? data.aiScore : undefined,
      aiScoreUnavailable: data.aiScoreUnavailable === true,
    };
  } catch (err: any) {
    const cancelled = ac.signal.aborted && !!opts.signal?.aborted;
    return {
      ok: false,
      code: cancelled ? "CANCELLED" : err?.name === "AbortError" ? "TIMEOUT" : "NETWORK",
      message: cancelled
        ? "Cancelled."
        : err?.name === "AbortError"
          ? `No response within ${timeoutMs / 1000}s.`
          : sanitizeMessage(err?.message || "Network error"),
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuter);
  }
}
