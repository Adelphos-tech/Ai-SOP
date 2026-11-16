/* AI Writing Studio contract tests — document structure, report
 * aggregation and full-document humanization against the ledger.
 * Mocked transport + mocked mysql2; no network, no paid calls.
 *
 * Run:
 *   NODE_OPTIONS="--import ./tests/mysql2-mock-preload.mjs" \
 *     npx tsx tests/writing-studio.test.ts */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  alignRewrite, countSentences, countWords, isHeading, missingDetails, planSections, wordDiff,
} from "../src/lib/writing-review/document-structure";
import { aggregateFindings, beastModeBadge, detectorVerdict, latestVersionScore, primaryScore, type ReportRun } from "../src/lib/writing-review/report";
import { mapSentenceFindings } from "../src/lib/writing-review/ryne-client";
import { segmentDocumentSentences } from "../src/lib/writing-review/segmentation";
import { runDocumentHumanize } from "../src/lib/writing-review/document-humanizer";
import { getOperationEvents } from "../src/lib/writing-review/spend-ledger";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const SOP = [
  "My interest in entrepreneurship began with a simple question. How can a useful idea become a sustainable business?",
  "My grandfather built a textile shop in Jaipur in 1987. His perseverance gave this question personal meaning.",
  "At Stanford University I studied 4 courses in finance. I want to join the MS in Entrepreneurship at USF.",
].join("\n\n");
const WITH_HEADINGS = `Introduction\n\n${SOP}\n\nCareer Goals\n\nI plan to launch a venture within 3 years. It will serve small retailers.`;

async function main() {
  // ---------- structure ----------
  await check("headings are detected; sentences are not", () => {
    assert.equal(isHeading("Career Goals"), true);
    assert.equal(isHeading("I plan to launch a venture."), false);
  });

  await check("plan: headings pass through, body grouped, order preserved", () => {
    const plan = planSections(WITH_HEADINGS);
    assert.ok(plan.ok);
    if (!plan.ok) return;
    assert.deepEqual(plan.sections.map(s => s.kind), ["HEADING", "BODY", "HEADING", "BODY"]);
    assert.equal(plan.sections[1].paragraphs.length, 3);
    assert.equal(plan.sections.flatMap(s => s.paragraphs).join("\n\n"), WITH_HEADINGS);
    assert.ok(!plan.sections[1].text.includes("Introduction"));
  });

  await check("plan: long body splits at paragraph boundaries within limits", () => {
    const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(100).trim() + ".");
    const plan = planSections(paras.join("\n\n"), { maxUnits: 250, maxChars: 100_000 });
    assert.ok(plan.ok);
    if (!plan.ok) return;
    assert.ok(plan.sections.length >= 3);
    assert.deepEqual(plan.sections.flatMap(s => s.paragraphs), paras); // nothing dropped/duplicated/reordered
    for (const s of plan.sections) assert.ok(s.words <= 250);
  });

  await check("plan: a single oversized paragraph is refused, not truncated", () => {
    const plan = planSections("word ".repeat(400) + ".", { maxUnits: 100, maxChars: 100_000 });
    assert.equal(plan.ok, false);
  });

  await check("align: matching paragraphs map 1:1; single-newline fallback; mismatch is flagged", () => {
    const orig = ["A one.", "B two.", "C three."];
    assert.deepEqual(alignRewrite(orig, "X1.\n\nX2.\n\nX3."), { paragraphs: ["X1.", "X2.", "X3."], structureChanged: false });
    assert.deepEqual(alignRewrite(orig, "X1.\nX2.\nX3."), { paragraphs: ["X1.", "X2.", "X3."], structureChanged: false });
    const merged = alignRewrite(orig, "X1. X2.\n\nX3.");
    assert.equal(merged.structureChanged, true);
    assert.equal(merged.paragraphs.join(" "), "X1. X2. X3.");
  });

  await check("diff: unchanged words kept, changes marked on both sides, whitespace exact", () => {
    const d = wordDiff("I began with a simple question.", "I started with a simple question.")!;
    assert.equal(d.left.map(t => t.text).join(""), "I began with a simple question.");
    assert.deepEqual(d.left.filter(t => t.changed).map(t => t.text), ["began"]);
    assert.deepEqual(d.right.filter(t => t.changed).map(t => t.text), ["started"]);
  });

  await check("missing details: names, places and numbers absent from the rewrite are reported", () => {
    const rewritten = SOP.replace("Jaipur", "a northern city").replace("1987", "the eighties");
    const missing = missingDetails(SOP, rewritten);
    assert.ok(missing.includes("Jaipur") && missing.includes("1987"), JSON.stringify(missing));
    assert.ok(!missing.includes("Stanford"));
    assert.deepEqual(missingDetails(SOP, SOP), []);
  });

  // ---------- findings / aggregation ----------
  const sents = segmentDocumentSentences(SOP);
  await check("GPTZero sentence list: only isAI sentences become findings", () => {
    const res: any = { source: "gptzero", aiScore: 90, details: { sentences: sents.map((s, i) => ({ text: s.text, aiProbability: i < 2 ? 99 : 3, isAI: i < 2 })) } };
    const p = mapSentenceFindings(SOP, "GPTZERO", res);
    assert.equal(p.length, 2);
    assert.equal(p[0].scorePercent, 99);
    assert.equal(p[0].isAI, true);
  });

  await check("probability-only sentences flag at ≥50%; duplicates collapse", () => {
    const res: any = { source: "zerogpt", details: { sentences: [
      { text: sents[0].text, score: 80 }, { text: sents[0].text, score: 80 }, { text: sents[1].text, score: 20 },
    ] } };
    assert.equal(mapSentenceFindings(SOP, "ZEROGPT", res).length, 1);
  });

  await check("no verdict and no probability → NOT a finding (regression)", () => {
    const res: any = { source: "gptzero", details: { sentences: [
      { text: sents[0].text },                     // neither verdict nor score → dropped
      { text: sents[1].text, aiProbability: 99 },  // probability ≥50 → kept
      { text: sents[2].text, isAI: true },         // explicit verdict → kept
    ] } };
    const found = mapSentenceFindings(SOP, "GPTZERO", res);
    assert.equal(found.length, 2);
    assert.deepEqual(found.map(p => p.text).sort(), [sents[1].text, sents[2].text].sort());
  });

  await check("conflicting verdict + probability → provider's explicit verdict wins", () => {
    const res: any = { source: "gptzero", details: { sentences: [
      { text: sents[0].text, isAI: false, aiProbability: 95 }, // verdict says human → dropped
      { text: sents[1].text, isAI: true, aiProbability: 12 },  // verdict says AI → kept
    ] } };
    const found = mapSentenceFindings(SOP, "GPTZERO", res);
    assert.equal(found.length, 1);
    assert.equal(found[0].text, sents[1].text);
    assert.equal(found[0].scorePercent, 12);
    assert.equal(found[0].isAI, true);
  });

  await check("same sentence listed twice by one provider (different fields) → one finding", () => {
    const res: any = { source: "gptzero", details: { sentences: [
      { text: sents[0].text, isAI: true }, { text: sents[0].text, aiProbability: 88 },
    ] } };
    assert.equal(mapSentenceFindings(SOP, "GPTZERO", res).length, 1);
  });

  await check("aggregation: same sentence from two detectors = ONE finding listing both", () => {
    const g: any = { details: { sentences: sents.slice(0, 2).map(s => ({ text: s.text, aiProbability: 99, isAI: true })) } };
    const z: any = { details: { sentences: sents.slice(1, 3).map(s => ({ text: s.text, score: 88 })) } };
    const passages = [...mapSentenceFindings(SOP, "GPTZERO", g), ...mapSentenceFindings(SOP, "ZEROGPT", z)];
    assert.equal(passages.length, 4);
    const agg = aggregateFindings(SOP, passages);
    assert.equal(agg.totalSentences, sents.length);
    assert.equal(agg.flaggedSentences, 3); // unique sentences, not 4
    assert.deepEqual(agg.findings[1].detectors.map(d => d.detector).sort(), ["GPTZERO", "ZEROGPT"]);
    assert.equal(agg.findings[1].detectors.find(d => d.detector === "ZEROGPT")?.scorePercent, 88);
  });

  await check("regression: 53-sentence doc, two detectors list every sentence → never >53", () => {
    const doc = Array.from({ length: 53 }, (_, i) => `Sentence number ${i + 1} describes a distinct experience.`).join(" ");
    assert.equal(countSentences(doc), 53);
    const all = segmentDocumentSentences(doc);
    const mk = (flag: (i: number) => boolean): any => ({ details: { sentences: all.map((s, i) => ({ text: s.text, aiProbability: flag(i) ? 97 : 4, isAI: flag(i) })) } });
    const passages = [...mapSentenceFindings(doc, "GPTZERO", mk(i => i % 4 === 0)), ...mapSentenceFindings(doc, "ZEROGPT", mk(i => i % 4 === 0 || i % 5 === 0))];
    const agg = aggregateFindings(doc, passages);
    assert.equal(agg.totalSentences, 53);
    assert.ok(agg.flaggedSentences <= 53);
    assert.equal(agg.flaggedSentences, all.filter((_, i) => i % 4 === 0 || i % 5 === 0).length);
  });

  await check("document-level detectors produce no sentence findings and are listed as such", () => {
    const reilaa: any = { source: "reilaa", aiScore: 35, details: { sentences: [] } };
    assert.equal(mapSentenceFindings(SOP, "REILAA", reilaa).length, 0);
    const agg = aggregateFindings(SOP, [], [{ detector: "REILAA", status: "SCORED", scorePercent: 35 }]);
    assert.deepEqual(agg.documentLevelOnly, ["REILAA"]);
  });

  await check("verdicts use the provider's own classification; no composite score", () => {
    assert.equal(detectorVerdict({ detector: "GPTZERO", status: "SCORED", classification: "AI_ONLY", scorePercent: 100 }), "AI");
    assert.equal(detectorVerdict({ detector: "REILAA", status: "SCORED", classification: "HUMAN_ONLY", scorePercent: 15 }), "HUMAN");
    assert.equal(detectorVerdict({ detector: "ZEROGPT", status: "ERROR" }), null);
  });

  // ---------- compact badge helpers ----------
  await check("primaryScore: GPTZero preferred, errors and scoreless skipped, null when none", () => {
    const scores: any[] = [
      { detector: "ZEROGPT", status: "ERROR" },
      { detector: "REILAA", status: "SCORED", scorePercent: 35 },
      { detector: "GPTZERO", status: "SCORED", scorePercent: 78 },
    ];
    assert.equal(primaryScore(scores)?.detector, "GPTZERO");
    assert.equal(primaryScore(scores, ["REILAA"])?.detector, "REILAA");
    assert.equal(primaryScore([{ detector: "ZEROGPT", status: "ERROR" }] as any), null);
    assert.equal(primaryScore([{ detector: "REILAA", status: "SCORED" }] as any), null); // no numeric score → no badge
  });

  await check("latestVersionScore: hash must match the exact version; newest matching run wins", () => {
    const run = (hash: string, at: string, pct: number): ReportRun => ({
      id: at, checkedAt: at, versionId: "v", contentHash: hash, detectors: ["GPTZERO"],
      detection: { scores: [{ detector: "GPTZERO", status: "SCORED", scorePercent: pct }] } as any,
    });
    const runs = [run("old-hash", "2026-01-01", 90), run("hash-x", "2026-01-02", 78), run("hash-x", "2026-01-03", 55)];
    assert.equal(latestVersionScore(runs, "hash-x")?.scorePercent, 55);
    assert.equal(latestVersionScore(runs, "never-checked"), null); // stale/missing → no badge, Check AI instead
  });

  await check("beastModeBadge: worst section score; undefined when provider returned none", () => {
    assert.equal(beastModeBadge([{ aiScore: 3.1 }, { aiScore: 8.4 }, {}]), 8.4);
    assert.equal(beastModeBadge([{}, {}]), undefined);
  });

  // ---------- full-document humanization ----------
  process.env.RYNE_API_KEY = "ryne_sk_test";
  process.env.RYNE_PAID_CALLS_ENABLED = "1";
  delete process.env.RYNE_DAILY_BUDGET_USD;
  delete process.env.RYNE_TOTAL_BUDGET_USD;
  delete process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD;
  const sent: any[] = [];
  const echo = (spec: { status?: number; body?: (t: string) => any; delayMs?: number } = {}) => (async (_u: any, init: any) => {
    const b = JSON.parse(init.body); sent.push(b);
    if (spec.delayMs) await new Promise(r => setTimeout(r, spec.delayMs));
    const body = spec.body ? spec.body(b.text) : {
      content: b.text.split("\n\n").map((p: string) => `Rewritten: ${p}`).join("\n\n"), aiScore: 7.5,
    };
    return new Response(JSON.stringify(body), { status: spec.status ?? 200 });
  }) as any;
  const base = (over: any = {}) => ({
    content: WITH_HEADINGS, versionId: "v1", mode: "balanced" as const, confirmPaid: true,
    operationId: randomUUID(), actorId: "cons-1", ids: { studentId: "stu", applicationId: "app", documentId: "doc" },
    fetcher: echo(), ...over,
  });

  await check("kill switch off / no consent → zero provider calls", async () => {
    sent.length = 0;
    process.env.RYNE_PAID_CALLS_ENABLED = "0";
    assert.equal((await runDocumentHumanize(base())).kind, "NOT_CONFIGURED");
    process.env.RYNE_PAID_CALLS_ENABLED = "1";
    assert.equal((await runDocumentHumanize(base({ confirmPaid: false }))).kind, "CONSENT_REQUIRED");
    assert.equal(sent.length, 0);
  });

  await check("full document: headings unchanged & not sent, order kept, one settled ledger event", async () => {
    (globalThis.__MOCK_DB as any) = {};
    sent.length = 0;
    const opId = randomUUID();
    const out = await runDocumentHumanize(base({ operationId: opId, mode: "titan" }));
    assert.equal(out.kind, "OK");
    if (out.kind !== "OK") return;
    assert.equal(sent.length, 2); // two body sections
    assert.ok(sent.every(b => b.humanizerMode === "titan" && b.user_id === "ryne_sk_test" && b.shouldStream === false));
    assert.ok(!sent.some(b => b.text.includes("Introduction") || b.text.includes("Career Goals")));
    const paras = out.result.content.split("\n\n");
    assert.equal(paras[0], "Introduction");
    assert.equal(paras[4], "Career Goals");
    assert.ok(paras[1].startsWith("Rewritten: My interest"));
    assert.ok(paras[5].startsWith("Rewritten: I plan"));
    assert.equal(paras.length, WITH_HEADINGS.split("\n\n").length);
    assert.equal(out.result.structureWarnings, 0);
    assert.equal(out.result.sections[1].aiScore, 7.5);
    const evs = await getOperationEvents(opId);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].status, "SETTLED");
    assert.equal(evs[0].requestUnit, "titan");
    assert.equal(evs[0].unitQuantity, out.result.billableWords);
    assert.ok(Math.abs(out.result.estimatedCostUsd - out.result.billableWords / 1000 * 0.5) < 1e-9);
    // The billed/estimated quantity is EVERY sent word across all
    // sections — the whole document, never just one section.
    const sentWords = sent.reduce((n, b) => n + countWords(b.text), 0);
    assert.equal(out.result.billableWords, sentWords);
  });

  await check("paragraph merge by provider → flagged structure change, never silent", async () => {
    const out = await runDocumentHumanize(base({ content: SOP, fetcher: echo({ body: t => ({ content: t.replace(/\n\n/g, " ") }) }) }));
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      assert.equal(out.result.structureWarnings, 1);
      assert.equal(out.result.sections[0].structureChanged, true);
    }
  });

  await check("provider error → ERROR with real message, reservation kept UNKNOWN, no fabricated text", async () => {
    const opId = randomUUID();
    const out = await runDocumentHumanize(base({ operationId: opId, content: SOP,
      fetcher: echo({ status: 400, body: () => ({ error: true, code: "INVALID_REQUEST", error_msg: "Invalid humanizer request." }) }) }));
    assert.equal(out.kind, "ERROR");
    if (out.kind === "ERROR") assert.match(out.message, /Invalid humanizer request/);
    const evs = await getOperationEvents(opId);
    assert.equal(evs[0].status, "UNKNOWN");
  });

  await check("200 with error:true is an error, not content", async () => {
    const out = await runDocumentHumanize(base({ content: SOP, fetcher: echo({ body: () => ({ error: true, error_msg: "Out of credits" }) }) }));
    assert.equal(out.kind, "ERROR");
  });

  await check("duplicate submission (same operationId) → DUPLICATE, no second provider call", async () => {
    sent.length = 0;
    const opId = randomUUID();
    assert.equal((await runDocumentHumanize(base({ operationId: opId, content: SOP }))).kind, "OK");
    assert.equal((await runDocumentHumanize(base({ operationId: opId, content: SOP }))).kind, "DUPLICATE");
    assert.equal(sent.length, 1);
  });

  await check("double click (concurrent same operation) → one provider call, one charge", async () => {
    sent.length = 0;
    const opId = randomUUID();
    const f = echo({ delayMs: 50 });
    const outs = await Promise.all([
      runDocumentHumanize(base({ operationId: opId, content: SOP, fetcher: f })),
      runDocumentHumanize(base({ operationId: opId, content: SOP, fetcher: f })),
    ]);
    assert.ok(outs.every(o => o.kind === "OK"));
    assert.equal(sent.length, 1);
    assert.equal((await getOperationEvents(opId)).length, 1);
  });

  await check("configured budget still enforced → OVER_BUDGET, zero calls", async () => {
    sent.length = 0;
    process.env.RYNE_DAILY_BUDGET_USD = "0.000001";
    const out = await runDocumentHumanize(base({ content: SOP }));
    assert.equal(out.kind, "OVER_BUDGET");
    assert.equal(sent.length, 0);
    delete process.env.RYNE_DAILY_BUDGET_USD;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
