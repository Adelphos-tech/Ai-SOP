// ============================================================
// AI Writing Review — persistent Ryne spend ledger (Brick 4B-B)
//
// Atomic, multi-process-safe accounting for billed provider calls.
// NOT yet wired into detection/rewrite — this module is the
// foundation; integration is a separate brick.
//
// Invariants:
//   effective consumption = outstanding RESERVED + SETTLED
//   SETTLED moves amount reserved → settled (net-zero effective)
//   UNKNOWN keeps consuming budget until manually reconciled
//   REFUNDED releases a reservation ONLY for provably unbilled
//     outcomes (request never dispatched / dedup follower) —
//     an HTTP 4xx from the provider does NOT prove no charge.
//
// Never stores document text, prompts, passages, credentials or
// provider payloads — identifiers, prices and outcomes only.
// ============================================================

import { randomUUID } from "crypto";
import { getDbPool } from "@/lib/application/db";

// ---------- pricing configuration ----------

export type PriceUnit = "REQUEST" | "WORD";

export interface PriceSpec {
  /** Billing method: flat per request, or per word. */
  unit: PriceUnit;
  /** Quoted price per unit in USD. null = no quote recorded. */
  unitPriceUsd: number | null;
  /** true only when verified against current provider docs/billing. */
  verified: boolean;
  /** Where the quote came from — for the price snapshot audit trail. */
  source: string;
}

/** Bump whenever any price or its verification status changes so
 *  historical events keep the snapshot they were reserved under. */
export const PRICING_VERSION = "ryne-pricing.2026-11-14.unverified";

/** All prices are UNVERIFIED until confirmed against live provider
 *  docs. Detector calls have no recorded quote at all; the humanizer
 *  per-word figures are previously quoted but unconfirmed. Paid
 *  execution with unverified pricing requires the explicitly approved
 *  conservative ceiling RYNE_UNVERIFIED_PRICE_CEILING_USD. */
const PRICE_BOOK: Record<string, PriceSpec> = {
  reilaa:      { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  gptzero:     { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  zerogpt:     { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  originality: { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  quillbot:    { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  surfer:      { unit: "REQUEST", unitPriceUsd: null,         verified: false, source: "no-quote-recorded" },
  balanced:    { unit: "WORD",    unitPriceUsd: 0.00008,      verified: false, source: "ryne-docs-quoted-unverified" }, // ~$0.08/1K
  titan:       { unit: "WORD",    unitPriceUsd: 0.0005,       verified: false, source: "ryne-docs-quoted-unverified" }, // ~$0.50/1K
};

export function priceSpec(unit: string): PriceSpec | null {
  return PRICE_BOOK[unit] ?? null;
}

// ---------- budget configuration ----------

/** Optional daily cap — owner-configured. Unset/invalid = no daily
 *  cap; requests are recorded but never refused as over-budget. */
export function dailyBudgetUsd(): number | null {
  const n = Number(process.env.RYNE_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Optional overall cap. Unset/invalid = no total cap (daily still
 *  applies when configured) — preserves previous effective behavior. */
export function totalBudgetUsd(): number | null {
  const n = Number(process.env.RYNE_TOTAL_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Optional conservative ceiling per unverified-priced billable unit.
 *  When set it becomes the reservation amount for unverified-priced
 *  units (so budgets can be enforced against an estimate). Unset =
 *  unverified-priced units reserve $0 and are recorded with an
 *  UNVERIFIED_ESTIMATE basis — never treated as free or refused. */
export function unverifiedPriceCeilingUsd(): number | null {
  const n = Number(process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ---------- types ----------

export type SpendKind = "DETECTION" | "HUMANIZER";
export type SpendStatus = "RESERVED" | "SETTLED" | "REFUNDED" | "UNKNOWN";
export type CostBasis = "ESTIMATED" | "UNVERIFIED_ESTIMATE" | "PROVIDER_REPORTED";

export interface SpendEvent {
  id: string;
  operationId: string;
  requestKind: SpendKind;
  provider: string;
  requestUnit: string;
  status: SpendStatus;
  counterDay: string;
  actorId: string | null;
  studentId: string | null;
  applicationId: string | null;
  documentId: string | null;
  versionId: string | null;
  estimatedUsd: number;
  settledUsd: number | null;
  providerCostUsd: number | null;
  costBasis: CostBasis;
  priceUnit: PriceUnit;
  unitPriceUsd: number | null;
  unitQuantity: number;
  pricingVersion: string;
  outcome: string | null;
  providerRef: string | null;
}

export interface ReserveUnit {
  /** Detector tool name or humanizer mode — a PRICE_BOOK key. */
  unit: string;
  /** WORD-priced units only: word count. REQUEST units force 1. */
  quantity?: number;
}

export interface ReserveInput {
  /** Caller's logical-operation id. Retries of the SAME user action
   *  reuse it (→ FOLLOWER, no second charge); a deliberately new scan
   *  passes a fresh id (→ new reservations). */
  operationId: string;
  kind: SpendKind;
  units: ReserveUnit[];
  actorId?: string | null;
  ids?: {
    studentId?: string;
    applicationId?: string;
    documentId?: string;
    versionId?: string;
  };
}

export type ReserveOutcome =
  | { kind: "RESERVED"; events: SpendEvent[]; totalUsd: number }
  | { kind: "FOLLOWER"; events: SpendEvent[]; operation: OperationRecord | null }
  | { kind: "OVER_BUDGET"; scope: "day" | "total"; limitUsd: number; attemptedUsd: number }
  | { kind: "UNPRICED"; unit: string; reason: string }
  | { kind: "UNAVAILABLE"; message: string };

/** Immutable operation identity, claimed atomically with the
 *  reservation — the row that makes one operation id mean exactly
 *  one paid request shape across every Node process. */
export interface OperationRecord {
  operationId: string;
  requestKind: string;
  actorId: string | null;
  studentId: string | null;
  applicationId: string | null;
  documentId: string | null;
  versionId: string | null;
  unitsKey: string;
  createdAt: string;
}

/** Canonical billing-relevant identity of the unit set — sorted
 *  "unit:quantity" pairs, so {reilaa,gptzero} and {gptzero,reilaa}
 *  share a key but {reilaa} and {reilaa,gptzero} never do. */
export function canonicalUnitsKey(units: { unit: string; quantity?: number }[]): string {
  return units
    .map(u => `${u.unit}:${u.quantity ?? 1}`)
    .sort()
    .join(",");
}

export async function getOperation(operationId: string): Promise<OperationRecord | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM ryne_spend_operations WHERE operation_id = ?",
    [operationId],
  );
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    operationId: r.operation_id,
    requestKind: r.request_kind,
    actorId: r.actor_id ?? null,
    studentId: r.student_id ?? null,
    applicationId: r.application_id ?? null,
    documentId: r.document_id ?? null,
    versionId: r.version_id ?? null,
    unitsKey: r.units_key,
    createdAt: String(r.created_at),
  };
}

/** Only these proofs may release a reservation as REFUNDED — cases
 *  where the request provably never reached the provider. */
export const REFUNDABLE_OUTCOMES = ["NOT_DISPATCHED", "CANCELLED_PRE_SEND", "DEDUP_FOLLOWER"] as const;
export type RefundableOutcome = typeof REFUNDABLE_OUTCOMES[number];

// ---------- estimation ----------

type Estimate =
  | { ok: true; estimatedUsd: number; basis: Exclude<CostBasis, "PROVIDER_REPORTED">; spec: PriceSpec; quantity: number }
  | { ok: false; reason: string };

export function estimateFor(unit: string, quantity = 1): Estimate {
  const spec = PRICE_BOOK[unit];
  if (!spec) return { ok: false, reason: `unknown billable unit "${unit}"` };
  const qty = spec.unit === "REQUEST" ? 1 : Math.max(0, quantity);
  const quoted = spec.unitPriceUsd == null ? null : spec.unitPriceUsd * qty;
  if (spec.verified && quoted != null) {
    return { ok: true, estimatedUsd: quoted, basis: "ESTIMATED", spec, quantity: qty };
  }
  // Unverified pricing: when a ceiling is configured it becomes the
  // reservation amount so budgets can be enforced; without one the
  // request reserves the provider's published quote when there is one
  // (Humanizer per-word prices) and $0 when there is none (detectors).
  // Either way it is recorded UNVERIFIED_ESTIMATE — never assumed free.
  // A configured ceiling still blocks quotes that would exceed it.
  const ceiling = unverifiedPriceCeilingUsd();
  if (ceiling == null) {
    return { ok: true, estimatedUsd: quoted ?? 0, basis: "UNVERIFIED_ESTIMATE", spec, quantity: qty };
  }
  if (quoted != null && quoted > ceiling) {
    return { ok: false, reason: `quoted price for "${unit}" (~$${quoted.toFixed(4)}) exceeds the approved ceiling $${ceiling}` };
  }
  return { ok: true, estimatedUsd: ceiling, basis: "UNVERIFIED_ESTIMATE", spec, quantity: qty };
}

// ---------- row mapping ----------

function rowToEvent(row: any): SpendEvent {
  return {
    id: row.id,
    operationId: row.operation_id,
    requestKind: row.request_kind,
    provider: row.provider,
    requestUnit: row.request_unit,
    status: row.status,
    counterDay: row.counter_day,
    actorId: row.actor_id ?? null,
    studentId: row.student_id ?? null,
    applicationId: row.application_id ?? null,
    documentId: row.document_id ?? null,
    versionId: row.version_id ?? null,
    estimatedUsd: Number(row.estimated_usd),
    settledUsd: row.settled_usd == null ? null : Number(row.settled_usd),
    providerCostUsd: row.provider_cost_usd == null ? null : Number(row.provider_cost_usd),
    costBasis: row.cost_basis,
    priceUnit: row.price_unit,
    unitPriceUsd: row.unit_price_usd == null ? null : Number(row.unit_price_usd),
    unitQuantity: Number(row.unit_quantity),
    pricingVersion: row.pricing_version,
    outcome: row.outcome ?? null,
    providerRef: row.provider_ref ?? null,
  };
}

export async function getOperationEvents(operationId: string): Promise<SpendEvent[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM ryne_spend_events WHERE operation_id = ? ORDER BY reserved_at, request_unit",
    [operationId],
  );
  return (rows as any[]).map(rowToEvent);
}

/** Counter snapshot for reporting — all amounts are ledger estimates,
 *  not verified provider charges. */
export async function spendSnapshot(): Promise<{
  day: { day: string; reservedUsd: number; settledUsd: number; limitUsd: number | null };
  total: { reservedUsd: number; settledUsd: number; limitUsd: number | null };
}> {
  const pool = getDbPool();
  const day = utcDay();
  const [rows] = await pool.execute(
    "SELECT scope, scope_key, reserved_usd, settled_usd FROM ryne_spend_counters WHERE (scope='day' AND scope_key=?) OR scope='total'",
    [day],
  );
  const find = (s: string, k: string) =>
    (rows as any[]).find(r => r.scope === s && r.scope_key === k) ?? { reserved_usd: 0, settled_usd: 0 };
  const d = find("day", day), t = find("total", "ALL");
  return {
    day: { day, reservedUsd: Number(d.reserved_usd), settledUsd: Number(d.settled_usd), limitUsd: dailyBudgetUsd() },
    total: { reservedUsd: Number(t.reserved_usd), settledUsd: Number(t.settled_usd), limitUsd: totalBudgetUsd() },
  };
}

// ---------- reservation ----------

const MAX_TXN_ATTEMPTS = 4; // deadlock retries — serialized locks make them rare

/**
 * Atomically reserve spend for every unit of one operation — all or
 * nothing. Order is fixed (counter rows → event rows) so concurrent
 * transactions serialize instead of deadlocking. A duplicate
 * (operation_id, request_kind, request_unit) rolls the reservation
 * back and returns FOLLOWER — cross-process dedup.
 */
export async function reserveSpend(input: ReserveInput): Promise<ReserveOutcome> {
  if (!input.operationId || input.units.length === 0) {
    return { kind: "UNPRICED", unit: "", reason: "operationId and at least one unit are required" };
  }
  // One event per (operation, unit): a repeated unit would trip the
  // events unique key mid-transaction and look like a lost race.
  const repeated = input.units.find((u, i) => input.units.findIndex(o => o.unit === u.unit) !== i);
  if (repeated) {
    return { kind: "UNPRICED", unit: repeated.unit, reason: `unit "${repeated.unit}" is listed more than once in one operation` };
  }
  const priced = input.units.map(u => ({ ...u, est: estimateFor(u.unit, u.quantity ?? 1) }));
  const bad = priced.find(p => !p.est.ok);
  if (bad || !priced.every(p => p.est.ok)) {
    return { kind: "UNPRICED", unit: bad?.unit ?? "", reason: bad && !bad.est.ok ? bad.est.reason : "pricing failed" };
  }
  const items = priced as { unit: string; quantity?: number; est: Extract<Estimate, { ok: true }> }[];
  const total = items.reduce((s, p) => s + p.est.estimatedUsd, 0);
  const day = utcDay();

  for (let attempt = 1; attempt <= MAX_TXN_ATTEMPTS; attempt++) {
    const pool = getDbPool();
    let conn;
    try {
      conn = await pool.getConnection();
    } catch (err: any) {
      return { kind: "UNAVAILABLE", message: `spend ledger unavailable: ${err?.message ?? "no connection"}` };
    }
    try {
      // Counter rows must exist before any lock/update — created in
      // autocommit so a rolled-back txn can't resurrect missing rows.
      await conn.execute(
        "INSERT IGNORE INTO ryne_spend_counters (scope, scope_key) VALUES ('day', ?), ('total', 'ALL')",
        [day],
      );
      await conn.beginTransaction();
      // Serialize EVERY ledger transaction on the same two locks first
      // (day counter → total counter, in this order, in every code
      // path). Concurrent reserves/settles then queue on one row
      // instead of forming lock cycles — real InnoDB testing showed
      // deadlocks when the ops-table insert ran first.
      await conn.execute(
        "SELECT scope_key FROM ryne_spend_counters WHERE scope='day' AND scope_key=? FOR UPDATE",
        [day],
      );
      await conn.execute(
        "SELECT scope_key FROM ryne_spend_counters WHERE scope='total' AND scope_key='ALL' FOR UPDATE",
      );
      // Claim the operation identity — the PRIMARY KEY insert
      // atomically rejects any other process using this id, regardless
      // of whether its detector/humanizer set overlaps ours.
      await conn.execute(
        `INSERT INTO ryne_spend_operations
           (operation_id, request_kind, actor_id, student_id, application_id,
            document_id, version_id, units_key)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          input.operationId, input.kind, input.actorId ?? null,
          input.ids?.studentId ?? null, input.ids?.applicationId ?? null,
          input.ids?.documentId ?? null, input.ids?.versionId ?? null,
          canonicalUnitsKey(items.map(p => ({ unit: p.unit, quantity: p.est.quantity }))),
        ],
      );
      // Daily consumption is ALWAYS tracked — the cap predicate only
      // applies when RYNE_DAILY_BUDGET_USD is configured.
      const dayCap = dailyBudgetUsd();
      if (dayCap != null) {
        const [dayRes] = await conn.execute(
          `UPDATE ryne_spend_counters SET reserved_usd = reserved_usd + ?
            WHERE scope='day' AND scope_key=? AND reserved_usd + settled_usd + ? <= ?`,
          [total, day, total, dayCap],
        );
        if ((dayRes as any).affectedRows === 0) {
          await conn.rollback();
          return { kind: "OVER_BUDGET", scope: "day", limitUsd: dayCap, attemptedUsd: total };
        }
      } else {
        await conn.execute(
          `UPDATE ryne_spend_counters SET reserved_usd = reserved_usd + ?
            WHERE scope='day' AND scope_key=?`,
          [total, day],
        );
      }
      // Lifetime consumption is ALWAYS tracked — the cap predicate
      // only applies when RYNE_TOTAL_BUDGET_USD is configured.
      const totalCap = totalBudgetUsd();
      if (totalCap != null) {
        const [totRes] = await conn.execute(
          `UPDATE ryne_spend_counters SET reserved_usd = reserved_usd + ?
            WHERE scope='total' AND scope_key='ALL' AND reserved_usd + settled_usd + ? <= ?`,
          [total, total, totalCap],
        );
        if ((totRes as any).affectedRows === 0) {
          await conn.rollback();
          return { kind: "OVER_BUDGET", scope: "total", limitUsd: totalCap, attemptedUsd: total };
        }
      } else {
        await conn.execute(
          `UPDATE ryne_spend_counters SET reserved_usd = reserved_usd + ?
            WHERE scope='total' AND scope_key='ALL'`,
          [total],
        );
      }
      const events: SpendEvent[] = [];
      for (const p of items) {
        const id = randomUUID();
        await conn.execute(
          `INSERT INTO ryne_spend_events
             (id, operation_id, request_kind, provider, request_unit, status, counter_day,
              actor_id, student_id, application_id, document_id, version_id,
              estimated_usd, cost_basis, price_unit, unit_price_usd, unit_quantity,
              pricing_version, pricing_captured_at)
           VALUES (?,?,?,?,?,'RESERVED',?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
          [
            id, input.operationId, input.kind, "ryne", p.unit, day,
            input.actorId ?? null, input.ids?.studentId ?? null, input.ids?.applicationId ?? null,
            input.ids?.documentId ?? null, input.ids?.versionId ?? null,
            p.est.estimatedUsd, p.est.basis, p.est.spec.unit, p.est.spec.unitPriceUsd,
            p.est.quantity, PRICING_VERSION,
          ],
        );
        events.push({
          id, operationId: input.operationId, requestKind: input.kind, provider: "ryne",
          requestUnit: p.unit, status: "RESERVED", counterDay: day,
          actorId: input.actorId ?? null,
          studentId: input.ids?.studentId ?? null, applicationId: input.ids?.applicationId ?? null,
          documentId: input.ids?.documentId ?? null, versionId: input.ids?.versionId ?? null,
          estimatedUsd: p.est.estimatedUsd, settledUsd: null, providerCostUsd: null,
          costBasis: p.est.basis, priceUnit: p.est.spec.unit, unitPriceUsd: p.est.spec.unitPriceUsd,
          unitQuantity: p.est.quantity, pricingVersion: PRICING_VERSION,
          outcome: null, providerRef: null,
        });
      }
      await conn.commit();
      return { kind: "RESERVED", events, totalUsd: total };
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      if (err?.code === "ER_DUP_ENTRY") {
        // Same logical operation raced us — report its stored identity
        // so the caller can distinguish an identical retry from an
        // opId reuse with different billing parameters.
        const [operation, existing] = await Promise.all([
          getOperation(input.operationId).catch(() => null),
          getOperationEvents(input.operationId).catch(() => [] as SpendEvent[]),
        ]);
        return { kind: "FOLLOWER", events: existing, operation };
      }
      if (err?.code === "ER_LOCK_DEADLOCK" && attempt < MAX_TXN_ATTEMPTS) continue;
      return { kind: "UNAVAILABLE", message: `spend ledger unavailable: ${err?.message ?? err}` };
    } finally {
      conn.release();
    }
  }
  return { kind: "UNAVAILABLE", message: "spend ledger unavailable: retries exhausted" };
}

// ---------- settlement ----------

type EventRow = { id: string; status: SpendStatus; estimated_usd: number; counter_day: string; cost_basis: CostBasis };

async function withEventTxn(
  eventId: string,
  fn: (conn: any, ev: EventRow) => Promise<boolean>,
): Promise<boolean> {
  const pool = getDbPool();
  let conn;
  try {
    conn = await pool.getConnection();
  } catch {
    return false;
  }
  try {
    await conn.beginTransaction();
    // Uniform lock order across ALL ledger transactions: day counter →
    // total counter → event rows. Taking the counter locks first means
    // reserves and settlements serialize on one row instead of forming
    // deadlocks. The event's own counter_day is needed to pick the row,
    // so it is read first without a lock (the column is immutable).
    const [dayRows] = await conn.execute(
      "SELECT counter_day FROM ryne_spend_events WHERE id = ?",
      [eventId],
    );
    const counterDay = (dayRows as any[])[0]?.counter_day as string | undefined;
    if (!counterDay) {
      await conn.rollback();
      return false;
    }
    await conn.execute(
      "SELECT scope_key FROM ryne_spend_counters WHERE scope='day' AND scope_key=? FOR UPDATE",
      [counterDay],
    );
    await conn.execute(
      "SELECT scope_key FROM ryne_spend_counters WHERE scope='total' AND scope_key='ALL' FOR UPDATE",
    );
    const [rows] = await conn.execute(
      "SELECT id, status, estimated_usd, counter_day, cost_basis FROM ryne_spend_events WHERE id = ? FOR UPDATE",
      [eventId],
    );
    const ev = (rows as any[])[0] as EventRow | undefined;
    if (!ev || ev.status === "SETTLED" || ev.status === "REFUNDED") {
      await conn.rollback();
      return false; // missing or already terminal — never double-settle
    }
    const ok = await fn(conn, ev);
    if (!ok) {
      await conn.rollback();
      return false;
    }
    await conn.commit();
    return true;
  } catch {
    await conn.rollback().catch(() => {});
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Close an event as SETTLED — moves the reservation into settled
 * spend on BOTH the event's own counter_day and the total counter
 * (net-zero effective consumption unless providerCostUsd differs).
 * Works from RESERVED or UNKNOWN; terminal events are refused.
 */
export async function settleSpend(
  eventId: string,
  opts: { outcome: string; providerCostUsd?: number; providerRef?: string },
): Promise<boolean> {
  return withEventTxn(eventId, async (conn, ev) => {
    const reported = opts.providerCostUsd != null;
    const charge = reported ? opts.providerCostUsd! : Number(ev.estimated_usd);
    const basis: CostBasis = reported ? "PROVIDER_REPORTED" : ev.cost_basis;
    const [r1] = await conn.execute(
      `UPDATE ryne_spend_events
          SET status='SETTLED', settled_usd=?, outcome=?, provider_ref=?,
              provider_cost_usd=?, cost_basis=?, settled_at=NOW()
        WHERE id=?`,
      [charge, opts.outcome, opts.providerRef ?? null, reported ? charge : null, basis, eventId],
    );
    if ((r1 as any).affectedRows === 0) return false;
    // Guarded decrement: reserved_usd >= estimated must hold for the
    // reservation this event created. If the counter would go negative
    // the update affects 0 rows and the whole transition rolls back —
    // accounting drift is surfaced, never silently clamped away.
    const [r2] = await conn.execute(
      `UPDATE ryne_spend_counters
          SET reserved_usd = reserved_usd - ?, settled_usd = settled_usd + ?
        WHERE scope='day' AND scope_key=? AND reserved_usd >= ?`,
      [ev.estimated_usd, charge, ev.counter_day, ev.estimated_usd],
    );
    if ((r2 as any).affectedRows === 0) return false;
    const [r3] = await conn.execute(
      `UPDATE ryne_spend_counters
          SET reserved_usd = reserved_usd - ?, settled_usd = settled_usd + ?
        WHERE scope='total' AND scope_key='ALL' AND reserved_usd >= ?`,
      [ev.estimated_usd, charge, ev.estimated_usd],
    );
    if ((r3 as any).affectedRows === 0) return false;
    return true;
  });
}

/**
 * Release a reservation ONLY for provably unbilled outcomes — the
 * request never left the server. An HTTP 4xx/5xx, timeout or network
 * error is NOT proof of non-billing; use markUnknown for those.
 */
export async function refundSpend(eventId: string, proof: RefundableOutcome): Promise<boolean> {
  if (!REFUNDABLE_OUTCOMES.includes(proof)) return false;
  return withEventTxn(eventId, async (conn, ev) => {
    const [r1] = await conn.execute(
      `UPDATE ryne_spend_events
          SET status='REFUNDED', outcome=?, settled_at=NOW()
        WHERE id=?`,
      [proof, eventId],
    );
    if ((r1 as any).affectedRows === 0) return false;
    // Same guard as settle — a refund that would drive a counter
    // negative indicates drift; fail the transition instead of hiding it.
    const [r2] = await conn.execute(
      `UPDATE ryne_spend_counters
          SET reserved_usd = reserved_usd - ?
        WHERE scope='day' AND scope_key=? AND reserved_usd >= ?`,
      [ev.estimated_usd, ev.counter_day, ev.estimated_usd],
    );
    if ((r2 as any).affectedRows === 0) return false;
    const [r3] = await conn.execute(
      `UPDATE ryne_spend_counters
          SET reserved_usd = reserved_usd - ?
        WHERE scope='total' AND scope_key='ALL' AND reserved_usd >= ?`,
      [ev.estimated_usd, ev.estimated_usd],
    );
    if ((r3 as any).affectedRows === 0) return false;
    return true;
  });
}

/**
 * Mark an event UNKNOWN — outcome was ambiguous (timeout, network
 * error, provider 5xx/429, crash after dispatch). The reservation
 * keeps consuming budget until reconcile via settleSpend/refundSpend.
 */
export async function markUnknown(eventId: string, outcome: string): Promise<boolean> {
  const pool = getDbPool();
  try {
    const [r] = await pool.execute(
      `UPDATE ryne_spend_events SET status='UNKNOWN', outcome=? WHERE id=? AND status='RESERVED'`,
      [outcome, eventId],
    );
    return (r as any).affectedRows === 1;
  } catch {
    return false;
  }
}
