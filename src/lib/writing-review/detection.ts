// ============================================================
// AI Writing Review — server-side detection runner (Brick 2)
// Calls Ryne's documented POST /api/ai-score once per selected
// detector. Every call is gated: configured key, explicit user
// consent, per-run detector budget, char limit, per-request
// timeout, per-document cooldown, cancellation, and partial-
// success semantics — one failed detector never erases others.
// The API key is read server-side only and never returned.
// ============================================================

import type {
  DetectionResult,
  DetectorScore,
  FlaggedPassage,
} from "./types";
import { randomUUID } from "crypto";
import {
  computeContentHash,
  listDetectorDescriptors,
  listDetectorStatuses,
} from "./detectors";
import { mapAiScoreResponse, mapSentenceFindings } from "./ryne-client";
import {
  canonicalUnitsKey,
  getOperation,
  markUnknown,
  refundSpend as refundLedgerEvent, // alias — this file exports refundSpend for rewrite.ts
  reserveSpend,
  settleSpend,
  type OperationRecord,
} from "./spend-ledger";

// ---------- configuration (server-side env) ----------

export const RYNE_MAX_CHARS = 40_000; // documented hard limit
const TIMEOUT_MS = 20_000;
const COOLDOWN_MS = 15_000; // per document — basic rate limiting

function ryneKey(): string | null {
  const k = process.env.RYNE_API_KEY?.trim();
  return k || null;
}
/** Server-side kill switch for all billed Ryne calls. OFF unless the
 *  env var is exactly "1"; a configured API key never overrides it. */
export function paidCallsEnabled(): boolean {
  return process.env.RYNE_PAID_CALLS_ENABLED === "1";
}
export function ryneBaseUrl(): string {
  return (process.env.RYNE_API_BASE_URL?.trim() || "https://ryne.ai")
    .replace(/\/+$/, "");
}
/** Max detector calls per recheck; each is a billed request. */
function detectorBudget(): number {
  const n = Number(process.env.RYNE_MAX_DETECTORS_PER_RUN ?? 3);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

export interface DetectionRequestOptions {
  /** Explicit detector ids the user chose + consented to pay for. */
  detectors: string[];
  /** Required — consent to send the document text to Ryne. */
  confirmPaid: boolean;
  /** Version the analysis is anchored to (staleness). */
  baseVersionId: string;
  /** Document text. */
  content: string;
  /** Caller abort signal. */
  signal?: AbortSignal;
  /** Stable id for retries of ONE logical user action — a new run
   *  must pass a fresh id. Generated when absent (direct callers). */
  operationId?: string;
  /** Authenticated consultant id — recorded on every ledger event. */
  actorId?: string | null;
  /** Authorization context recorded on every ledger event. */
  ids?: { studentId?: string; applicationId?: string; versionId?: string };
  /** Injected transport — tests must pass a mock. */
  fetcher?: typeof fetch;
  now?: () => number;
}

export type DetectionOutcome =
  | { kind: "NOT_CONFIGURED"; detection: DetectionResult; notice: string }
  | { kind: "CONSENT_REQUIRED"; detection: DetectionResult; notice: string }
  | { kind: "OVER_BUDGET"; notice: string; requested: number; allowed: number }
  | { kind: "TOO_LONG"; notice: string; chars: number }
  | { kind: "RATE_LIMITED"; notice: string; retryAfterMs: number }
  /** Same operationId already recorded — either an honest duplicate of
   *  an in-flight/finished run, or a rejected id reuse with different
   *  parameters. Never a fabricated score. */
  | { kind: "DUPLICATE"; detection: DetectionResult; notice: string }
  | { kind: "CANCELLED"; detection: DetectionResult }
  | { kind: "OK"; detection: DetectionResult; estimatedCostUsd: number };

// ---------- in-memory cooldown + result cache ----------
// Single-process guard: enough to stop accidental double-billing in
// dev/local; horizontal scale should add a shared limiter later.

const lastRunAt = new Map<string, number>();
const resultCache = new Map<string, { at: number; detection: DetectionResult }>();
const inFlight = new Map<string, Promise<DetectionOutcome>>();
// Brick 4B-C1: detection reserves via the persistent MySQL ledger.
// The in-memory counter below remains ONLY for rewrite.ts until the
// humanizer brick lands — do not remove while it is imported there.
const spend = { day: "", usd: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/** Daily spend ceiling — used by the persistent ledger (detection)
 *  and, until its own brick lands, by the in-memory rewrite path.
 *  LIMITATION (rewrite only): in-memory; resets on restart. */
export function dailyBudgetUsd(): number {
  const n = Number(process.env.RYNE_DAILY_BUDGET_USD ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}
export function checkSpend(addUsd: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (spend.day !== today) { spend.day = today; spend.usd = 0; }
  if (spend.usd + addUsd > dailyBudgetUsd()) return false;
  spend.usd += addUsd;
  return true;
}
/** Release a reserved amount (e.g. a follower request covered by an
 *  in-flight leader, or a call that returned before billing). */
export function refundSpend(usd: number) {
  const today = new Date().toISOString().slice(0, 10);
  if (spend.day !== today) { spend.day = today; spend.usd = 0; }
  spend.usd = Math.max(0, spend.usd - usd);
}
function cacheSet(key: string, detection: DetectionResult, now: number) {
  if (resultCache.size >= CACHE_MAX_ENTRIES) {
    // evict expired/oldest entries — bounded memory
    let removed = 0;
    for (const [k, v] of resultCache) {
      if (now - v.at >= CACHE_TTL_MS) { resultCache.delete(k); removed++; }
    }
    if (removed === 0) resultCache.delete(resultCache.keys().next().value!);
  }
  resultCache.set(key, { at: now, detection });
}
/** Never leak the API key (or other configured secrets) into an
 *  error string — strip it if a provider echoes it back. */
export function sanitizeMessage(msg: string): string {
  const key = ryneKey();
  return key ? msg.split(key).join("[redacted]") : msg;
}

function cacheKey(documentKey: string, contentHash: string, detectors: string[]) {
  return `${documentKey}:${contentHash}:${[...detectors].sort().join(",")}`;
}

/** Rough public estimate: Ryne bills prepaid credits per call; exact
 *  per-detector pricing isn't published, so we report a configured
 *  per-call estimate (default $0.02) — never presented as precise. */
export function estimatedCostUsd(detectorCount: number): number {
  const per = Number(process.env.RYNE_COST_PER_DETECTOR_USD ?? 0.02);
  return detectorCount * (Number.isFinite(per) && per >= 0 ? per : 0.02);
}

/** Runnable = documented Ryne ai-score tools only. Ryne-native score
 *  comes from Beast Mode rewrites (Brick 3); Turnitin has no endpoint. */
export function runnableTools(): string[] {
  return listDetectorDescriptors()
    .filter(d => d.integration === "RYNE_AI_SCORE" && d.ryneTool)
    .map(d => d.ryneTool!);
}

const TOOL_BY_DETECTOR: Record<string, string> = Object.fromEntries(
  listDetectorDescriptors()
    .filter(d => d.ryneTool)
    .map(d => [d.detector, d.ryneTool!]),
);

interface DetectorCall {
  score: DetectorScore;
  raw: import("./ryne-client").RyneAiScoreResponse | null;
}

async function callDetector(
  tool: string,
  text: string,
  key: string,
  checkedAt: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<DetectorCall> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const onOuter = () => ac.abort();
  signal?.addEventListener("abort", onOuter);
  try {
    const res = await fetcher(`${ryneBaseUrl()}/api/ai-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        tool,                        // documented detector selector
        "fallback-tool": "zerogpt",  // documented default fallback
      },
      body: JSON.stringify({ text, user_id: key }), // key stays server-side
      signal: ac.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { raw: null, score: {
        detector: TOOL_BY_DETECTOR_TO_ID(tool),
        status: "ERROR",
        error: {
          detector: TOOL_BY_DETECTOR_TO_ID(tool),
          code: "PROVIDER_ERROR",
          message: sanitizeMessage(`Ryne returned HTTP ${res.status}${data?.error_msg ? ` — ${data.error_msg}` : ""}`),
          retryable: res.status >= 500 || res.status === 429,
        },
        note: "Check failed — a failed detector is not a 0% score.",
      } };
    }
    const score = mapAiScoreResponse(tool, data ?? { error: true, error_msg: "empty response" }, checkedAt);
    // Providers may echo secrets inside 200-status error messages.
    if (score.error) score.error.message = sanitizeMessage(score.error.message);
    return { raw: data, score };
  } catch (err: any) {
    const cancelled = ac.signal.aborted && signal?.aborted;
    return { raw: null, score: {
      detector: TOOL_BY_DETECTOR_TO_ID(tool),
      status: "ERROR",
      error: {
        detector: TOOL_BY_DETECTOR_TO_ID(tool),
        code: cancelled ? "CANCELLED" : err?.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        message: cancelled
          ? "Cancelled by user."
          : err?.name === "AbortError"
            ? `No response within ${TIMEOUT_MS / 1000}s.`
            : sanitizeMessage(err?.message || "Network error"),
        retryable: true,
      },
      note: "Check failed — a failed detector is not a 0% score.",
    } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuter);
  }
}

function TOOL_BY_DETECTOR_TO_ID(tool: string) {
  const d = listDetectorDescriptors().find(x => x.ryneTool === tool);
  return (d?.detector ?? "REILAA");
}

/**
 * Run the selected detectors against the given content.
 * Returns honest per-detector results; failures are isolated.
 */
export async function runDetection(
  documentKey: string,
  opts: DetectionRequestOptions,
): Promise<DetectionOutcome> {
  const checkedAt = new Date().toISOString();
  const contentHash = computeContentHash(opts.content);
  const base: DetectionResult = {
    baseVersionId: opts.baseVersionId,
    contentHash,
    checkedAt,
    scores: [],
    passages: [],
  };

  if (opts.signal?.aborted) return { kind: "CANCELLED", detection: base };

  const key = ryneKey();
  if (!key) {
    base.scores = listDetectorStatuses();
    return {
      kind: "NOT_CONFIGURED",
      detection: base,
      notice: "Ryne is not configured — set RYNE_API_KEY on the server to enable detection. No charges were made.",
    };
  }
  // Brick 4A kill switch — hard OFF before consent, cooldown, cache,
  // spend reservation or any network call.
  if (!paidCallsEnabled()) {
    base.scores = listDetectorStatuses();
    return {
      kind: "NOT_CONFIGURED",
      detection: base,
      notice: "Ryne paid calls are disabled — set RYNE_PAID_CALLS_ENABLED=1 on the server to enable live detection. No text was sent and no charges were made.",
    };
  }

  const requested = [...new Set(opts.detectors.filter(d => TOOL_BY_DETECTOR[d]))];
  if (!opts.confirmPaid || requested.length === 0) {
    base.scores = listDetectorStatuses();
    return {
      kind: "CONSENT_REQUIRED",
      detection: base,
      notice: "Explicit consent and at least one detector selection are required before document text is sent to Ryne.",
    };
  }
  if (requested.length > detectorBudget()) {
    return {
      kind: "OVER_BUDGET",
      notice: `Request selects ${requested.length} detectors; budget allows ${detectorBudget()} per run (estimated ~$${estimatedCostUsd(requested.length).toFixed(2)}).`,
      requested: requested.length,
      allowed: detectorBudget(),
    };
  }
  if (opts.content.length > RYNE_MAX_CHARS) {
    return {
      kind: "TOO_LONG",
      notice: `Document is ${opts.content.length} chars; Ryne's documented limit is ${RYNE_MAX_CHARS}.`,
      chars: opts.content.length,
    };
  }

  const now = opts.now ?? Date.now;
  const last = lastRunAt.get(documentKey) ?? 0;
  const wait = COOLDOWN_MS - (now() - last);
  if (wait > 0) {
    return {
      kind: "RATE_LIMITED",
      notice: `A check ran recently for this document — retry in ${Math.ceil(wait / 1000)}s to avoid duplicate charges.`,
      retryAfterMs: wait,
    };
  }

  const ck = cacheKey(documentKey, contentHash, requested);
  const cached = resultCache.get(ck);
  if (cached && now() - cached.at < CACHE_TTL_MS) {
    return { kind: "OK", detection: cached.detection, estimatedCostUsd: 0 };
  }

  lastRunAt.set(documentKey, now());
  const fetcher = opts.fetcher ?? fetch;

  // Concurrency dedup BEFORE reserving spend: an identical in-flight
  // run shares its promise — followers must not create a reservation.
  const inflight = inFlight.get(ck);
  if (inflight) return inflight;

  // Brick 4B-C1: durable per-detector reservation BEFORE any provider
  // call. One ledger event per selected detector (real billing
  // granularity); all-or-nothing; cross-process duplicate-safe via the
  // operation id. Detector prices are unverified — reservation amounts
  // come from the approved ceiling, never from invented pricing.
  const operationId = opts.operationId ?? randomUUID();
  const tools = requested.map(det => TOOL_BY_DETECTOR[det]);

  // Operation identity: an opId already claimed may only continue as
  // an identical retry — same kind, actor, student/application/
  // document/version and canonical detector set. Anything else is a
  // rejected identity conflict; the claim is enforced atomically in
  // the reservation transaction, so non-overlapping detector sets on
  // different processes can never both bill under one id.
  const wantUnitsKey = canonicalUnitsKey(tools.map(unit => ({ unit, quantity: 1 })));
  const opIdentityMatches = (op: OperationRecord | null) =>
    !!op &&
    op.requestKind === "DETECTION" &&
    op.actorId === (opts.actorId ?? null) &&
    op.studentId === (opts.ids?.studentId ?? null) &&
    op.applicationId === (opts.ids?.applicationId ?? null) &&
    op.documentId === documentKey &&
    op.versionId === (opts.ids?.versionId ?? null) &&
    op.unitsKey === wantUnitsKey;
  let prior: OperationRecord | null | undefined;
  try {
    prior = await getOperation(operationId);
  } catch {
    return {
      kind: "NOT_CONFIGURED",
      detection: base,
      notice: "Paid detection is blocked — spend ledger unavailable: no connection. No text was sent and no charges were made.",
    };
  }
  if (prior) {
    return {
      kind: "DUPLICATE",
      detection: base,
      notice: opIdentityMatches(prior)
        ? "This check is already recorded — a duplicate submission was ignored and no additional charge was made. Results, if any, come from the original run."
        : "This check identifier was already used for a different request — it cannot be reused. Start a new check.",
    };
  }

  const reservation = await reserveSpend({
    operationId,
    kind: "DETECTION",
    units: tools.map(unit => ({ unit })),
    actorId: opts.actorId ?? null,
    ids: {
      studentId: opts.ids?.studentId,
      applicationId: opts.ids?.applicationId,
      documentId: documentKey,
      versionId: opts.ids?.versionId,
    },
  });
  switch (reservation.kind) {
    case "UNAVAILABLE":
      return {
        kind: "NOT_CONFIGURED",
        detection: base,
        notice: `Paid detection is blocked — ${reservation.message}. No text was sent and no charges were made.`,
      };
    case "UNPRICED":
      return {
        kind: "NOT_CONFIGURED",
        detection: base,
        notice: `Paid detection is blocked — ${reservation.reason}. No text was sent and no charges were made.`,
      };
    case "OVER_BUDGET":
      return {
        kind: "OVER_BUDGET",
        notice: `Ryne ${reservation.scope === "total" ? "overall" : "daily"} spend cap (~$${reservation.limitUsd.toFixed(2)}) reached. Estimated reservation blocked: ~$${reservation.attemptedUsd.toFixed(4)} (unverified estimate — Ryne does not publish confirmed per-detector pricing).`,
        requested: requested.length,
        allowed: 0,
      };
    case "FOLLOWER": {
      // Lost a race: another process claimed this opId between our
      // pre-check and our insert. Re-validate against the winner's
      // immutable identity — identical retry vs rejected conflict.
      return {
        kind: "DUPLICATE",
        detection: base,
        notice: opIdentityMatches(reservation.operation)
          ? "This check is already recorded — a duplicate submission was ignored and no additional charge was made. Results, if any, come from the original run."
          : "This check identifier was already used for a different request — it cannot be reused. Start a new check.",
      };
    }
  }
  const events = reservation.events;
  const eventByUnit = new Map(events.map(e => [e.requestUnit, e]));

  // Cancellation after the reservation but before dispatch: provably
  // unbilled → release every event as REFUNDED.
  if (opts.signal?.aborted) {
    await Promise.all(events.map(e => refundLedgerEvent(e.id, "CANCELLED_PRE_SEND").catch(() => false)));
    return { kind: "CANCELLED", detection: base };
  }

  const run = (async (): Promise<DetectionOutcome> => {
  const settled = await Promise.allSettled(
    requested.map(det =>
      callDetector(TOOL_BY_DETECTOR[det], opts.content, key, checkedAt, fetcher, opts.signal),
    ),
  );

  // Settle each detector's ledger event independently: a genuine score
  // settles at the reserved estimate; any failure or ambiguous outcome
  // (timeout, network, HTTP error, crash) stays UNKNOWN and keeps
  // consuming budget — a failed call is never presumed unbilled.
  await Promise.all(settled.map(async (s, i) => {
    const ev = eventByUnit.get(tools[i]);
    if (!ev) return;
    if (s.status === "fulfilled" && s.value.score.status === "SCORED") {
      const ok = await settleSpend(ev.id, { outcome: "OK" }).catch(() => false);
      if (!ok) await markUnknown(ev.id, "SETTLEMENT_FAILED").catch(() => {});
      return;
    }
    const code = s.status === "fulfilled"
      ? (s.value.score.error?.code ?? "ERROR")
      : "INTERNAL";
    await markUnknown(ev.id, code).catch(() => {});
  }));

  const scores: DetectorScore[] = [];
  const passages: FlaggedPassage[] = [];
  settled.forEach((s, i) => {
    const det = requested[i];
    if (s.status !== "fulfilled") {
      scores.push({
        detector: det as DetectorScore["detector"],
        status: "ERROR",
        error: {
          detector: det as DetectorScore["detector"],
          code: "INTERNAL",
          message: String(s.reason),
          retryable: true,
        },
      });
      return;
    }
    scores.push(s.value.score);
    // Sentence findings only when the provider genuinely returned
    // them — ambiguity-safe matching, document-level → no highlights.
    if (s.value.score.status === "SCORED" && s.value.raw) {
      passages.push(...mapSentenceFindings(opts.content, det as DetectorScore["detector"], s.value.raw));
    }
  });

  // Non-selected detectors keep their honest registry state.
  const selected = new Set(requested);
  for (const s of listDetectorStatuses()) {
    if (!selected.has(s.detector)) scores.push(s);
  }

  const detection: DetectionResult = { ...base, scores, passages };
  // Only cache clean results — a transient provider failure must not
  // lock the user out of a retry for the cache TTL.
  const requestedErrored = requested.some(det =>
    scores.some(s => s.detector === det && s.status === "ERROR"));
  if (!requestedErrored) cacheSet(ck, detection, now());
  if (opts.signal?.aborted) return { kind: "CANCELLED", detection };

  return {
    kind: "OK",
    detection,
    // Sum of per-detector reservations — an internal estimate only,
    // never a provider-confirmed charge.
    estimatedCostUsd: reservation.totalUsd,
  };
  })().finally(() => inFlight.delete(ck));
  inFlight.set(ck, run);
  return run;
}
