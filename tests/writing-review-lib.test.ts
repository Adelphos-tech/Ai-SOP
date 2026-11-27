/**
 * writing-review-lib.test.ts — deterministic checks for the AI Writing
 * Review lib: sentence segmentation offsets, range-anchored revision
 * application, staleness, and honest detector statuses.
 * No DB, no network, no provider calls.
 */
import assert from "node:assert/strict";
import { segmentDocumentSentences, resolvePassageRange } from "../src/lib/writing-review/segmentation";
import { applyApprovedRevisions, passageIsStale } from "../src/lib/writing-review/revisions";
import { listDetectorStatuses, buildAnalysisSummary, computeContentHash, listDetectorDescriptors } from "../src/lib/writing-review/detectors";
import { mapAiScoreResponse, mapSentenceFindings } from "../src/lib/writing-review/ryne-client";
import { isDemoModeAllowed, buildDemoDetection } from "../src/lib/writing-review/fixture";
import type { DocumentRevision, DetectorScore } from "../src/lib/writing-review/types";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const DOC = [
  "My interest in computer science began during my undergraduate studies. Over time, I developed a strong inclination toward software engineering.",
  "The rapidly evolving technological landscape has profoundly shaped my academic aspirations and motivated me to pursue advanced studies in Germany. During my program, I worked on several academic projects.",
  "In the long term, I aim to contribute to the development of innovative technology solutions.",
].join("\n\n");

const sentences = segmentDocumentSentences(DOC);

check("segmentation covers every sentence with real offsets", () => {
  assert.equal(sentences.length, 5);
  sentences.forEach(s => assert.equal(DOC.slice(s.start, s.end), s.text));
});

check("segmentation offsets are ordered and non-overlapping", () => {
  for (let i = 1; i < sentences.length; i++) {
    assert.ok(sentences[i].start >= sentences[i - 1].end);
  }
});

check("paragraph indexes match blank-line split", () => {
  assert.deepEqual(sentences.map(s => s.paragraphIndex), [0, 0, 1, 1, 2]);
});

check("paragraph indexes stay aligned with the render split", () => {
  const withBlank = "One sentence.\n\n\n\nTwo sentence.";
  const s2 = segmentDocumentSentences(withBlank);
  // /\n\s*\n/ collapses runs of blank lines — same split the renderer uses
  assert.deepEqual(s2.map(s => s.paragraphIndex), [0, 1]);
  assert.equal(withBlank.split(/\n\s*\n/).length - 1, s2[s2.length - 1].paragraphIndex);
});

const target = sentences[2];
const rev = (over: Partial<DocumentRevision> = {}): DocumentRevision => ({
  id: "r1",
  passageId: "p1",
  passageStart: target.start,
  passageEnd: target.end,
  originalText: target.text,
  suggestionText: "The tech landscape moved fast, and that pulled me toward advanced study in Germany.",
  status: "APPROVED",
  createdAt: new Date().toISOString(),
  decidedAt: new Date().toISOString(),
  ...over,
});

check("apply rewrites only the anchored range", () => {
  const out = applyApprovedRevisions(DOC, [rev()]);
  assert.equal(out.applied.length, 1);
  const expected = DOC.slice(0, target.start) + rev().suggestionText + DOC.slice(target.end);
  assert.equal(out.content, expected);
});

check("identical text elsewhere is NOT touched", () => {
  const dup = `${DOC}\n\n${target.text}`;
  const out = applyApprovedRevisions(dup, [rev()]);
  const occurrences = out.content.split(target.text).length - 1;
  assert.equal(occurrences, 1); // the second copy survives verbatim
  assert.ok(out.content.endsWith(target.text));
});

check("range re-anchors when earlier edits shift offsets", () => {
  const edited = DOC.replace("computer science", "software systems and more words here");
  const out = applyApprovedRevisions(edited, [rev()]);
  assert.equal(out.applied.length, 1); // unique text found at shifted offset
});

check("conflicting range is skipped, not overwritten", () => {
  const bad = rev({ originalText: "Text that does not exist anywhere." });
  const out = applyApprovedRevisions(DOC, [bad]);
  assert.equal(out.applied.length, 0);
  assert.equal(out.skipped[0].reason, "CONFLICT");
  assert.equal(out.content, DOC);
});

check("rejected revisions never apply", () => {
  const out = applyApprovedRevisions(DOC, [rev({ status: "REJECTED" })]);
  assert.equal(out.applied.length, 0);
  assert.equal(out.content, DOC);
});

check("edited revisions use editedText", () => {
  const out = applyApprovedRevisions(DOC, [rev({ status: "EDITED", editedText: "Manually tuned." })]);
  assert.ok(out.content.includes("Manually tuned."));
  assert.ok(!out.content.includes(rev().suggestionText));
});

check("multiple approved revisions shift offsets correctly", () => {
  const s4 = sentences[4];
  const r2 = rev({ id: "r2", passageId: "p2", passageStart: s4.start, passageEnd: s4.end, originalText: s4.text, suggestionText: "Later, I want to build useful, sustainable tech." });
  const out = applyApprovedRevisions(DOC, [rev(), r2]);
  assert.equal(out.applied.length, 2);
  assert.ok(out.content.includes(rev().suggestionText));
  assert.ok(out.content.includes(r2.suggestionText));
  assert.ok(out.content.includes(sentences[0].text));
});

check("staleness detects edits elsewhere in the document", () => {
  const edited = DOC.replace("computer science", "software systems");
  assert.equal(passageIsStale(edited, {
    id: "p", detector: "REILAA", start: target.start, end: target.end, text: target.text,
  }), false); // passage text still resolves → not stale
  const clobbered = DOC.replace(target.text, "Something entirely different.");
  assert.equal(passageIsStale(clobbered, {
    id: "p", detector: "REILAA", start: target.start, end: target.end, text: target.text,
  }), true);
});

check("resolvePassageRange refuses ambiguous duplicates", () => {
  const dup = `${DOC}\n\n${target.text}`;
  const shifted = resolvePassageRange(dup, { start: target.start + 1, end: target.end + 1, text: target.text });
  assert.equal(shifted, null);
});

check("registry covers every documented Ryne ai-score tool", () => {
  const tools = listDetectorDescriptors().filter(d => d.integration === "RYNE_AI_SCORE").map(d => d.ryneTool).sort();
  assert.deepEqual(tools, ["gptzero", "originality", "quillbot", "reilaa", "surfer", "zerogpt"]);
  assert.equal(listDetectorDescriptors().find(d => d.detector === "TURNITIN")!.integration, "NONE");
});

check("detector statuses are honest without credentials", () => {
  delete process.env.RYNE_API_KEY;
  const d = listDetectorStatuses();
  const turnitin = d.find(x => x.detector === "TURNITIN")!;
  assert.equal(turnitin.status, "UNAVAILABLE");
  d.filter(x => x.detector !== "TURNITIN" && x.detector !== "QUILLBOT" && x.detector !== "ORIGINALITY").forEach(x => {
    assert.ok(["NOT_CONNECTED", "PENDING"].includes(x.status));
    assert.equal(x.scorePercent, undefined);
  });
  // Disabled detectors (verified broken upstream) are honestly UNAVAILABLE.
  for (const x of ["QUILLBOT", "ORIGINALITY"]) {
    assert.equal(d.find(s => s.detector === x)!.status, "UNAVAILABLE");
  }
});

check("analysis summary counts states, never composites a score", () => {
  const none = buildAnalysisSummary(listDetectorStatuses());
  assert.equal(none.scored, 0);
  const scored: DetectorScore[] = [
    { detector: "REILAA", status: "SCORED", scorePercent: 40, classification: "MIXED", granularity: "DOCUMENT" },
    { detector: "GPTZERO", status: "SCORED", scorePercent: 82, classification: "AI_ONLY", granularity: "SENTENCE" },
    { detector: "ZEROGPT", status: "ERROR" },
  ];
  const res = buildAnalysisSummary(scored);
  assert.equal(res.scored, 2);
  assert.equal(res.failed, 1);
  assert.deepEqual(res.documentLevel, ["REILAA"]);
  assert.deepEqual(res.sentenceLevel, ["GPTZERO"]);
});

check("ai-score response mapping preserves source + score semantics", () => {
  const res = mapAiScoreResponse("reilaa", {
    source: "reilaa", aiScore: 15.3, classification: "HUMAN_ONLY",
    details: { rawScore: 0.153, scoreType: "uncalibrated_model_signal", granularity: "document", sentences: [] },
  }, "2026-11-14T00:00:00Z");
  assert.equal(res.status, "SCORED");
  assert.equal(res.detector, "REILAA");
  assert.equal(res.scoreMeaning, "RAW_MODEL_SIGNAL_PERCENT");
  assert.equal(res.granularity, "DOCUMENT");
  assert.equal(res.scorePercent, 15.3);
});

check("fallback score takes the PRODUCING provider's meaning", () => {
  const res = mapAiScoreResponse("reilaa", {
    source: "zerogpt", aiScore: 44, classification: "MIXED",
    fallback: { from: "reilaa", to: "zerogpt" },
  }, "t");
  assert.equal(res.detector, "REILAA");          // card attribution stays requested
  assert.equal(res.scoreMeaning, "AI_PROBABILITY_PERCENT"); // ZeroGPT semantics
});

check("fallback attribution is preserved", () => {
  const res = mapAiScoreResponse("gptzero", {
    source: "zerogpt", aiScore: 44, classification: "MIXED",
    fallback: { from: "gptzero", to: "zerogpt" },
  }, "t");
  assert.equal(res.detector, "GPTZERO");
  assert.equal(res.source, "zerogpt");
  assert.equal(res.fallback?.from, "gptzero");
});

check("provider errors map to ERROR, never a 0% score", () => {
  const res = mapAiScoreResponse("zerogpt", { source: "zerogpt", error: true, error_msg: "insufficient credits" }, "t");
  assert.equal(res.status, "ERROR");
  assert.equal(res.scorePercent, undefined);
  assert.equal(res.error?.retryable, true);
});

check("empty provider responses are ERROR, not SCORED", () => {
  const res = mapAiScoreResponse("zerogpt", {} as any, "t");
  assert.equal(res.status, "ERROR");
  assert.equal(res.scorePercent, undefined);
});

check("sentence findings anchor only unambiguous text", () => {
  const found = mapSentenceFindings(DOC, "REILAA", {
    source: "x",
    details: { sentences: [{ text: target.text, score: 71 }] },
  });
  assert.equal(found.length, 1);
  assert.equal(DOC.slice(found[0].start, found[0].end), target.text);
  assert.equal(found[0].scorePercent, 71);
  const absent = mapSentenceFindings(DOC, "REILAA", {
    source: "x", details: { sentences: [{ text: "Not in the document." }] },
  });
  assert.equal(absent.length, 0);
  const ambiguous = mapSentenceFindings(`${DOC}\n\n${target.text}`, "REILAA", {
    source: "x", details: { sentences: [{ text: target.text }] },
  });
  assert.equal(ambiguous.length, 0);
});

check("document-level responses produce no sentence highlights", () => {
  const res = mapSentenceFindings(DOC, "REILAA", {
    source: "reilaa", aiScore: 15.3, details: { sentences: [] },
  });
  assert.equal(res.length, 0);
});

check("content hash is stable", () => {
  assert.equal(computeContentHash(DOC), computeContentHash(DOC));
  assert.notEqual(computeContentHash(DOC), computeContentHash(DOC + "x"));
});

check("demo fixture is gated out of production", () => {
  assert.equal(isDemoModeAllowed(), process.env.NODE_ENV !== "production");
});

check("demo fixture only flags sentences that exist in the doc", () => {
  const built = buildDemoDetection(DOC, "v1");
  assert.ok(built);
  built!.result.passages.forEach(p => {
    assert.equal(DOC.slice(p.start, p.end), p.text);
    assert.equal(p.detector, "REILAA");
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
