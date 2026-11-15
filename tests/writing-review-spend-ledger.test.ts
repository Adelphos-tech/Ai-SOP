/* Brick 4B-B contract tests — persistent Ryne spend ledger.
 *
 * Run with the mysql2 mock preload (no database, no network):
 *   NODE_OPTIONS="--import ./tests/mysql2-mock-preload.mjs" \
 *     npx tsx tests/writing-review-spend-ledger.test.ts
 *
 * The module under test is NOT wired to runDetection/runRewrite —
 * these tests exercise reservation/settlement semantics directly.
 * No provider calls, no document text, no real money. */
import assert from "node:assert/strict";
import {
  reserveSpend,
  settleSpend,
  refundSpend,
  markUnknown,
  getOperationEvents,
  spendSnapshot,
  estimateFor,
  PRICING_VERSION,
} from "../src/lib/writing-review/spend-ledger";
import { randomUUID } from "crypto";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const DAY = new Date().toISOString().slice(0, 10);
const counter = (scope: string, key: string) =>
  (globalThis.__MOCK_DB as any).spendCounters?.[`${scope}|${key}`] ?? { reserved_usd: 0, settled_usd: 0 };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const dayEffective = () =>
  r6(counter("day", DAY).reserved_usd + counter("day", DAY).settled_usd);
const reset = () => {
  (globalThis.__MOCK_DB as any) = {};
};
const op = (units: { unit: string; quantity?: number }[], over: any = {}) => ({
  operationId: randomUUID(), kind: "DETECTION" as const, units,
  actorId: "cons-1",
  ids: { studentId: "stu", applicationId: "app", documentId: "doc", versionId: "ver" },
  ...over,
});
const CEIL = "0.02"; // approved conservative ceiling per unverified unit

async function main() {
  process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  process.env.RYNE_DAILY_BUDGET_USD = "0.10";
  delete process.env.RYNE_TOTAL_BUDGET_USD;
  reset();

  await check("unverified pricing without ceiling → reservation refused", async () => {
    delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
    const out = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(out.kind, "UNPRICED");
    assert.equal(dayEffective(), 0);
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("daily budget: reservations stop at cap, failed attempt reserves nothing", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    const a = await reserveSpend(op([{ unit: "reilaa" }, { unit: "gptzero" }, { unit: "zerogpt" }]));
    assert.equal(a.kind, "RESERVED"); // 3 × 0.02 = 0.06
    const b = await reserveSpend(op([{ unit: "reilaa" }, { unit: "gptzero" }, { unit: "zerogpt" }]));
    assert.equal(b.kind, "OVER_BUDGET");
    if (b.kind === "OVER_BUDGET") assert.equal(b.scope, "day");
    assert.equal(dayEffective(), 0.06);
    assert.equal((globalThis.__MOCK_DB as any).spendEvents && Object.keys((globalThis.__MOCK_DB as any).spendEvents).length, 3);
  });

  await check("total budget enforced atomically on top of daily", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "10";
    process.env.RYNE_TOTAL_BUDGET_USD = "0.05";
    const a = await reserveSpend(op([{ unit: "reilaa" }, { unit: "gptzero" }]));
    assert.equal(a.kind, "RESERVED"); // 0.04 ≤ 0.05
    const b = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(b.kind, "OVER_BUDGET");
    if (b.kind === "OVER_BUDGET") assert.equal(b.scope, "total");
    delete process.env.RYNE_TOTAL_BUDGET_USD;
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
  });

  await check("concurrent distinct operations race for the same budget — cap holds", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "0.05";
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => reserveSpend(op([{ unit: "reilaa" }]))),
    );
    const reserved = outcomes.filter(o => o.kind === "RESERVED").length;
    const over = outcomes.filter(o => o.kind === "OVER_BUDGET").length;
    assert.equal(reserved, 2);   // 2 × 0.02 = 0.04 ≤ 0.05
    assert.equal(over, 3);
    assert.equal(dayEffective(), 0.04);
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
  });

  await check("retry of the SAME operation → FOLLOWER, no second reservation", async () => {
    reset();
    const id = randomUUID();
    const first = await reserveSpend(op([{ unit: "reilaa" }], { operationId: id }));
    assert.equal(first.kind, "RESERVED");
    const retry = await reserveSpend(op([{ unit: "reilaa" }], { operationId: id }));
    assert.equal(retry.kind, "FOLLOWER");
    assert.equal((await getOperationEvents(id)).length, 1);
    assert.equal(dayEffective(), 0.02);
  });

  await check("operation identity: same opId + non-overlapping units concurrently → one wins", async () => {
    reset();
    const opId = randomUUID();
    // The old per-unit unique key allowed BOTH to reserve; the ops
    // claim makes exactly one reservation possible across processes.
    const [a, b] = await Promise.all([
      reserveSpend(op([{ unit: "reilaa" }], { operationId: opId })),
      reserveSpend(op([{ unit: "gptzero" }], { operationId: opId })),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["FOLLOWER", "RESERVED"]);
    const follower = a.kind === "FOLLOWER" ? a : b;
    assert.equal(follower.kind, "FOLLOWER");
    if (follower.kind === "FOLLOWER" && follower.operation) {
      // follower's units are NOT in the stored identity — conflict,
      // not an identical retry; caller must reject it
      assert.equal(["reilaa:1", "gptzero:1"].includes(follower.operation.unitsKey), true);
    }
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1); // only the winner's unit
    assert.equal(dayEffective(), 0.02);
  });

  await check("same opId + different actor → loser follows, no extra spend", async () => {
    const opId = randomUUID();
    const a = await reserveSpend(op([{ unit: "surfer" }], { operationId: opId, actorId: "cons-1" }));
    assert.equal(a.kind, "RESERVED");
    const b = await reserveSpend(op([{ unit: "surfer" }], { operationId: opId, actorId: "cons-2" }));
    assert.equal(b.kind, "FOLLOWER");
    if (b.kind === "FOLLOWER") {
      // stored identity is the winner's — caller compares and rejects
      assert.equal(b.operation?.actorId, "cons-1");
    }
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("identity-conflict loser rolls back fully — counters and events untouched", async () => {
    reset();
    const opId = randomUUID();
    const winner = await reserveSpend(op([{ unit: "reilaa" }, { unit: "gptzero" }], { operationId: opId }));
    assert.equal(winner.kind, "RESERVED");
    const eff0 = dayEffective();
    const loser = await reserveSpend(op([{ unit: "zerogpt" }, { unit: "surfer" }], { operationId: opId }));
    assert.equal(loser.kind, "FOLLOWER");
    assert.equal(dayEffective(), eff0); // nothing added
    assert.equal((await getOperationEvents(opId)).length, 2);
  });

  await check("different opIds reserve independently — legitimate new scans allowed", async () => {
    const a = await reserveSpend(op([{ unit: "reilaa" }]));
    const b = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(a.kind, "RESERVED");
    assert.equal(b.kind, "RESERVED");
  });

  await check("deliberately NEW scan of same document gets its own ledger events", async () => {
    reset();
    const first = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(first.kind, "RESERVED");
    const again = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(again.kind, "RESERVED");
    assert.equal(dayEffective(), 0.04); // two independent operations
  });

  await check("per-unit pricing: word-priced humanizer vs per-request detector, snapshot kept", async () => {
    reset();
    const d = estimateFor("reilaa");
    const h = estimateFor("balanced", 100); // quote $0.008 ≤ ceiling 0.02
    assert.ok(d.ok && h.ok);
    if (d.ok) assert.equal(d.spec.unit, "REQUEST");
    if (h.ok) assert.equal(h.spec.unit, "WORD");
    const out = await reserveSpend(op([{ unit: "balanced", quantity: 100 }], { kind: "HUMANIZER" }));
    assert.equal(out.kind, "RESERVED");
    if (out.kind === "RESERVED") {
      const ev = out.events[0];
      assert.equal(ev.priceUnit, "WORD");
      assert.equal(ev.unitQuantity, 100);
      assert.equal(ev.unitPriceUsd, 0.00008);
      assert.equal(ev.pricingVersion, PRICING_VERSION);
      assert.equal(ev.costBasis, "UNVERIFIED_ESTIMATE");
    }
  });

  await check("quoted humanizer price above approved ceiling → refused", async () => {
    const out = await reserveSpend(op([{ unit: "titan", quantity: 10000 }], { kind: "HUMANIZER" }));
    assert.equal(out.kind, "UNPRICED"); // quote $5.00 > ceiling 0.02
  });

  await check("multi-detector op is all-or-nothing: one bad unit reserves nothing", async () => {
    const before = dayEffective();
    const out = await reserveSpend(op([{ unit: "reilaa" }, { unit: "not-a-detector" }]));
    assert.equal(out.kind, "UNPRICED");
    assert.equal(dayEffective(), before);
  });

  await check("settlement moves reserved→settled with zero net effective change", async () => {
    reset();
    const out = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(out.kind, "RESERVED");
    if (out.kind !== "RESERVED") return;
    const id = out.events[0].id;
    const beforeEff = dayEffective();
    assert.equal(await settleSpend(id, { outcome: "OK" }), true);
    assert.equal(dayEffective(), beforeEff); // moved, not added
    assert.equal(counter("day", DAY).settled_usd, 0.02);
    assert.equal(counter("day", DAY).reserved_usd, 0);
    assert.equal((await getOperationEvents(out.events[0].operationId))[0].status, "SETTLED");
    // terminal — second settle refused
    assert.equal(await settleSpend(id, { outcome: "OK" }), false);
  });

  await check("provider-reported cost overrides estimate in settled accounting", async () => {
    const out = await reserveSpend(op([{ unit: "gptzero" }]));
    assert.equal(out.kind, "RESERVED");
    if (out.kind !== "RESERVED") return;
    const eff0 = dayEffective();
    assert.equal(await settleSpend(out.events[0].id, {
      outcome: "OK", providerCostUsd: 0.05, providerRef: "ryne-req-123",
    }), true);
    // effective = reported 0.05, not estimate 0.02
    assert.equal(dayEffective(), r6(eff0 - 0.02 + 0.05));
    const ev = (await getOperationEvents(out.events[0].operationId))[0];
    assert.equal(ev.costBasis, "PROVIDER_REPORTED");
    assert.equal(ev.providerCostUsd, 0.05);
    assert.equal(ev.providerRef, "ryne-req-123");
  });

  await check("refund releases reservation only for provably unbilled outcomes", async () => {
    const out = await reserveSpend(op([{ unit: "zerogpt" }]));
    assert.equal(out.kind, "RESERVED");
    if (out.kind !== "RESERVED") return;
    const eff0 = dayEffective();
    // wrong proof refused — no counter change, status untouched
    assert.equal(await refundSpend(out.events[0].id, "TIMEOUT" as any), false);
    assert.equal(dayEffective(), eff0);
    assert.equal(await refundSpend(out.events[0].id, "NOT_DISPATCHED"), true);
    assert.equal(dayEffective(), r6(eff0 - 0.02));
  });

  await check("UNKNOWN keeps consuming budget until reconciled, then settles", async () => {
    const out = await reserveSpend(op([{ unit: "quillbot" }]));
    assert.equal(out.kind, "RESERVED");
    if (out.kind !== "RESERVED") return;
    const eff0 = dayEffective();
    assert.equal(await markUnknown(out.events[0].id, "TIMEOUT"), true);
    assert.equal(dayEffective(), eff0); // still counts
    // reconcile later via settle
    assert.equal(await settleSpend(out.events[0].id, { outcome: "RECONCILED_BILLED" }), true);
    assert.equal(dayEffective(), eff0); // moved to settled, still counts
  });

  await check("database failure fails closed — UNAVAILABLE, nothing reserved", async () => {
    (globalThis.__MOCK_DB as any).failConnect = true;
    const out = await reserveSpend(op([{ unit: "surfer" }]));
    assert.equal(out.kind, "UNAVAILABLE");
    delete (globalThis.__MOCK_DB as any).failConnect;
    (globalThis.__MOCK_DB as any).failExec = true;
    assert.equal(await markUnknown("any-id", "TIMEOUT"), false);
    delete (globalThis.__MOCK_DB as any).failExec;
  });

  await check("spend snapshot reports day + total counters as estimates", async () => {
    const snap = await spendSnapshot();
    assert.equal(snap.day.day, DAY);
    assert.ok(snap.day.reservedUsd + snap.day.settledUsd > 0);
    assert.equal(snap.day.limitUsd, 0.10);
    assert.equal(snap.total.limitUsd, null);
    // lifetime counter tracks spend even with no total cap configured
    assert.ok(snap.total.reservedUsd + snap.total.settledUsd > 0);
  });

  await check("effective spend = reserved + settled: settled money still blocks new reservations", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "5";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "4";
    const a = await reserveSpend(op([{ unit: "reilaa" }])); // reserves $4
    assert.equal(a.kind, "RESERVED");
    if (a.kind !== "RESERVED") return;
    assert.equal(await settleSpend(a.events[0].id, { outcome: "OK" }), true); // $4 settled
    assert.equal(dayEffective(), 4);
    // settled 4 + new 3 = 7 > 5 → must refuse (was a bug when only
    // reserved_usd was checked: 0 + 3 ≤ 5 would have passed)
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "3";
    const b = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(b.kind, "OVER_BUDGET");
    assert.equal(dayEffective(), 4);
    // settled 4 + new 1 = 5 ≤ 5 → allowed
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "1";
    const c = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(c.kind, "RESERVED");
    assert.equal(dayEffective(), 5);
    // now at cap: settled 4 + reserved 1 → another $1 must refuse
    const d = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(d.kind, "OVER_BUDGET");
    assert.equal(dayEffective(), 5);
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("combined check applies to the total counter too", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "100";
    process.env.RYNE_TOTAL_BUDGET_USD = "5";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "4";
    const a = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(a.kind, "RESERVED");
    if (a.kind !== "RESERVED") return;
    assert.equal(await settleSpend(a.events[0].id, { outcome: "OK" }), true); // total settled 4
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "3";
    const b = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(b.kind, "OVER_BUDGET");
    if (b.kind === "OVER_BUDGET") assert.equal(b.scope, "total");
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "1";
    const c = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(c.kind, "RESERVED"); // 4 + 1 = 5 ≤ 5 on both scopes
    delete process.env.RYNE_TOTAL_BUDGET_USD;
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("UNKNOWN reservation keeps blocking spend over the cap", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "5";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "4";
    const a = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(a.kind, "RESERVED");
    if (a.kind !== "RESERVED") return;
    assert.equal(await markUnknown(a.events[0].id, "TIMEOUT"), true);
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "2";
    const b = await reserveSpend(op([{ unit: "reilaa" }])); // 4 + 2 > 5
    assert.equal(b.kind, "OVER_BUDGET");
    assert.equal(dayEffective(), 4);
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("concurrent reserves cannot bypass the combined settled+reserved check", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "5";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "3";
    const a = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(a.kind, "RESERVED");
    if (a.kind !== "RESERVED") return;
    assert.equal(await settleSpend(a.events[0].id, { outcome: "OK" }), true); // settled 3
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "2";
    // five concurrent $2 requests, cap 5 with $3 settled → exactly one wins
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => reserveSpend(op([{ unit: "reilaa" }]))),
    );
    assert.equal(outcomes.filter(o => o.kind === "RESERVED").length, 1);
    assert.equal(outcomes.filter(o => o.kind === "OVER_BUDGET").length, 4);
    assert.equal(dayEffective(), 5);
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("provider-reported cost above estimate: real amount recorded, overrun blocks new spend", async () => {
    reset();
    process.env.RYNE_DAILY_BUDGET_USD = "5";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "1";
    const a = await reserveSpend(op([{ unit: "reilaa" }])); // reserves $1
    assert.equal(a.kind, "RESERVED");
    if (a.kind !== "RESERVED") return;
    // provider actually charged $6 — record the truth, never clamp it
    assert.equal(await settleSpend(a.events[0].id, {
      outcome: "OK", providerCostUsd: 6, providerRef: "ryne-req-9",
    }), true);
    assert.equal(counter("day", DAY).settled_usd, 6);
    const ev = (await getOperationEvents(a.events[0].operationId))[0];
    assert.equal(ev.providerCostUsd, 6);
    assert.equal(ev.costBasis, "PROVIDER_REPORTED");
    // overrun is exposed in the snapshot and blocks all new spend
    const snap = await spendSnapshot();
    assert.ok(snap.day.settledUsd > snap.day.limitUsd);
    const b = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(b.kind, "OVER_BUDGET");
    assert.equal(dayEffective(), 6);
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = CEIL;
  });

  await check("guarded transitions: drift below a reservation surfaces instead of clamping", async () => {
    reset();
    const out = await reserveSpend(op([{ unit: "reilaa" }]));
    assert.equal(out.kind, "RESERVED");
    if (out.kind !== "RESERVED") return;
    // simulate counter drift: reservation exists but counter lost it
    (globalThis.__MOCK_DB as any).spendCounters[`day|${DAY}`].reserved_usd = 0.01;
    assert.equal(await settleSpend(out.events[0].id, { outcome: "OK" }), false);
    // transition refused and rolled back — nothing half-settled
    assert.equal((await getOperationEvents(out.events[0].operationId))[0].status, "RESERVED");
    assert.equal(counter("day", DAY).reserved_usd, 0.01);
    assert.equal(counter("day", DAY).settled_usd, 0);
  });

  delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
  delete process.env.RYNE_DAILY_BUDGET_USD;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
