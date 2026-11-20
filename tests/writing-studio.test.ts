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
import { aggregateFindings, applySpanEdits, beastModeBadge, detectorVerdict, isReportOutdated, latestVersionScore, mostlyFlagged, primaryScore, type ReportRun } from "../src/lib/writing-review/report";
import { runRewrite } from "../src/lib/writing-review/rewrite";
import { runBatchFix, unstagedTargets, type BatchTarget } from "../src/lib/writing-review/fix-batch";
import { mapSentenceFindings } from "../src/lib/writing-review/ryne-client";
import { listDetectorDescriptors, listDetectorStatuses } from "../src/lib/writing-review/detectors";
import { segmentDocumentSentences } from "../src/lib/writing-review/segmentation";
import { runDocumentHumanize } from "../src/lib/writing-review/document-humanizer";
import { getOperationEvents } from "../src/lib/writing-review/spend-ledger";
import {
  detectorDisplayName, generateDetectionReportPdf, sanitizeForWinAnsi, titleCase, wrapWithOffsets,
} from "../src/lib/writing-review/report-pdf";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";

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
  await check("primaryScore: Ryne AI (Reilaa) preferred, errors and scoreless skipped, null when none", () => {
    const scores: any[] = [
      { detector: "ZEROGPT", status: "ERROR" },
      { detector: "REILAA", status: "SCORED", scorePercent: 35 },
      { detector: "GPTZERO", status: "SCORED", scorePercent: 78 },
    ];
    assert.equal(primaryScore(scores)?.detector, "REILAA");
    assert.equal(primaryScore(scores, ["GPTZERO"])?.detector, "GPTZERO");
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

  await check("latestVersionScore: hash B never displays hash A's score (stale-badge regression)", () => {
    const run = (hash: string, at: string, pct: number): ReportRun => ({
      id: at, checkedAt: at, versionId: `v-${hash}`, contentHash: hash, detectors: ["GPTZERO"],
      detection: { scores: [{ detector: "GPTZERO", status: "SCORED", scorePercent: pct }] } as any,
    });
    // The reported bug shape: original text scored 100, rewrite scored 7.
    const runs = [run("hash-A", "2026-01-01", 100), run("hash-B", "2026-01-02", 7)];
    assert.equal(latestVersionScore(runs, "hash-B")?.scorePercent, 7);
    assert.equal(latestVersionScore(runs, "hash-A")?.scorePercent, 100);
    // A run under a different hash never bleeds into this text's badge.
    assert.equal(latestVersionScore(runs, "hash-C"), null);
  });

  // ---------- detector selector cleanup ----------
  await check("selector pool: only verified runnable detectors; placeholders + broken tools excluded", () => {
    process.env.RYNE_API_KEY = "ryne_sk_test";
    const runnable = listDetectorDescriptors()
      .filter(d => d.integration === "RYNE_AI_SCORE" && d.configured && !d.disabledReason)
      .map(d => d.detector);
    assert.deepEqual([...runnable].sort(), ["GPTZERO", "ORIGINALITY", "QUILLBOT", "REILAA", "SURFER", "ZEROGPT"]);
    // Non-API placeholders stay in the registry/labels but never in
    // the runnable selector pool.
    const all = listDetectorDescriptors().map(d => d.detector);
    assert.ok(all.includes("TURNITIN") && all.includes("RYNE_AI"));
    assert.ok(!runnable.includes("TURNITIN") && !runnable.includes("RYNE_AI"));
    const statuses = listDetectorStatuses();
    assert.equal(statuses.find(s => s.detector === "QUILLBOT")!.status, "PENDING");
    assert.equal(statuses.find(s => s.detector === "ORIGINALITY")!.status, "PENDING");
    assert.equal(statuses.find(s => s.detector === "TURNITIN")!.status, "UNAVAILABLE");
  });

  await check("backward compat: stored run for any detector still yields its badge score", () => {
    const run: ReportRun = {
      id: "r1", checkedAt: "2026-01-01", versionId: "v", contentHash: "h", detectors: ["QUILLBOT"],
      detection: { scores: [{ detector: "QUILLBOT", status: "SCORED", scorePercent: 44 }] } as any,
    };
    // A historical detector score still renders regardless of selector state.
    assert.equal(latestVersionScore([run], "h")?.scorePercent, 44);
    assert.equal(beastModeBadge([{ aiScore: 3.2 }]), 3.2); // Beast Mode badge path untouched
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

  // ---------- sentence fix staging (Brick 2) ----------
  await check("applySpanEdits: multiple edits land on exact offsets regardless of order", () => {
    const base = "Alpha beta. Second sentence here. Third one ends.";
    const sents = segmentDocumentSentences(base); // real spans, as the UI gets them
    assert.equal(sents.length, 3);
    // staged map order is click order (3rd, then 1st, then 2nd) —
    // offsets must still resolve to the right sentences.
    const out = applySpanEdits(base, [
      { start: sents[2].start, end: sents[2].end, replacement: "T3" },
      { start: sents[0].start, end: sents[0].end, replacement: "A1" },
      { start: sents[1].start, end: sents[1].end, replacement: "S2" },
    ]);
    assert.ok(out.ok);
    if (out.ok) assert.equal(out.content, "A1 S2 T3");
  });

  await check("applySpanEdits: duplicate sentences are replaced strictly by span, not by text", () => {
    const base = "Repeat me. Middle part. Repeat me.";
    // Second "Repeat me." starts at 24 — only that instance changes.
    const out = applySpanEdits(base, [{ start: 24, end: 34, replacement: "Changed." }]);
    assert.ok(out.ok);
    if (out.ok) assert.equal(out.content, "Repeat me. Middle part. Changed.");
  });

  await check("applySpanEdits: adjacent spans (end == next start) are allowed", () => {
    const base = "AAA BBB CCC";
    const out = applySpanEdits(base, [
      { start: 0, end: 3, replacement: "X" },
      { start: 4, end: 7, replacement: "Y" },
    ]);
    assert.ok(out.ok);
    if (out.ok) assert.equal(out.content, "X BBB CCC".replace("BBB", "Y").replace(" CCC", " CCC") && "X Y CCC");
    if (out.ok) assert.equal(out.content, "X Y CCC");
  });

  await check("applySpanEdits: overlapping or out-of-bounds spans are rejected, base untouched", () => {
    const base = "Some sentence text.";
    assert.equal(applySpanEdits(base, [
      { start: 0, end: 8, replacement: "a" }, { start: 5, end: 10, replacement: "b" },
    ]).ok, false);
    assert.equal(applySpanEdits(base, [{ start: -1, end: 4, replacement: "x" }]).ok, false);
    assert.equal(applySpanEdits(base, [{ start: 0, end: 100, replacement: "x" }]).ok, false);
  });

  await check("mostlyFlagged: ≥80% threshold only", () => {
    const agg = (f: number, t: number) => aggregateFindings("", [], []).constructor === Object
      ? ({ flaggedSentences: f, totalSentences: t, findings: [], documentLevelOnly: [] } as any) : null;
    assert.equal(mostlyFlagged(agg(4, 5)), true);   // exactly 0.8
    assert.equal(mostlyFlagged(agg(35, 36)), true); // ~0.97
    assert.equal(mostlyFlagged(agg(3, 5)), false);
    assert.equal(mostlyFlagged(agg(0, 0)), false);  // no division by zero
    assert.equal(mostlyFlagged(null), false);
  });

  await check("isReportOutdated: hash mismatch marks run stale → fix/save disabled", () => {
    assert.equal(isReportOutdated({ contentHash: "abc" }, "abc"), false);
    assert.equal(isReportOutdated({ contentHash: "abc" }, "xyz"), true);
    assert.equal(isReportOutdated(null, "xyz"), false);
  });

  await check("single-sentence rewrite: OK returns suggestion; provider error is honest ERROR", async () => {
    (globalThis.__MOCK_DB as any) = {};
    const sentence = "I want to move beyond my current role.";
    const okOut = await runRewrite({
      text: sentence, mode: "balanced", confirmPaid: true, operationId: randomUUID(),
      actorId: "cons-1", ids: { studentId: "stu", applicationId: "app", documentId: "doc" },
      fetcher: (async () => new Response(JSON.stringify({ content: "I aspire to grow beyond my present position.", aiScore: 6.2 }), { status: 200 })) as any,
    });
    assert.equal(okOut.kind, "OK");
    if (okOut.kind === "OK") {
      assert.equal(okOut.suggestion.content, "I aspire to grow beyond my present position.");
      assert.equal(okOut.suggestion.aiScore, 6.2);
      assert.equal(typeof okOut.suggestion.estimatedCostUsd, "number");
    }
    // Same operationId is deduped — a Retry must pass a fresh one.
    const dup = await runRewrite({
      text: sentence, mode: "balanced", confirmPaid: true, operationId: randomUUID(),
      actorId: "cons-1", fetcher: (async () => new Response("{}", { status: 500 })) as any,
    });
    assert.equal(dup.kind, "ERROR");
    if (dup.kind === "ERROR") assert.ok(dup.message.includes("500"));
  });

  // ---------- batch sentence fix (Brick 3) ----------
  const bt = (start: number, text: string): BatchTarget => ({ start, end: start + text.length, text });

  await check("unstagedTargets: already-staged sentences are skipped, rest queued", () => {
    const findings = [bt(0, "one"), bt(10, "two"), bt(20, "three")];
    assert.deepEqual(unstagedTargets(findings, new Set([10])).map(t => t.start), [0, 20]);
  });

  await check("batch: every success is staged individually, no fabrication", async () => {
    const staged = new Map<number, string>();
    const res = await runBatchFix({
      targets: [bt(0, "a"), bt(10, "b"), bt(20, "c")],
      rewrite: async t => ({ ok: true, replacement: `R:${t.text}` }),
      onStaged: (t, r) => staged.set(t.start, r),
    });
    assert.equal(res.staged, 3);
    assert.equal(res.failed.length, 0);
    assert.equal(res.stopped, false);
    assert.equal(staged.get(10), "R:b");
  });

  await check("batch: Stop halts scheduling — completed stays staged, rest untouched", async () => {
    const ac = new AbortController();
    const staged = new Map<number, string>();
    let calls = 0;
    const res = await runBatchFix({
      targets: [bt(0, "a"), bt(10, "b"), bt(20, "c")],
      concurrency: 1,
      signal: ac.signal,
      rewrite: async t => { calls++; return { ok: true, replacement: `R:${t.text}` }; },
      onStaged: (t, r) => { staged.set(t.start, r); ac.abort(); }, // user hits Stop after first lands
    });
    assert.equal(res.stopped, true);
    assert.equal(res.staged, 1);
    assert.equal(calls, 1); // b and c were never billed
  });

  await check("batch: version drift mid-run aborts and discards late results", async () => {
    let drifted = false;
    const staged = new Map<number, string>();
    const res = await runBatchFix({
      targets: [bt(0, "a"), bt(10, "b")],
      concurrency: 1,
      shouldAbort: () => drifted,
      rewrite: async t => { drifted = true; return { ok: true, replacement: `R:${t.text}` }; },
      onStaged: (t, r) => staged.set(t.start, r),
    });
    assert.equal(res.stopped, true);
    assert.equal(staged.size, 0); // drifted result discarded, never staged
  });

  await check("batch: outdated/drift guard blocks the run entirely (zero calls)", async () => {
    let calls = 0;
    const res = await runBatchFix({
      targets: [bt(0, "a")],
      shouldAbort: () => true,
      rewrite: async () => { calls++; return { ok: true as const, replacement: "x" }; },
      onStaged: () => {},
    });
    assert.equal(res.stopped, true);
    assert.equal(calls, 0);
  });

  await check("batch: partial failure keeps successes and exposes failed targets for retry", async () => {
    const staged = new Map<number, string>();
    const res = await runBatchFix({
      targets: [bt(0, "a"), bt(10, "b"), bt(20, "c")],
      rewrite: async t => t.start === 10
        ? { ok: false, error: "Ryne returned HTTP 502" }
        : { ok: true, replacement: `R:${t.text}` },
      onStaged: (t, r) => staged.set(t.start, r),
    });
    assert.equal(res.staged, 2);
    assert.deepEqual(res.failed.map(t => t.start), [10]);
    assert.ok(!staged.has(10)); // nothing fabricated for the failure
  });

  await check("batch: concurrency is bounded (never more than 2 in flight)", async () => {
    let inflight = 0, maxInflight = 0;
    await runBatchFix({
      targets: [bt(0, "a"), bt(1, "b"), bt(2, "c"), bt(3, "d"), bt(4, "e")],
      concurrency: 2,
      rewrite: async t => {
        inflight++; maxInflight = Math.max(maxInflight, inflight);
        await new Promise(r => setTimeout(r, 5));
        inflight--;
        return { ok: true, replacement: t.text };
      },
      onStaged: () => {},
    });
    assert.ok(maxInflight <= 2 && maxInflight > 0);
  });

  // ---------- PDF detection report ----------

  await check("sanitizeForWinAnsi maps Unicode safely and preserves length", () => {
    const raw = "It\u2019s a \u201Cgreat\u201D plan \u2192 move \u2212 one \u200Bstep \u00A0ok \uD83D\uDE80";
    const out = sanitizeForWinAnsi(raw);
    assert.equal(out.length, raw.length); // 1:1 — flagged span offsets stay aligned
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      assert.ok(cp >= 0x20 && cp <= 0xff, `unsafe char ${cp}`);
      assert.ok(![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(cp));
    }
    assert.ok(!out.includes("\u2192") && out.includes(">"));
  });

  await check("wrapWithOffsets keeps exact offsets and wraps at width", () => {
    const text = "the quick brown fox";
    const lines = wrapWithOffsets(text, 9, s => s.length); // monospace stub
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(l => l.text), ["the quick", "brown fox"]);
    assert.equal(text.slice(lines[0].start, lines[0].end), "the quick");
    assert.equal(text.slice(lines[1].start, lines[1].end), "brown fox");
  });

  await check("wrapWithOffsets breaks unbreakable words mid-word", () => {
    const long = "x".repeat(25);
    const lines = wrapWithOffsets(`ok ${long} end`, 10, s => s.length);
    assert.ok(lines.every(l => l.text.length <= 10), "no line overflows");
    assert.ok(lines.some(l => l.text === "x".repeat(10)), "word was split");
    // the portions of each line inside the word's span reconstruct it exactly
    const src = `ok ${long} end`;
    const wordPart = lines.map(l => src.slice(Math.max(l.start, 3), Math.min(l.end, 28))).join("");
    assert.equal(wordPart, long);
  });

  const pdfBase = {
    studentName: "Jane Doe", programLine: "MS CS \u2014 Stanford University",
    documentTitle: "statement of purpose", checkedVersionNumber: 4, currentVersionNumber: 4,
    checkedAt: "2026-02-14T10:30:00.000Z", wordCount: 12, outdated: false,
    timeZone: "Asia/Kolkata",
    scores: [
      { detector: "GPTZERO" as const, status: "SCORED" as const, scorePercent: 82, classification: "AI_ONLY", scoreMeaning: "AI_PROBABILITY_PERCENT" as const, granularity: "SENTENCE" as const },
      { detector: "REILAA" as const, status: "SCORED" as const, scorePercent: 12, classification: "HUMAN_ONLY", scoreMeaning: "AI_PROBABILITY_PERCENT" as const, granularity: "DOCUMENT" as const },
      { detector: "QUILLBOT" as const, status: "ERROR" as const, error: { code: "HTTP" as const, message: "502" } },
    ],
    content: "First sentence is fine. Second sentence was generated entirely by AI tools. Third ends the document.",
  };
  const pdfText = async (buf: Buffer) => (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text;

  await check("PDF: valid current-report document with extracted text", async () => {
    const { buffer, pageCount } = await generateDetectionReportPdf(pdfBase);
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
    assert.ok(buffer.length > 2000);
    assert.ok(pageCount >= 1);
    const text = await pdfText(buffer);
    assert.ok(text.includes("AI Detection Report"));
    assert.ok(text.includes("Jane Doe") && text.includes("Stanford"));
    assert.ok(text.includes("Feb 14, 2026")); // Asia/Kolkata-local date
    assert.ok(text.includes("82%") && text.includes("12%"));
    assert.ok(text.includes("STATEMENT OF PURPOSE")); // uppercase body title
  });

  await check("PDF: no caution box, no sentence findings, no raw detector ids", async () => {
    const text = await pdfText((await generateDetectionReportPdf(pdfBase)).buffer);
    for (const banned of ["Reilaa", "caution", "Caution", "disclaimer", "flagged", "Highlight", "sentences", "probabilistic"])
      assert.ok(!text.includes(banned), `PDF leaked "${banned}"`);
    assert.ok(text.includes("Ryne AI")); // friendly display name
    assert.ok(text.includes("Statement of Purpose")); // Title-Case in card
  });

  await check("PDF: error detector shows Unavailable, never 0%", async () => {
    const text = await pdfText((await generateDetectionReportPdf({
      ...pdfBase, scores: [pdfBase.scores[2]],
    })).buffer);
    assert.ok(text.includes("Unavailable"));
    assert.ok(!text.includes("0%"));
  });

  await check("PDF: outdated run renders Checked-vN note; multi-page body", async () => {
    const longContent = Array.from({ length: 90 }, (_, i) => `Paragraph ${i} of the statement of purpose with enough words to fill several lines of wrapped text output.`).join("\n\n");
    const { buffer, pageCount } = await generateDetectionReportPdf({
      ...pdfBase, outdated: true, currentVersionNumber: 6, content: longContent,
    });
    assert.ok(pageCount >= 2, "long document paginates");
    const text = await pdfText(buffer);
    assert.ok(text.includes("Checked v4"));
    assert.ok(text.includes("Page 2 of"));
  });

  await check("PDF: every detector maps to a display name and a bundled logo file", () => {
    const { DETECTOR_DISPLAY_NAME, getDetectorLogoFile } = require("../src/lib/writing-review/detectors");
    for (const { detector } of listDetectorDescriptors()) {
      assert.ok(DETECTOR_DISPLAY_NAME[detector]?.trim(), `${detector} missing display name`);
      const f = join(process.cwd(), "public", "detector-logos", getDetectorLogoFile(detector));
      assert.ok(existsSync(f), `${detector} missing logo ${getDetectorLogoFile(detector)}`);
    }
  });

  await check("PDF: every detector logo PNG embeds cleanly", async () => {
    const dir = join(process.cwd(), "public", "detector-logos");
    const pngs = readdirSync(dir).filter(f => f.endsWith(".png"));
    assert.ok(pngs.length >= 7, `expected 7 logos, found ${pngs.length}`);
    const doc = await PDFDocument.create();
    for (const f of pngs) await doc.embedPng(readFileSync(join(dir, f))); // throws on invalid PNG
  });

  await check("PDF: friendly display names + Title-Case helpers", () => {
    assert.equal(detectorDisplayName("REILAA"), "Ryne AI");
    assert.equal(detectorDisplayName("QUILLBOT"), "QuillBot");
    assert.equal(titleCase("statement of purpose"), "Statement of Purpose");
    assert.equal(titleCase("sop for university"), "Sop for University");
  });

  await check("generateDetectionReportPdf survives hostile Unicode content", async () => {
    const { buffer } = await generateDetectionReportPdf({
      ...pdfBase,
      content: "Arrows \u2192 minus \u2212 \u201Cquotes\u201D emoji \uD83D\uDE00 zero\u200Bwidth and " + "verylongurl".repeat(30),
    });
    assert.ok(buffer.subarray(0, 5).toString() === "%PDF-");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
