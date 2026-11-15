/* Brick 4B-C2 Part A — real-InnoDB spend-ledger integration tests.
 * Runs against a DISPOSABLE local MySQL database only:
 *   SOP_DB_NAME=sop_ai_app_test SOP_DB_HOST=127.0.0.1 SOP_DB_USER=root \
 *     npx tsx tests/writing-review-ledger-real-mysql.test.ts
 * Every concurrency assertion exercises real InnoDB row locking via
 * separate pool connections (each reserveSpend call checks out its own
 * connection inside one transaction). */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  reserveSpend, settleSpend, markUnknown, refundSpend,
  getOperationEvents, getOperation, spendSnapshot,
} from "../src/lib/writing-review/spend-ledger";
import { getDbPool } from "../src/lib/application/db";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}
const dayKey = new Date().toISOString().slice(0, 10);
const IDS = { studentId: randomUUID(), applicationId: randomUUID(), documentId: randomUUID(), versionId: randomUUID() };

async function reset() {
  const pool = getDbPool();
  // These deletes wipe the whole ledger — only ever in a disposable *_test database.
  const [dbRows] = await pool.execute("SELECT DATABASE() AS db");
  const db = String((dbRows as any[])[0]?.db ?? "");
  if (!db.endsWith("_test")) {
    throw new Error(`Refusing to clear the spend ledger in "${db}": set SOP_DB_NAME to a disposable *_test database.`);
  }
  await pool.execute("DELETE FROM ryne_spend_events");
  await pool.execute("DELETE FROM ryne_spend_operations");
  await pool.execute("DELETE FROM ryne_spend_counters");
}
async function counters() {
  const [rows] = await getDbPool().execute(
    "SELECT scope, scope_key, reserved_usd, settled_usd FROM ryne_spend_counters");
  return Object.fromEntries((rows as any[]).map(r => [`${r.scope}|${r.scope_key}`,
    { reserved: Number(r.reserved_usd), settled: Number(r.settled_usd) }]));
}
const effective = async () => {
  const c = await counters();
  return (c[`day|${dayKey}`]?.reserved ?? 0) + (c[`day|${dayKey}`]?.settled ?? 0);
};

async function main() {
  process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "0.02";
  process.env.RYNE_DAILY_BUDGET_USD = "1000";
  delete process.env.RYNE_TOTAL_BUDGET_USD;
  await reset();

  await check("concurrent same-opId + non-overlapping units → exactly one reserves", async () => {
    await reset();
    const opId = randomUUID();
    const [a, b] = await Promise.all([
      reserveSpend({ operationId: opId, kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS }),
      reserveSpend({ operationId: opId, kind: "DETECTION", units: [{ unit: "gptzero" }], actorId: "c1", ids: IDS }),
    ]);
    const kinds = [a.kind, b.kind].sort();
    assert.deepEqual(kinds, ["FOLLOWER", "RESERVED"]);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1); // real InnoDB PK rejected the loser
    assert.ok(Math.abs(await effective() - 0.02) < 1e-6);
  });

  await check("same opId + identical params → FOLLOWER with winner identity", async () => {
    await reset();
    const opId = randomUUID();
    const first = await reserveSpend({ operationId: opId, kind: "DETECTION", units: [{ unit: "reilaa" }, { unit: "gptzero" }], actorId: "c1", ids: IDS });
    assert.equal(first.kind, "RESERVED");
    const again = await reserveSpend({ operationId: opId, kind: "DETECTION", units: [{ unit: "reilaa" }, { unit: "gptzero" }], actorId: "c1", ids: IDS });
    assert.equal(again.kind, "FOLLOWER");
    const op = await getOperation(opId);
    assert.equal(op?.unitsKey, "gptzero:1,reilaa:1");
    assert.equal((await getOperationEvents(opId)).length, 2);
  });

  await check("different opIds → independent reservations", async () => {
    await reset();
    const [a, b] = await Promise.all([
      reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS }),
      reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c2", ids: IDS }),
    ]);
    assert.equal(a.kind, "RESERVED");
    assert.equal(b.kind, "RESERVED");
    assert.ok(Math.abs(await effective() - 0.04) < 1e-6);
  });

  await check("atomic daily cap under concurrent over-budget attempts", async () => {
    await reset();
    process.env.RYNE_DAILY_BUDGET_USD = "0.10";
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      reserveSpend({ operationId: randomUUID(), kind: "HUMANIZER", units: [{ unit: "balanced", quantity: 10 }], actorId: "c1", ids: IDS })));
    const kinds = results.map(r => r.kind);
    const reserved = kinds.filter(k => k === "RESERVED").length;
    assert.equal(reserved, 5, `expected exactly 5 winners, got ${JSON.stringify(kinds)}`);
    assert.equal(kinds.filter(k => k === "OVER_BUDGET").length, 3);
    const eff = await effective();
    assert.ok(Math.abs(eff - 0.10) < 1e-6, `effective ${eff}`);
    process.env.RYNE_DAILY_BUDGET_USD = "1000";
  });

  await check("detection + humanizer share the same counters", async () => {
    await reset();
    await reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS });
    await reserveSpend({ operationId: randomUUID(), kind: "HUMANIZER", units: [{ unit: "balanced", quantity: 10 }], actorId: "c1", ids: IDS });
    assert.ok(Math.abs(await effective() - 0.04) < 1e-6);
    const snap = await spendSnapshot();
    assert.ok(snap.day.reservedUsd + snap.day.settledUsd >= 0.04 - 1e-6);
  });

  await check("SETTLED moves reserved → settled net-zero; double-settle refused", async () => {
    await reset();
    const res = await reserveSpend({ operationId: randomUUID(), kind: "HUMANIZER", units: [{ unit: "titan", quantity: 10 }], actorId: "c1", ids: IDS });
    if (res.kind !== "RESERVED") { assert.fail("reserve failed"); return; }
    const ev = res.events[0];
    const before = await counters();
    assert.ok(await settleSpend(ev.id, { outcome: "OK" }));
    const after = await counters();
    const d = `day|${dayKey}`;
    assert.ok(Math.abs((before[d].reserved - after[d].reserved) - 0.02) < 1e-6);
    assert.ok(Math.abs((after[d].settled - before[d].settled) - 0.02) < 1e-6);
    assert.equal((await getOperationEvents(res.events[0].operationId))[0].status, "SETTLED");
    assert.equal(await settleSpend(ev.id, { outcome: "OK" }), false);
  });

  await check("provider-reported cost settles at the reported amount", async () => {
    await reset();
    const res = await reserveSpend({ operationId: randomUUID(), kind: "HUMANIZER", units: [{ unit: "balanced", quantity: 10 }], actorId: "c1", ids: IDS });
    if (res.kind !== "RESERVED") { assert.fail("reserve failed"); return; }
    const ev = res.events[0];
    assert.ok(await settleSpend(ev.id, { outcome: "OK", providerCostUsd: 0.03, providerRef: "ryne-test-ref" }));
    const e = (await getOperationEvents(ev.operationId))[0];
    assert.equal(e.settledUsd, 0.03);
    assert.equal(e.costBasis, "PROVIDER_REPORTED");
    assert.equal(e.providerRef, "ryne-test-ref");
    const d = (await counters())[`day|${dayKey}`];
    assert.ok(Math.abs(d.settled - 0.03) < 1e-6, `settled ${d.settled}`);
  });

  await check("UNKNOWN retains budget; REFUNDED releases it", async () => {
    await reset();
    const res = await reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS });
    if (res.kind !== "RESERVED") { assert.fail("reserve failed"); return; }
    const ev = res.events[0];
    const before = await effective();
    assert.ok(await markUnknown(ev.id, "TIMEOUT"));
    assert.ok(Math.abs(await effective() - before) < 1e-6, "UNKNOWN must keep consuming");
    assert.equal((await getOperationEvents(ev.operationId))[0].status, "UNKNOWN");
    const res2 = await reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS });
    if (res2.kind !== "RESERVED") { assert.fail("reserve2 failed"); return; }
    const before2 = await effective();
    assert.ok(await refundSpend(res2.events[0].id, "CANCELLED_PRE_SEND"));
    assert.ok(Math.abs((before2 - await effective()) - 0.02) < 1e-6, "REFUNDED must release");
    assert.equal((await getOperationEvents(res2.events[0].operationId))[0].status, "REFUNDED");
  });

  await check("identity-conflict rollback leaves counters/events untouched", async () => {
    await reset();
    const opId = randomUUID();
    const first = await reserveSpend({ operationId: opId, kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS });
    assert.equal(first.kind, "RESERVED");
    const effBefore = await effective();
    const dup = await reserveSpend({ operationId: opId, kind: "HUMANIZER", units: [{ unit: "balanced", quantity: 5 }], actorId: "c1", ids: IDS });
    assert.equal(dup.kind, "FOLLOWER"); // rolled back before counters
    assert.ok(Math.abs(await effective() - effBefore) < 1e-6);
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("lock contention: 20 parallel reserves serialize without errors", async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "zerogpt" }], actorId: "c1", ids: IDS })));
    const bad = results.filter(r => r.kind !== "RESERVED");
    assert.equal(bad.length, 0, `unexpected: ${bad.map(b => `${b.kind}:${(b as any).message ?? ""}`).join(" | ")}`);
    assert.ok(Math.abs(await effective() - 0.40) < 1e-6);
  });

  await check("mixed reserve+settle contention → no deadlocks, exact accounting", async () => {
    await reset();
    // Seed 5 reserved events, then settle them while 15 new reserves
    // run in parallel — the cross-type lock-order case.
    const seedRes = await Promise.all(Array.from({ length: 5 }, () =>
      reserveSpend({ operationId: randomUUID(), kind: "DETECTION", units: [{ unit: "reilaa" }], actorId: "c1", ids: IDS })));
    const ids = seedRes.flatMap(r => r.kind === "RESERVED" ? r.events.map(e => e.id) : []);
    assert.equal(ids.length, 5);
    const settles = ids.map(id => settleSpend(id, { outcome: "OK" }));
    const reserves = Array.from({ length: 15 }, () =>
      reserveSpend({ operationId: randomUUID(), kind: "HUMANIZER", units: [{ unit: "balanced", quantity: 5 }], actorId: "c1", ids: IDS }));
    const [settleRes, reserveRes] = await Promise.all([Promise.all(settles), Promise.all(reserves)]);
    assert.ok(settleRes.every(Boolean), "a settle failed");
    const bad = reserveRes.filter(r => r.kind !== "RESERVED");
    assert.equal(bad.length, 0, `unexpected: ${bad.map(b => (b as any).message ?? b.kind).join(" | ")}`);
    // 5 settled + 15 still reserved = 0.10 settled, 0.30 reserved
    const c = (await counters())[`day|${dayKey}`];
    assert.ok(Math.abs(c.settled - 0.10) < 1e-6 && Math.abs(c.reserved - 0.30) < 1e-6,
      `day counter ${JSON.stringify(c)}`);
  });

  await check("rows persist across a fresh connection (restart evidence)", async () => {
    const [rows] = await getDbPool().execute("SELECT COUNT(*) n FROM ryne_spend_events");
    assert.ok(Number((rows as any[])[0].n) > 0);
    const snap = await spendSnapshot();
    assert.ok(snap.total.reservedUsd + snap.total.settledUsd > 0);
  });

  // External restart proof: a NEW process must see the same rows.
  const { execSync } = await import("child_process");
  await check("cross-process durability: rows visible to a second process", async () => {
    const out = execSync(
      `SOP_DB_NAME=sop_ai_app_test node -e "const m=require('mysql2/promise');(async()=>{const p=m.createPool({host:'127.0.0.1',user:'root',database:'sop_ai_app_test'});const [r]=await p.execute('SELECT COUNT(*) n FROM ryne_spend_events');console.log(r[0].n);await p.end()})()"`,
      { cwd: process.cwd() }).toString().trim();
    assert.ok(Number(out) > 0, `second process saw ${out} events`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  await getDbPool().end();
  process.exit(fail ? 1 : 0);
}

main();
