/* Brick 4B-C1 contract tests — runDetection wired to the persistent
 * spend ledger. Mocked transport + mocked mysql2; no network, no DB,
 * no paid calls, no document text in the ledger.
 *
 * Run:
 *   NODE_OPTIONS="--import ./tests/mysql2-mock-preload.mjs" \
 *     npx tsx tests/writing-review-detection-ledger.test.ts */
import assert from "node:assert/strict";
import { runDetection } from "../src/lib/writing-review/detection";
import { getOperationEvents, spendSnapshot } from "../src/lib/writing-review/spend-ledger";
import { randomUUID } from "crypto";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const DOC = "One clear sentence. Another clear sentence. A third sentence here.";
const store = () => globalThis.__MOCK_DB as any;
const events = () => Object.values(store().spendEvents ?? {}) as any[];
const dayKey = new Date().toISOString().slice(0, 10);
const dayCounter = () => store().spendCounters?.[`day|${dayKey}`] ?? { reserved_usd: 0, settled_usd: 0 };
const calls = { n: 0 };

function fetcher(map: Record<string, any>): typeof fetch {
  return (async (_u: any, init: any) => {
    calls.n++;
    const tool = init?.headers?.tool ?? "reilaa";
    const spec = map[tool] ?? { status: 200, body: { source: tool, aiScore: 20, classification: "MIXED", details: { sentences: [] } } };
    if (spec.throw) throw spec.throw;
    return new Response(JSON.stringify(spec.body), { status: spec.status ?? 200 }) as any;
  }) as any;
}

const ok = (tool = "reilaa") => ({ status: 200, body: { source: tool, aiScore: 20, classification: "MIXED", details: { sentences: [] } } });
const opts = (over: any = {}, detectors = ["REILAA"]) => ({
  detectors, confirmPaid: true, baseVersionId: "v1", content: DOC,
  operationId: randomUUID(), actorId: "cons-1",
  ids: { studentId: "stu", applicationId: "app", versionId: "v1" },
  fetcher: fetcher(over.fetchMap ?? {}), ...over,
});

async function main() {
  process.env.RYNE_API_KEY = "ryne_sk_test";
  process.env.RYNE_PAID_CALLS_ENABLED = "1";
  process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "0.02";
  process.env.RYNE_DAILY_BUDGET_USD = "10";

  await check("kill switch OFF → zero provider calls, zero ledger events", async () => {
    process.env.RYNE_PAID_CALLS_ENABLED = "0";
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const out = await runDetection("d-off", opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    assert.equal(events().length, 0);
    process.env.RYNE_PAID_CALLS_ENABLED = "1";
  });

  await check("no API key → zero provider calls, zero reservations", async () => {
    delete process.env.RYNE_API_KEY;
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const out = await runDetection("d-nokey", opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    assert.equal(events().length, 0);
    process.env.RYNE_API_KEY = "ryne_sk_test";
  });

  await check("ledger unreachable → blocked, zero provider calls", async () => {
    (globalThis.__MOCK_DB as any) = {};
    store().failConnect = true;
    calls.n = 0;
    const out = await runDetection("d-nodb", opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.match(out.kind === "NOT_CONFIGURED" ? out.notice : "", /spend ledger unavailable/);
    assert.equal(calls.n, 0);
    delete store().failConnect;
  });

  await check("no verified price and no approved ceiling → blocked, zero calls", async () => {
    delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const out = await runDetection("d-noprice", opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.match(out.kind === "NOT_CONFIGURED" ? out.notice : "", /unverified/);
    assert.equal(calls.n, 0);
    assert.equal(events().length, 0);
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "0.02";
  });

  await check("budget exceeded → OVER_BUDGET, zero provider calls", async () => {
    process.env.RYNE_DAILY_BUDGET_USD = "0.01";
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const out = await runDetection("d-overb", opts());
    assert.equal(out.kind, "OVER_BUDGET");
    assert.equal(calls.n, 0);
    assert.equal(events().length, 0); // rolled back — nothing reserved
    process.env.RYNE_DAILY_BUDGET_USD = "10";
  });

  await check("successful detector → RESERVED then SETTLED, budget moves reserved→settled", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const opId = randomUUID();
    const out = await runDetection("d-settle", opts({ operationId: opId }));
    assert.equal(out.kind, "OK");
    assert.equal(calls.n, 1);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].status, "SETTLED");
    assert.equal(evs[0].requestUnit, "reilaa");
    assert.equal(evs[0].actorId, "cons-1");
    assert.equal(evs[0].documentId, "d-settle");
    assert.equal(evs[0].versionId, "v1");
    assert.equal(evs[0].outcome, "OK");
    assert.equal(dayCounter().settled_usd, 0.02);
    assert.equal(dayCounter().reserved_usd, 0);
    if (out.kind === "OK") assert.equal(out.estimatedCostUsd, 0.02); // internal estimate
  });

  await check("multiple detectors → separate ledger events, all settled", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const opId = randomUUID();
    const out = await runDetection("d-multi", opts({ operationId: opId }, ["REILAA", "GPTZERO", "ZEROGPT"]));
    assert.equal(out.kind, "OK");
    assert.equal(calls.n, 3);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 3);
    assert.deepEqual(evs.map(e => e.requestUnit).sort(), ["gptzero", "reilaa", "zerogpt"]);
    assert.ok(evs.every(e => e.status === "SETTLED"));
    assert.equal(dayCounter().settled_usd, 0.06);
  });

  await check("partial failure → successful detector SETTLED, failed one UNKNOWN (budget retained)", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const opId = randomUUID();
    const out = await runDetection("d-part", opts({
      operationId: opId,
      fetchMap: { reilaa: { status: 500, body: { error: true, error_msg: "provider down" } } },
    }, ["REILAA", "ZEROGPT"]));
    assert.equal(out.kind, "OK"); // per-detector isolation preserved
    const evs = await getOperationEvents(opId);
    const reilaa = evs.find(e => e.requestUnit === "reilaa")!;
    const zerogpt = evs.find(e => e.requestUnit === "zerogpt")!;
    assert.equal(reilaa.status, "UNKNOWN");
    assert.equal(reilaa.outcome, "PROVIDER_ERROR");
    assert.equal(zerogpt.status, "SETTLED");
    // effective consumption: settled 0.02 + unknown-reserved 0.02
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.04);
    // score mapping unchanged — error, not a 0% score
    if (out.kind === "OK") {
      const r = out.detection.scores.find(s => s.detector === "REILAA")!;
      assert.equal(r.status, "ERROR");
      assert.equal(r.scorePercent, undefined);
    }
  });

  await check("timeout → UNKNOWN event, reservation retained", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    const out = await runDetection("d-tmo", opts({
      operationId: opId,
      fetchMap: { reilaa: { throw: Object.assign(new Error("aborted"), { name: "AbortError" }) } },
    }));
    assert.equal(out.kind, "OK");
    const evs = await getOperationEvents(opId);
    assert.equal(evs[0].status, "UNKNOWN");
    assert.equal(evs[0].outcome, "TIMEOUT");
    assert.equal(dayCounter().reserved_usd, 0.02);
  });

  await check("pre-dispatch cancellation → all events REFUNDED, budget released", async () => {
    (globalThis.__MOCK_DB as any) = {};
    let reads = 0;
    // Flips false→true between the entry abort check and the
    // post-reservation pre-dispatch check — deterministic timing.
    const sig = {
      get aborted() { return ++reads > 1; },
      addEventListener() {}, removeEventListener() {},
    } as unknown as AbortSignal;
    const opId = randomUUID();
    calls.n = 0;
    const out = await runDetection("d-predc", opts({ operationId: opId, signal: sig }));
    assert.equal(out.kind, "CANCELLED");
    assert.equal(calls.n, 0);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].status, "REFUNDED");
    assert.equal(evs[0].outcome, "CANCELLED_PRE_SEND");
    assert.equal(dayCounter().reserved_usd, 0);
    assert.equal(dayCounter().settled_usd, 0);
  });

  await check("duplicate operationId after completion → DUPLICATE, no double charge", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    const first = await runDetection("d-dup", opts({ operationId: opId }));
    assert.equal(first.kind, "OK");
    const effAfterFirst = dayCounter().reserved_usd + dayCounter().settled_usd;
    // Jump past cooldown + cache TTL so the retry reaches the ledger —
    // this is the cross-process path (no in-flight entry to share).
    const later = () => Date.now() + 11 * 60 * 1000;
    const retry = await runDetection("d-dup", opts({ operationId: opId, now: later }));
    assert.equal(retry.kind, "DUPLICATE");
    assert.equal(calls.n, 1); // no second provider call
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, effAfterFirst);
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("operationId reused with different detectors → rejected, no charge", async () => {
    const opId = randomUUID();
    const out = await runDetection("d-dup2", opts({ operationId: opId }));
    assert.equal(out.kind, "OK");
    const later = () => Date.now() + 11 * 60 * 1000;
    const retry = await runDetection("d-dup2", opts({ operationId: opId, now: later }, ["GPTZERO"]));
    assert.equal(retry.kind, "DUPLICATE");
    assert.match(retry.kind === "DUPLICATE" ? retry.notice : "", /different request/);
    assert.equal((await getOperationEvents(opId)).length, 1); // still just reilaa
  });

  await check("fresh operationId → legitimate new run reserved separately", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const out = await runDetection("d-fresh", opts({ operationId: randomUUID() }));
    assert.equal(out.kind, "OK");
    const second = await runDetection("d-fresh2", opts({ operationId: randomUUID() }));
    assert.equal(second.kind, "OK");
    assert.equal(calls.n, 2);
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.04); // two runs billed
  });

  await check("concurrent same-opId runs, different detector sets → exactly one bills", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    // Different detector sets (and doc keys, so the per-doc cooldown
    // doesn't preempt) → both reach the ledger; the atomic ops claim
    // serializes them exactly as two Node processes would.
    const [a, b] = await Promise.all([
      runDetection("d-race-a", opts({ operationId: opId }, ["REILAA"])),
      runDetection("d-race-b", opts({ operationId: opId }, ["GPTZERO"])),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["DUPLICATE", "OK"]);
    const dup = a.kind === "DUPLICATE" ? a : b;
    assert.match(dup.kind === "DUPLICATE" ? dup.notice : "", /different request/);
    assert.equal(calls.n, 1); // zero extra provider calls
    assert.equal((await getOperationEvents(opId)).length, 1);
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.02); // zero extra spend
  });

  await check("concurrent same-opId identical params → single charge either way", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    const [a, b] = await Promise.all([
      runDetection("d-race2", opts({ operationId: opId })),
      runDetection("d-race2", opts({ operationId: opId })),
    ]);
    // Cooldown may preempt the follower (RATE_LIMITED) or dedup may
    // share the leader (OK) — both are honest; the invariant is one
    // provider call and one claimed operation.
    assert.ok(a.kind === "OK" || b.kind === "OK");
    assert.ok(["OK", "RATE_LIMITED", "DUPLICATE"].includes(a.kind === "OK" ? b.kind : a.kind));
    assert.equal(calls.n, 1);
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("snapshot exposes ledger totals as estimates after mixed outcomes", async () => {
    const snap = await spendSnapshot();
    assert.ok(snap.day.settledUsd > 0);
    assert.ok(snap.total.reservedUsd + snap.total.settledUsd >= snap.day.reservedUsd + snap.day.settledUsd);
  });

  delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
  delete process.env.RYNE_DAILY_BUDGET_USD;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
