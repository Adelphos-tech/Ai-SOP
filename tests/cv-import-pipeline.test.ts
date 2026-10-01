/**
 * cv-import-pipeline.test.ts — resilient multi-strategy CV import.
 * Deterministic: fake strategies for ordering/coverage logic, real
 * strategies for file fixtures. No provider calls, no profile writes.
 */
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { importResume } from "../src/lib/application/resume-import";
import { evaluateCoverage, chooseBestCandidate, coverageRank } from "../src/lib/application/resume-import/coverage";
import type { ResumeParserStrategy, ResumeParseCandidate, ResumeCoverageStatus } from "../src/lib/application/resume-import/types";
import { createCVParseFailure } from "../src/lib/application/cv-parser";
import type { ParsedCV } from "../src/lib/application/cv-parser";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); });
}

// ---- fakes --------------------------------------------------------------

function fakeParsed(over: Partial<ParsedCV> = {}): ParsedCV {
  return {
    personalData: {},
    education: [], experience: [], projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [] },
    certifications: [], achievements: [],
    rawTextLength: 0, parseWarnings: [],
    ...over,
  };
}

function candidate(strategyId: ResumeParseCandidate["sourceStrategy"], parsed: ParsedCV, rawText: string): ResumeParseCandidate {
  return {
    sourceStrategy: strategyId,
    coverage: evaluateCoverage(parsed, rawText.length),
    diagnostics: { rawTextLength: rawText.length },
    rawText,
    parsed,
    warnings: parsed.parseWarnings || [],
  };
}

const GOOD_PARSED = fakeParsed({
  personalData: { firstName: "Jane", lastName: "Doe", email: "j@x.z" },
  education: [{ institution: "U", degree: "BS", specialization: "CS" } as any],
  experience: [{ organization: "Org", role: "Intern" } as any],
});
const PARTIAL_PARSED = fakeParsed({
  personalData: { email: "j@x.z", phone: "555" },
  education: [{ institution: "U", degree: "BS", specialization: "CS" } as any],
});
const TEXT = "x".repeat(500);

const strategy = (
  id: ResumeParseCandidate["sourceStrategy"],
  parsed: ParsedCV | null,
  raw = TEXT,
): ResumeParserStrategy => ({
  id,
  timeoutMs: 2000,
  parse: async () => {
    if (parsed === null) throw createCVParseFailure("CV_EXTRACTION_FAILED");
    return candidate(id, parsed, raw);
  },
});

const timeoutStrategy: ResumeParserStrategy = {
  id: "MAMMOTH_SEMANTIC",
  timeoutMs: 30,
  parse: () => new Promise(() => {}), // never resolves
};

// ---- tests --------------------------------------------------------------

async function main() {
await check("1: primary GOOD → PARSED, stops early (no fallback)", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", GOOD_PARSED),
    strategy("DOCLING_MAPPER", GOOD_PARSED),
  ]);
  assert.equal(r.state, "PARSED");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.fallbackUsed, false);
});

await check("2: primary throws → fallback GOOD → PARSED", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", null),
    strategy("DOCLING_MAPPER", GOOD_PARSED),
  ]);
  assert.equal(r.state, "PARSED");
  assert.equal(r.fallbackUsed, true);
  assert.equal(r.attempts[0].status, "FAILED");
});

await check("3: primary EXTRACTION_ONLY → fallback still runs", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", fakeParsed(), TEXT),
    strategy("DOCLING_MAPPER", GOOD_PARSED),
  ]);
  assert.equal(r.state, "PARSED");
  assert.equal(r.candidate.sourceStrategy, "DOCLING_MAPPER");
});

await check("4: primary PARTIAL + fallback EXTRACTION_ONLY → keep PARTIAL", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", PARTIAL_PARSED),
    strategy("TEXT_EXTRACTION", fakeParsed()),
  ]);
  assert.equal(r.state, "PARTIAL_PARSE");
  assert.equal(r.candidate.sourceStrategy, "MAMMOTH_SEMANTIC");
});

await check("5: fallback PARTIAL + primary worse → keep fallback", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", fakeParsed()),
    strategy("DOCLING_MAPPER", PARTIAL_PARSED),
  ]);
  assert.equal(r.state, "PARTIAL_PARSE");
  assert.equal(r.candidate.sourceStrategy, "DOCLING_MAPPER");
});

await check("6: all semantic fail but text exists → EXTRACTION_ONLY", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("MAMMOTH_SEMANTIC", null),
    strategy("DOCLING_MAPPER", null),
    strategy("TEXT_EXTRACTION", fakeParsed()),
  ]);
  assert.equal(r.state, "EXTRACTION_ONLY");
  assert.ok(r.candidate.rawText.length > 0);
});

await check("7: every strategy fails → hard fail (FAILED_FILE class)", async () => {
  await assert.rejects(
    () => importResume(Buffer.from("x"), "cv.docx", "docx", [
      strategy("MAMMOTH_SEMANTIC", null),
      strategy("DOCLING_MAPPER", null),
    ]),
    (e: any) => !!e?.code,
  );
});

await check("8: EXTRACTION_ONLY candidate carries no appliable structure", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    strategy("TEXT_EXTRACTION", fakeParsed()),
  ]);
  assert.equal(r.state, "EXTRACTION_ONLY");
  assert.equal(r.candidate.coverage.sectionCount, 0);
  assert.equal(r.candidate.coverage.personalFields, 0);
  // nothing structured → cv-apply path must never see this as data
});

await check("9: stuck strategy times out, next strategy still runs", async () => {
  const r = await importResume(Buffer.from("x"), "cv.docx", "docx", [
    timeoutStrategy,
    strategy("DOCLING_MAPPER", GOOD_PARSED),
  ]);
  assert.equal(r.attempts[0].status, "TIMEOUT");
  assert.equal(r.state, "PARSED");
});

await check("10: coverage classification tiers", () => {
  assert.equal(evaluateCoverage(GOOD_PARSED, TEXT.length).status, "GOOD");
  assert.equal(evaluateCoverage(PARTIAL_PARSED, TEXT.length).status, "PARTIAL");
  assert.equal(evaluateCoverage(fakeParsed(), TEXT.length).status, "EXTRACTION_ONLY");
  assert.equal(evaluateCoverage(fakeParsed(), 0).status, "UNREADABLE");
  assert.ok(coverageRank(evaluateCoverage(GOOD_PARSED, 10)) > coverageRank(evaluateCoverage(PARTIAL_PARSED, 10)));
});

/* ---- real-file regressions (skip when corpus files aren't present) ---- */

const KHUSHI = "/Users/shivang/Desktop/KHUSHI .CV.docx";
const SHIVANG_DOCX = "/Users/shivang/Desktop/cv/Shivang_Singh_Gangwar_Resume.docx";

await check("11: Khushi table-DOCX never dead-ends (≥PARTIAL)", async () => {
  if (!existsSync(KHUSHI)) { console.log("   (skip — corpus file absent)"); return; }
  const buf = await readFile(KHUSHI);
  const r = await importResume(buf, "khushi.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(["PARSED", "PARSED_WITH_WARNINGS", "PARTIAL_PARSE"].includes(r.state),
    `expected ≥PARTIAL, got ${r.state} via ${r.candidate.sourceStrategy}`);
  assert.ok(r.candidate.coverage.sectionCount >= 1);
});

await check("12: Shivang DOCX regression — ≥PARTIAL", async () => {
  if (!existsSync(SHIVANG_DOCX)) { console.log("   (skip — corpus file absent)"); return; }
  const buf = await readFile(SHIVANG_DOCX);
  const r = await importResume(buf, "shivang.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(["PARSED", "PARSED_WITH_WARNINGS", "PARTIAL_PARSE"].includes(r.state));
  assert.ok((r.candidate.parsed.personalData.firstName || "").length > 0);
});

/* ---- committed corpus fixture: generated table-layout DOCX ----------
   The "Khushi class" — headings are Normal-styled text inside table
   cells (zero Word heading styles). Generated at test time via the
   `docx` lib so no binary fixture is committed. Uses only the mammoth
   and text-extraction strategies (docling sidecar not required). */
await check("13: generated table-DOCX (no heading styles) → ≥PARTIAL", async () => {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } = await import("docx");
  const cell = (t: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
  const d = new Document({ sections: [{ children: [
    new Table({ rows: [
      new TableRow({ children: [cell("TEST PERSON"), cell("test@x.z")] }),
      new TableRow({ children: [cell("EDUCATION", true), cell("")] }),
      new TableRow({ children: [cell("State University"), cell("BTech Civil, 2019-2023")] }),
      new TableRow({ children: [cell("SKILLS", true), cell("")] }),
      new TableRow({ children: [cell("AutoCAD"), cell("MATLAB")] }),
    ] }),
  ] }] });
  const buf = await Packer.toBuffer(d);
  const { mammothSemanticStrategy, textExtractionStrategy } = await import("../src/lib/application/resume-import/strategies");
  const r = await importResume(buf, "table.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    [mammothSemanticStrategy, textExtractionStrategy]);
  assert.ok(["PARSED", "PARSED_WITH_WARNINGS", "PARTIAL_PARSE"].includes(r.state),
    `expected ≥PARTIAL, got ${r.state}`);
  assert.ok(r.candidate.coverage.sectionCount >= 1, "at least one section detected");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
main();
