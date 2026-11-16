// ============================================================
// AI Writing Studio — server-side full-document humanization
// Humanizes the AUTHORIZED saved version of a document (never
// client-supplied text) through Ryne's documented humanizer endpoint.
// Headings pass through unchanged; body text is sent as ordered
// sections within documented size limits and reassembled in order.
// One operation id = one ledger reservation for the whole document;
// duplicate submissions are never re-billed. Nothing is written to
// the document — the result is a draft until the user saves it.
// ============================================================

import { createHash } from "crypto";
import { paidCallsEnabled } from "./detection";
import { callRyneHumanizer, REWRITE_PRICE_PER_1K_USD, type RewriteMode } from "./rewrite";
import {
  canonicalUnitsKey, getOperation, markUnknown, refundSpend, reserveSpend, settleSpend,
  type OperationRecord,
} from "./spend-ledger";
import { alignRewrite, countWords, planSections, type SectionLimits } from "./document-structure";

const SECTION_TIMEOUT_MS = 120_000; // Titan retries flagged drafts internally
const SECTION_CONCURRENCY = 3;      // keeps multi-section documents inside the proxy timeout

export interface HumanizedSection {
  index: number;
  kind: "HEADING" | "BODY";
  original: string[];
  /** Rewritten paragraphs (HEADING: unchanged original). */
  rewritten: string[];
  /** Provider returned a different paragraph count — shown as one block. */
  structureChanged: boolean;
  aiScore?: number;
}

export interface DocumentHumanizeResult {
  mode: RewriteMode;
  versionId: string;
  content: string;
  sections: HumanizedSection[];
  originalWords: number;
  rewrittenWords: number;
  billableWords: number;
  /** Documented per-word price × billable words — an estimate, not a provider-confirmed charge. */
  estimatedCostUsd: number;
  structureWarnings: number;
}

export type DocumentHumanizeOutcome =
  | { kind: "OK"; result: DocumentHumanizeResult }
  | { kind: "NOT_CONFIGURED" | "CONSENT_REQUIRED" | "TOO_LONG" | "OVER_BUDGET" | "DUPLICATE"; notice: string }
  | { kind: "CANCELLED" }
  | { kind: "ERROR"; message: string; retryable: boolean };

export interface DocumentHumanizeOptions {
  content: string;
  versionId: string;
  mode: RewriteMode;
  confirmPaid: boolean;
  operationId: string;
  actorId?: string | null;
  ids?: { studentId?: string; applicationId?: string; documentId?: string };
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  limits?: SectionLimits;
}

export function estimateDocumentCostUsd(words: number, mode: RewriteMode): number {
  return (words / 1000) * REWRITE_PRICE_PER_1K_USD[mode];
}

const inFlight = new Map<string, Promise<DocumentHumanizeOutcome>>();

export async function runDocumentHumanize(opts: DocumentHumanizeOptions): Promise<DocumentHumanizeOutcome> {
  if (opts.signal?.aborted) return { kind: "CANCELLED" };
  const key = process.env.RYNE_API_KEY?.trim();
  if (!key) return { kind: "NOT_CONFIGURED", notice: "Ryne is not configured — set RYNE_API_KEY on the server. No charges were made." };
  if (!paidCallsEnabled()) {
    return { kind: "NOT_CONFIGURED", notice: "Ryne paid calls are disabled — set RYNE_PAID_CALLS_ENABLED=1 on the server. No text was sent and no charges were made." };
  }
  if (!opts.confirmPaid) {
    return { kind: "CONSENT_REQUIRED", notice: "Explicit consent is required before the document is sent to Ryne." };
  }
  const mode: RewriteMode = opts.mode === "titan" ? "titan" : "balanced";
  const plan = planSections(opts.content, opts.limits);
  if (!plan.ok) return { kind: "TOO_LONG", notice: plan.reason };

  // Concurrent retries of the same submission share one run (and one charge).
  const fk = [opts.operationId, opts.actorId ?? "", opts.ids?.documentId ?? "", opts.versionId, mode,
    createHash("sha256").update(opts.content).digest("hex")].join("|");
  const existing = inFlight.get(fk);
  if (existing) return existing;

  const run = (async (): Promise<DocumentHumanizeOutcome> => {
    const words = plan.bodyWords;
    const wantUnitsKey = canonicalUnitsKey([{ unit: mode, quantity: words }]);
    const sameOp = (op: OperationRecord | null) => !!op && op.requestKind === "HUMANIZER" &&
      op.actorId === (opts.actorId ?? null) && op.documentId === (opts.ids?.documentId ?? null) &&
      op.versionId === opts.versionId && op.unitsKey === wantUnitsKey;
    const dupNotice = (op: OperationRecord | null) => sameOp(op)
      ? "This humanization is already recorded — the duplicate submission was ignored and no additional charge was made."
      : "This request identifier was already used for a different request. Start a new humanization.";

    let prior: OperationRecord | null;
    try { prior = await getOperation(opts.operationId); }
    catch { return { kind: "NOT_CONFIGURED", notice: "Humanizing is blocked — spend ledger unavailable. No text was sent and no charges were made." }; }
    if (prior) return { kind: "DUPLICATE", notice: dupNotice(prior) };

    const reservation = await reserveSpend({
      operationId: opts.operationId, kind: "HUMANIZER",
      units: [{ unit: mode, quantity: words }],
      actorId: opts.actorId ?? null,
      ids: { ...opts.ids, versionId: opts.versionId },
    });
    switch (reservation.kind) {
      case "UNAVAILABLE":
        return { kind: "NOT_CONFIGURED", notice: `Humanizing is blocked — ${reservation.message}. No text was sent and no charges were made.` };
      case "UNPRICED":
        return { kind: "NOT_CONFIGURED", notice: `Humanizing is blocked — ${reservation.reason}. No text was sent and no charges were made.` };
      case "OVER_BUDGET":
        return { kind: "OVER_BUDGET", notice: `Ryne ${reservation.scope === "total" ? "overall" : "daily"} spend cap (~$${reservation.limitUsd.toFixed(2)}) reached — this document needs ~$${reservation.attemptedUsd.toFixed(4)}.` };
      case "FOLLOWER":
        return { kind: "DUPLICATE", notice: dupNotice(reservation.operation) };
    }
    const event = reservation.events[0];
    if (opts.signal?.aborted) {
      await refundSpend(event.id, "CANCELLED_PRE_SEND").catch(() => false);
      return { kind: "CANCELLED" };
    }

    const sections: HumanizedSection[] = plan.sections.map(s => ({
      index: s.index, kind: s.kind, original: s.paragraphs, rewritten: s.kind === "HEADING" ? s.paragraphs : [],
      structureChanged: false,
    }));
    const body = plan.sections.filter(s => s.kind === "BODY");
    let failure: { code: string; message: string; retryable: boolean } | null = null;
    let cursor = 0;
    const worker = async () => {
      while (!failure && cursor < body.length) {
        const s = body[cursor++];
        const call = await callRyneHumanizer({ text: s.text, mode, key, signal: opts.signal, fetcher: opts.fetcher, timeoutMs: SECTION_TIMEOUT_MS });
        if (!call.ok) { failure ??= call; return; }
        const aligned = alignRewrite(s.paragraphs, call.content);
        Object.assign(sections[s.index], { rewritten: aligned.paragraphs, structureChanged: aligned.structureChanged, aiScore: call.aiScore });
      }
    };
    await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, body.length) }, worker));

    if (failure) {
      const f = failure as { code: string; message: string; retryable: boolean };
      // Any section may already have been billed — keep the reservation
      // as UNKNOWN for reconciliation, never silently released.
      await markUnknown(event.id, body.length > 1 ? `PARTIAL_${f.code}` : f.code).catch(() => {});
      if (f.code === "CANCELLED") return { kind: "CANCELLED" };
      return {
        kind: "ERROR", retryable: f.retryable,
        message: body.length > 1
          ? `${f.message} The document was not humanized; earlier sections may still have been billed by Ryne.`
          : f.message,
      };
    }
    const settled = await settleSpend(event.id, { outcome: "OK" }).catch(() => false);
    if (!settled) await markUnknown(event.id, "SETTLEMENT_FAILED").catch(() => {});

    const content = sections.map(s => s.rewritten.join("\n\n")).join("\n\n");
    return {
      kind: "OK",
      result: {
        mode, versionId: opts.versionId, content, sections,
        originalWords: countWords(opts.content),
        rewrittenWords: countWords(content),
        billableWords: words,
        estimatedCostUsd: estimateDocumentCostUsd(words, mode),
        structureWarnings: sections.filter(s => s.structureChanged).length,
      },
    };
  })().finally(() => inFlight.delete(fk));
  inFlight.set(fk, run);
  return run;
}
