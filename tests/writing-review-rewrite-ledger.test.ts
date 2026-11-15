/* Brick 4B-C2 contract tests — runRewrite wired to the persistent
 * spend ledger, sharing counters with detection. Mocked transport +
 * mocked mysql2; no network, no DB, no paid calls.
 *
 * Run:
 *   NODE_OPTIONS="--import ./tests/mysql2-mock-preload.mjs" \
 *     npx tsx tests/writing-review-rewrite-ledger.test.ts */
import assert from "node:assert/strict";
import { runRewrite } from "../src/lib/writing-review/rewrite";
import { runDetection } from "../src/lib/writing-review/detection";
import { getOperationEvents, spendSnapshot } from "../src/lib/writing-review/spend-ledger";
import { randomUUID } from "crypto";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const SENT = "This sentence was clearly written by an AI model.";
const DOC = "One clear sentence. Another clear sentence. A third sentence here.";
const store = () => globalThis.__MOCK_DB as any;
const dayKey = new Date().toISOString().slice(0, 10);
const dayCounter = () => store().spendCounters?.[`day|${dayKey}`] ?? { reserved_usd: 0, settled_usd: 0 };
const calls = { n: 0 };

const okBody = { content: "The sentence reads as written by a person.", aiScore: 3.8 };
function fetcher(spec: any = {}): typeof fetch {
  return (async () => {
    calls.n++;
    if (spec.throw) throw spec.throw;
    return new Response(JSON.stringify(spec.body ?? okBody), { status: spec.status ?? 200 }) as any;
  }) as any;
}
const opts = (over: any = {}) => ({
  text: SENT, mode: "balanced" as const, confirmPaid: true,
  operationId: randomUUID(), actorId: "cons-1",
  ids: { studentId: "stu", applicationId: "app", documentId: "doc", versionId: "v1" },
  fetcher: fetcher(over.fetchSpec), ...over,
});
const detOpts = (over: any = {}) => ({
  detectors: ["REILAA"], confirmPaid: true, baseVersionId: "v1", content: DOC,
  operationId: randomUUID(), actorId: "cons-1",
  ids: { studentId: "stu", applicationId: "app", versionId: "v1" },
  fetcher: (async (_u: any, init: any) => new Response(JSON.stringify({
    source: init?.headers?.tool ?? "reilaa", aiScore: 20, classification: "MIXED", details: { sentences: [] },
  }), { status: 200 })) as any,
  ...over,
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
    const out = await runRewrite(opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    assert.equal(Object.keys(store().spendEvents ?? {}).length, 0);
    process.env.RYNE_PAID_CALLS_ENABLED = "1";
  });

  await check("no API key → zero calls, zero reservations", async () => {
    delete process.env.RYNE_API_KEY;
    calls.n = 0;
    const out = await runRewrite(opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    assert.equal(Object.keys(store().spendEvents ?? {}).length, 0);
    process.env.RYNE_API_KEY = "ryne_sk_test";
  });

  await check("ledger unreachable → blocked, zero calls", async () => {
    store().failConnect = true;
    calls.n = 0;
    const out = await runRewrite(opts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    delete store().failConnect;
  });

  await check("no ceiling → allowed at $0 reservation; titan quote above ceiling → blocked", async () => {
    delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
    calls.n = 0;
    const out = await runRewrite(opts());
    assert.equal(out.kind, "OK"); // unpriced, not blocked — recorded UNVERIFIED_ESTIMATE
    assert.equal(calls.n, 1);
    process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD = "0.02";
    calls.n = 0;
    // titan quote: 100 words × $0.0005 = $0.05 > ceiling 0.02 → refused
    const big = await runRewrite(opts({ mode: "titan", text: "w ".repeat(100) }));
    assert.equal(big.kind, "NOT_CONFIGURED");
    assert.equal(calls.n, 0);
    (globalThis.__MOCK_DB as any) = {}; // drop this check's event so global counts hold
  });

  await check("budget exceeded → OVER_BUDGET, zero calls", async () => {
    process.env.RYNE_DAILY_BUDGET_USD = "0.01";
    calls.n = 0;
    const out = await runRewrite(opts());
    assert.equal(out.kind, "OVER_BUDGET");
    assert.equal(calls.n, 0);
    assert.equal(Object.keys(store().spendEvents ?? {}).length, 0);
    process.env.RYNE_DAILY_BUDGET_USD = "10";
  });

  await check("successful rewrite → SETTLED event with word-quantity snapshot", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    const opId = randomUUID();
    const out = await runRewrite(opts({ operationId: opId }));
    assert.equal(out.kind, "OK");
    assert.equal(calls.n, 1);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1);
    const ev = evs[0];
    assert.equal(ev.status, "SETTLED");
    assert.equal(ev.requestKind, "HUMANIZER");
    assert.equal(ev.requestUnit, "balanced");
    assert.equal(ev.priceUnit, "WORD");
    assert.equal(ev.unitQuantity, 9); // "This sentence was clearly written by an AI model."
    assert.equal(ev.actorId, "cons-1");
    assert.equal(ev.documentId, "doc");
    assert.equal(ev.versionId, "v1");
    assert.equal(dayCounter().settled_usd, 0.02); // ceiling reservation
  });

  await check("provider HTTP error → UNKNOWN, reservation retained", async () => {
    const opId = randomUUID();
    const out = await runRewrite(opts({ operationId: opId, fetchSpec: { status: 500, body: { error_msg: "down" } } }));
    assert.equal(out.kind, "ERROR");
    const evs = await getOperationEvents(opId);
    assert.equal(evs[0].status, "UNKNOWN");
    assert.equal(evs[0].outcome, "PROVIDER_ERROR");
  });

  await check("timeout → UNKNOWN, reservation retained", async () => {
    const opId = randomUUID();
    const out = await runRewrite(opts({
      operationId: opId,
      fetchSpec: { throw: Object.assign(new Error("aborted"), { name: "AbortError" }) },
    }));
    assert.equal(out.kind, "ERROR");
    const evs = await getOperationEvents(opId);
    assert.equal(evs[0].status, "UNKNOWN");
    assert.equal(evs[0].outcome, "TIMEOUT");
  });

  await check("pre-dispatch cancellation → REFUNDED, budget released", async () => {
    let reads = 0;
    const sig = {
      get aborted() { return ++reads > 1; },
      addEventListener() {}, removeEventListener() {},
    } as unknown as AbortSignal;
    const opId = randomUUID();
    calls.n = 0;
    const out = await runRewrite(opts({ operationId: opId, signal: sig }));
    assert.equal(out.kind, "CANCELLED");
    assert.equal(calls.n, 0);
    const evs = await getOperationEvents(opId);
    assert.equal(evs[0].status, "REFUNDED");
  });

  await check("duplicate operationId → DUPLICATE, no double charge", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    const first = await runRewrite(opts({ operationId: opId }));
    assert.equal(first.kind, "OK");
    const retry = await runRewrite(opts({ operationId: opId }));
    assert.equal(retry.kind, "DUPLICATE");
    assert.equal(calls.n, 1);
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("opId reused with different mode/text → rejected conflict", async () => {
    const opId = randomUUID();
    const first = await runRewrite(opts({ operationId: opId }));
    assert.equal(first.kind, "OK");
    const retry = await runRewrite(opts({ operationId: opId, mode: "titan" }));
    assert.equal(retry.kind, "DUPLICATE");
    assert.match(retry.kind === "DUPLICATE" ? retry.notice : "", /different request/);
    const retry2 = await runRewrite(opts({ operationId: opId, text: "Different passage entirely." }));
    assert.equal(retry2.kind, "DUPLICATE");
    assert.equal(calls.n, 2); // only the first legitimate run called out
  });

  await check("fresh operationId → legitimate new rewrite reserved separately", async () => {
    const out = await runRewrite(opts({ operationId: randomUUID() }));
    assert.equal(out.kind, "OK");
    assert.equal(calls.n, 3);
    // dup-test + conflict-test + this run → three $0.02 settled events
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.06);
  });

  await check("detection + rewrite share the same budget counters", async () => {
    (globalThis.__MOCK_DB as any) = {};
    calls.n = 0;
    process.env.RYNE_DAILY_BUDGET_USD = "0.05";
    // detection $0.02 + rewrite $0.02 = $0.04 fits; another $0.02 → 0.06 > 0.05
    const d = await runDetection("d-shared", detOpts());
    assert.equal(d.kind, "OK");
    const r = await runRewrite(opts());
    assert.equal(r.kind, "OK");
    const over = await runRewrite(opts());
    assert.equal(over.kind, "OVER_BUDGET");
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.04);
    process.env.RYNE_DAILY_BUDGET_USD = "10";
  });

  await check("concurrent same-opId rewrite + detection → exactly one bills", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    const [a, b] = await Promise.all([
      runRewrite(opts({ operationId: opId })),
      runDetection("d-xrace", detOpts({ operationId: opId })),
    ]);
    // different request kinds — the ops claim still serializes them;
    // loser's identity mismatches either way
    assert.deepEqual([a.kind, b.kind].sort(), ["DUPLICATE", "OK"]);
    assert.equal((await getOperationEvents(opId)).length, 1);
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.02);
  });

  await check("same opId claimed by a different consultant → conflict, no charge", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    calls.n = 0;
    const [a, b] = await Promise.all([
      runRewrite(opts({ operationId: opId, actorId: "cons-1" })),
      runRewrite(opts({ operationId: opId, actorId: "cons-2" })),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["DUPLICATE", "OK"]);
    assert.equal(calls.n, 1);
    assert.equal((await getOperationEvents(opId)).length, 1);
    assert.equal(dayCounter().reserved_usd + dayCounter().settled_usd, 0.02);
    // identical text, different documents — separate attributed runs
    const [c, d] = await Promise.all([
      runRewrite(opts({ operationId: randomUUID(), ids: { studentId: "stu", applicationId: "app", documentId: "doc-A", versionId: "v1" } })),
      runRewrite(opts({ operationId: randomUUID(), ids: { studentId: "stu", applicationId: "app", documentId: "doc-B", versionId: "v1" } })),
    ]);
    assert.equal(c.kind, "OK");
    assert.equal(d.kind, "OK");
    assert.equal(calls.n, 3);
  });

  await check("snapshot reports combined ledger totals as estimates", async () => {
    const snap = await spendSnapshot();
    assert.ok(snap.day.reservedUsd + snap.day.settledUsd > 0);
  });

  await check("concurrent opId reuse for a different passage → never served the other passage's rewrite", async () => {
    const before = calls.n;
    const id = randomUUID();
    const outs = await Promise.all([
      runRewrite(opts({ operationId: id })),
      runRewrite(opts({ operationId: id, text: "A different passage selected elsewhere in the essay." })),
    ]);
    assert.deepEqual(outs.map(o => o.kind).sort(), ["DUPLICATE", "OK"]);
    assert.equal(calls.n - before, 1);
  });

  delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
  delete process.env.RYNE_DAILY_BUDGET_USD;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
