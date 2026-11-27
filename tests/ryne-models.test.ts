/* Ryne model registry + Apex + standalone-module contract tests.
 * Mocked fetch/transport + mocked mysql2 — no network, no paid calls.
 *
 * Run:
 *   NODE_OPTIONS="--import ./tests/mysql2-mock-preload.mjs" \
 *     npx tsx tests/ryne-models.test.ts */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  extractModelSlugs, discoverRyneModels, listRyneModels, listRyneModelsSync,
  normalizeRyneModel, isRyneModel, ryneModelPricePer1k, isModelSlug,
  _resetRyneModelDiscoveryCache, VERIFIED_RYNE_MODELS,
} from "../src/lib/writing-review/ryne-models";
import { runDocumentHumanize, estimateDocumentCostUsd } from "../src/lib/writing-review/document-humanizer";
import { rewriteCostUsd } from "../src/lib/writing-review/rewrite";
import { runnableTools } from "../src/lib/writing-review/detection";
import { listDetectorStatuses } from "../src/lib/writing-review/detectors";
import { standaloneTextError, STANDALONE_MAX_WORDS } from "../src/lib/writing-review/standalone";
import { priceSpec, estimateFor, getOperationEvents } from "../src/lib/writing-review/spend-ledger";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const SOP = [
  "During my Bachelor of Computer Science I built a support chatbot for the admissions office using Python and FastAPI.",
  "It reduced average response times by 40 percent across 3,000 tickets in the first semester.",
].join("\n\n");

async function main() {
  process.env.RYNE_API_KEY = "ryne_sk_test";
  process.env.RYNE_PAID_CALLS_ENABLED = "1";
  delete process.env.RYNE_EXTRA_MODELS;
  delete process.env.RYNE_DAILY_BUDGET_USD;
  delete process.env.RYNE_TOTAL_BUDGET_USD;
  delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
  _resetRyneModelDiscoveryCache();

  // ---------- slug extraction ----------
  await check("extractModelSlugs: strict humanizerMode pairing", () => {
    const doc = `POST body: { "humanizerMode": "nova" } and humanizerMode: "ultra-2" also humanizerMode = 'zen9'`;
    const slugs = extractModelSlugs(doc);
    assert.deepEqual(new Set(slugs), new Set(["nova", "ultra-2", "zen9"]));
  });

  await check("extractModelSlugs: rejects unpaired words and malformed slugs", () => {
    const doc = `the word humanizerMode appears here; someMode: "nova"; "humanizerMode" with no value; humanizerMode: "UPPER"; humanizerMode: "a_underscore"; humanizerMode: "x"`;
    const slugs = extractModelSlugs(doc);
    assert.deepEqual(slugs, []); // "a_underscore" has _, "UPPER" has capitals, "x" too short
  });

  await check("isModelSlug: 2–24 lowercase alnum/hyphen", () => {
    assert.ok(isModelSlug("apex") && isModelSlug("super-nova2") && isModelSlug("ab"));
    assert.ok(!isModelSlug("a") && !isModelSlug("Apex") && !isModelSlug("a_b") && !isModelSlug("x".repeat(25)) && !isModelSlug(42));
  });

  // ---------- discovery ----------
  await check("discoverRyneModels: auto-detects a new documented mode (mocked)", async () => {
    _resetRyneModelDiscoveryCache();
    const fetcher = (async (url: any) => new Response(
      url.includes("changelog")
        ? `<p>v8.1 adds humanizerMode: "nova" for English essays</p>`
        : `<code>{ "text": "...", "humanizerMode": "apex" }</code>`,
      { status: 200 })) as any;
    const models = await discoverRyneModels(fetcher);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "nova");
    assert.equal(models[0].autoDetected, true);
    assert.equal(models[0].pricePer1kUsd, 0.5); // sensible default estimate
  });

  await check("discoverRyneModels: fail-open on fetch failure and bad status", async () => {
    _resetRyneModelDiscoveryCache();
    const dying = (async () => { throw new Error("network down"); }) as any;
    assert.deepEqual(await discoverRyneModels(dying), []);
    _resetRyneModelDiscoveryCache();
    const bad = (async () => new Response("err", { status: 503 })) as any;
    assert.deepEqual(await discoverRyneModels(bad), []);
  });

  await check("discoverRyneModels: 24h cache avoids refetching", async () => {
    _resetRyneModelDiscoveryCache();
    let calls = 0;
    const counting = (async () => { calls++; return new Response('humanizerMode: "nova"', { status: 200 }); }) as any;
    await discoverRyneModels(counting);
    const again = await discoverRyneModels(counting);
    assert.equal(calls, 2); // one call per discovery URL, first pass only
    assert.equal(again[0].id, "nova");
    _resetRyneModelDiscoveryCache();
  });

  // ---------- registry merge ----------
  await check("listRyneModels: verified defaults in priority order", async () => {
    _resetRyneModelDiscoveryCache();
    const models = await listRyneModels(async () => new Response("ok", { status: 200 }) as any);
    assert.deepEqual(models.slice(0, 3).map(m => m.id), ["apex", "titan", "balanced"]);
    assert.equal(models[0].recommended, true);
  });

  await check("listRyneModelsSync: env extras merge and override", () => {
    process.env.RYNE_EXTRA_MODELS = JSON.stringify([
      { id: "nova", label: "Nova", pricePer1k: 0.42, description: "Env added" },
      { id: "balanced", label: "Balanced+", pricePer1k: 0.07 },
      { id: "BAD SLUG", pricePer1k: 1 },
      { id: "noprice" },
    ]);
    const models = listRyneModelsSync();
    const nova = models.find(m => m.id === "nova")!;
    assert.equal(nova.pricePer1kUsd, 0.42);
    assert.equal(nova.label, "Nova");
    assert.equal(models.find(m => m.id === "balanced")!.pricePer1kUsd, 0.07); // override wins
    assert.ok(!models.some(m => m.id === "BAD SLUG" || m.id === "noprice"));
    delete process.env.RYNE_EXTRA_MODELS;
  });

  await check("normalize/isRyneModel: registry-driven validation", () => {
    assert.equal(normalizeRyneModel("apex"), "apex");
    assert.equal(normalizeRyneModel("titan"), "titan");
    assert.equal(normalizeRyneModel("not-a-model"), "balanced"); // lenient fallback, same as before
    assert.equal(normalizeRyneModel(undefined), "balanced");
    assert.ok(isRyneModel("apex") && !isRyneModel("gpt-5"));
  });

  // ---------- pricing ----------
  await check("pricing: apex booked at $0.50/1K like titan", () => {
    assert.equal(ryneModelPricePer1k("apex"), 0.5);
    assert.equal(ryneModelPricePer1k("balanced"), 0.08);
    assert.equal(estimateDocumentCostUsd(1000, "apex"), 0.5);
    assert.equal(estimateDocumentCostUsd(2000, "titan"), 1.0);
    assert.ok(Math.abs(rewriteCostUsd("one two three", "apex") - 0.0015) < 1e-9);
    assert.equal(priceSpec("apex")?.unitPriceUsd, 0.0005);
    assert.equal((estimateFor("apex", 1000) as any).estimatedUsd ?? 0, 0.5);
  });

  await check("pricing: env-added model is bookable through the ledger", () => {
    process.env.RYNE_EXTRA_MODELS = JSON.stringify([{ id: "nova", label: "Nova", pricePer1k: 0.4 }]);
    assert.equal(priceSpec("nova")?.unit, "WORD");
    assert.equal((estimateFor("nova", 500) as any).estimatedUsd ?? 0, 0.2);
    assert.equal(priceSpec("totally-unknown"), null);
    assert.equal((estimateFor("totally-unknown") as any).ok, false);
    delete process.env.RYNE_EXTRA_MODELS;
  });

  // ---------- apex through the humanizer ----------
  const sent: any[] = [];
  const echo = (spec: { status?: number; body?: (t: string) => any } = {}) => (async (_u: any, init: any) => {
    const b = JSON.parse(init.body); sent.push(b);
    const body = spec.body ? spec.body(b.text) : { content: `Rewritten: ${b.text}`, aiScore: 9 };
    return new Response(JSON.stringify(body), { status: spec.status ?? 200 });
  }) as any;

  await check("apex routes humanizerMode 'apex' to Ryne and settles its own ledger unit", async () => {
    (globalThis.__MOCK_DB as any) = {};
    sent.length = 0;
    const opId = randomUUID();
    const out = await runDocumentHumanize({
      content: SOP, versionId: "v1", mode: "apex", confirmPaid: true,
      operationId: opId, actorId: "cons-1", ids: { documentId: "doc" }, fetcher: echo(),
    });
    assert.equal(out.kind, "OK");
    assert.ok(sent.length >= 1 && sent.every(b => b.humanizerMode === "apex" && b.user_id === "ryne_sk_test"));
    const evs = await getOperationEvents(opId);
    assert.ok(evs.some(e => e.requestUnit === "apex"));
  });

  await check("upgrade-required provider error surfaces cleanly with no false spend", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    const out = await runDocumentHumanize({
      content: SOP, versionId: "v1", mode: "apex", confirmPaid: true,
      operationId: opId, actorId: "cons-1", ids: { documentId: "doc" },
      fetcher: echo({ status: 402, body: () => ({ error: true, error_msg: "Upgrade to a paid plan to use Apex" }) }),
    });
    assert.equal(out.kind, "ERROR");
    if (out.kind === "ERROR") assert.match(out.message, /paid plan/i);
    const evs = await getOperationEvents(opId);
    assert.ok(evs.length > 0 && evs.every(e => e.status === "UNKNOWN")); // held for reconciliation, never settled
  });

  // ---------- detectors ----------
  await check("quillbot and originality are no longer runnable", () => {
    const tools = runnableTools();
    assert.deepEqual(tools.sort(), ["gptzero", "reilaa", "surfer", "zerogpt"].sort());
    const statuses = listDetectorStatuses();
    // Legacy entries still exist — rendered UNAVAILABLE, not removed or fabricated.
    for (const d of ["QUILLBOT", "ORIGINALITY"] as const) {
      const s = statuses.find(x => x.detector === d)!;
      assert.equal(s.status, "UNAVAILABLE");
    }
    for (const d of ["GPTZERO", "ZEROGPT", "SURFER", "REILAA"] as const) {
      assert.equal(statuses.find(x => x.detector === d)!.status, "PENDING");
    }
  });

  // ---------- standalone helpers ----------
  await check("standaloneTextError: bounds and limits", () => {
    assert.equal(standaloneTextError("A normal paragraph."), null);
    assert.match(standaloneTextError("") ?? "", /required/);
    assert.match(standaloneTextError("   ") ?? "", /required/);
    assert.match(standaloneTextError(42) ?? "", /required/);
    const huge = Array.from({ length: STANDALONE_MAX_WORDS + 1 }, () => "word").join(" ");
    assert.match(standaloneTextError(huge) ?? "", /word limit/i);
  });

  await check("standalone humanize path reuses runDocumentHumanize without a document row", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const opId = randomUUID();
    const out = await runDocumentHumanize({
      content: SOP, versionId: "standalone", mode: "titan", confirmPaid: true,
      operationId: opId, actorId: "cons-1", ids: { documentId: "standalone" }, fetcher: echo(),
      proofreader: async () => [], // proofreader transport stub — no OpenAI
    });
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      assert.equal(out.result.versionId, "standalone");
      assert.ok(out.result.content.includes("Rewritten:"));
      assert.equal(out.result.proofreadStatus, "NO_CHANGES");
    }
    const evs = await getOperationEvents(opId);
    assert.ok(evs.some(e => e.documentId === "standalone"));
  });

  await check("VERIFIED_RYNE_MODELS stays the offline-safe fallback", () => {
    assert.deepEqual(VERIFIED_RYNE_MODELS.map(m => m.id), ["apex", "titan", "balanced"]);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
