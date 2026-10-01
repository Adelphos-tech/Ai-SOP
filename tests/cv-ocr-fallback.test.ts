/**
 * cv-ocr-fallback.test.ts — free local OCR fallback for image-only resumes.
 *
 * Proves: OCR triggers only when the normal chain yields no usable text;
 * OCR output flows through the same semantic parser + plausibility
 * ranking; failures degrade to stable codes; provenance is explicit.
 *
 * Synthetic cases inject fake strategies — no service needed. Real-corpus
 * cases are gated on file + sidecar availability.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { importResume } from "../src/lib/application/resume-import";
import { evaluateCoverage } from "../src/lib/application/resume-import/coverage";
import { needsOcrFallback } from "../src/lib/application/resume-import/strategies";
import type {
  ResumeParseCandidate, ResumeParserStrategy,
} from "../src/lib/application/resume-import/types";
import type { ParsedCV } from "../src/lib/application/cv-parser";
import { doclingHealth, inspectPdfWithService } from "../src/lib/application/docling-client";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); });
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function emptyParsedCV(): ParsedCV {
  return {
    personalData: {}, education: [], experience: [], projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [] },
    certifications: [], achievements: [],
    rawTextLength: 0, parseWarnings: [],
  };
}

function mkCandidate(
  id: ResumeParseCandidate["sourceStrategy"],
  parsed: ParsedCV,
  rawText: string,
): ResumeParseCandidate {
  return {
    sourceStrategy: id,
    coverage: evaluateCoverage(parsed, rawText.length),
    diagnostics: { rawTextLength: rawText.length },
    rawText, parsed,
    warnings: parsed.parseWarnings || [],
  };
}

/** A strategy that always throws a typed failure. */
function failingStrategy(id: ResumeParserStrategy["id"], code: string): ResumeParserStrategy {
  return {
    id, timeoutMs: 2000,
    async parse() {
      const e: any = new Error(`synthetic ${code}`);
      e.code = code;
      throw e;
    },
  };
}

/** A strategy that returns a fixed candidate. */
function fixedStrategy(id: ResumeParserStrategy["id"], c: ResumeParseCandidate): ResumeParserStrategy {
  return { id, timeoutMs: 2000, async parse() { return c; } };
}

const OCR_TEXT = "x".repeat(500);

async function main() {

/* ---- synthetic: trigger + failure semantics (no service needed) ---- */

await check("A1: OCR not invoked when a normal chain succeeds", async () => {
  const good = mkCandidate("MAMMOTH_SEMANTIC", {
    ...emptyParsedCV(),
    personalData: { firstName: "A", lastName: "B", email: "a@b.c" },
    education: [{ id: "e1", institution: "Uni", degree: "BS", specialization: "CS", startYear: "", endYear: "2020", cgpa: "", cgpaScale: "" }],
    experience: [{ id: "x1", type: "", organization: "Acme", role: "Eng", location: "", startDate: "2020", endDate: "2022", currentlyWorking: false, responsibilities: "" }],
    skills: { technical: ["Welding"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 500, parseWarnings: [],
  } as any, OCR_TEXT);
  let ocrCalled = false;
  const r = await importResume(Buffer.from(OCR_TEXT), "cv.docx", DOCX_MIME,
    [fixedStrategy("MAMMOTH_SEMANTIC", good)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 1000, async parse() { ocrCalled = true; throw new Error("should not run"); } });
  assert.equal(ocrCalled, false);
  assert.equal(r.candidate.sourceStrategy, "MAMMOTH_SEMANTIC");
  assert.ok(!r.ocrRecovered);
});

await check("A2: needsOcrFallback — EXTRACTION_ONLY with real text does NOT trigger", () => {
  const textOnly = mkCandidate("TEXT_EXTRACTION", emptyParsedCV(), OCR_TEXT);
  assert.equal(needsOcrFallback(textOnly, 1), false, "500 chars of real text → no OCR");
  const tiny = mkCandidate("TEXT_EXTRACTION", emptyParsedCV(), "x".repeat(20));
  assert.equal(needsOcrFallback(tiny, 1), true, "near-zero text → OCR");
  assert.equal(needsOcrFallback(null, 0), true, "all strategies threw → OCR");
});

/* ---- A4: image-dominance detection ---- */

const { inspectDocxImages } = await import("../src/lib/application/resume-import/docx-image-inspect");
const JSZip = (await import("jszip")).default;

/** Minimal PNG carrying only an IHDR header with the given dims. */
function fakePng(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.writeUInt32BE(0x49484452, 12); // "IHDR"
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

async function fakeDocx(images: Array<[number, number]>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>");
  zip.file("word/document.xml", "<w:document xmlns:w='x'><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>");
  images.forEach(([w, h], i) => zip.file(`word/media/image${i + 1}.png`, fakePng(w, h)));
  return zip.generateAsync({ type: "nodebuffer" });
}

await check("A4a: inspectDocxImages — page-scan-sized image counts as content", async () => {
  const r = await inspectDocxImages(await fakeDocx([[1240, 1692], [1104, 1625]]));
  assert.equal(r.imageCount, 2);
  assert.equal(r.contentImageCount, 2, "2 MP page scans must be content images");
  assert.ok(r.contentImagePixels > 3_000_000);
});

await check("A4b: inspectDocxImages — logo/icon/small photo are NOT content", async () => {
  const r = await inspectDocxImages(await fakeDocx([[180, 120], [413, 531]]));
  assert.equal(r.imageCount, 2);
  assert.equal(r.contentImageCount, 0, "small logo + passport photo must not count as content");
  const none = await inspectDocxImages(await fakeDocx([]));
  assert.equal(none.imageCount, 0);
});

await check("A4c: needsOcrFallback — imageDominant triggers on non-GOOD; GOOD stays clean", () => {
  // PARTIAL with real text — old trigger said no; image-dominance says yes
  const partial = mkCandidate("MAMMOTH_SEMANTIC", {
    ...emptyParsedCV(),
    personalData: { email: "k@m.x" },
    education: [{ id: "e1", institution: "U", degree: "BS" } as any],
    rawTextLength: 500,
  } as any, "x".repeat(500));
  assert.equal(needsOcrFallback(partial, 1, true), true,
    "image-dominant + partial text → OCR");
  const good = mkCandidate("MAMMOTH_SEMANTIC", {
    ...emptyParsedCV(),
    personalData: { firstName: "A", email: "a@b.c" },
    education: [{ id: "e1", institution: "U", degree: "BS", endYear: "2020" } as any],
    skills: { technical: ["X"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 600,
  } as any, "x".repeat(600));
  assert.equal(needsOcrFallback(good, 1, true), false,
    "GOOD parse never triggers OCR even with images");
});

await check("A4d: mixed image/text DOCX — image-dominant → OCR candidate joins ranking", async () => {
  const buf = await fakeDocx([[1240, 1692]]);
  // XML side yields ~500 chars but thin structure (EXTRACTION_ONLY)
  const xmlCandidate = mkCandidate("TEXT_EXTRACTION", emptyParsedCV(), "x".repeat(500));
  const strongOcr = {
    ...emptyParsedCV(),
    personalData: { firstName: "K", lastName: "M", email: "k@m.x" },
    education: [{ id: "e1", institution: "Indus University", degree: "B.Tech", endYear: "2026" } as any],
    skills: { technical: ["Python", "SQL"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 3000, parseWarnings: [],
    parserMeta: { engine: "rapidocr" as const, ocrUsed: true },
  } as ParsedCV;
  let ocrCalled = false;
  const r = await importResume(buf, "mixed.docx", DOCX_MIME,
    [fixedStrategy("TEXT_EXTRACTION", xmlCandidate)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
      async parse() { ocrCalled = true; return mkCandidate("OCR_TEXT_EXTRACTION", strongOcr, "x".repeat(3000)); } });
  assert.ok(ocrCalled, "OCR must fire on image-dominant DOCX despite ≥40 chars XML text");
  assert.equal(r.candidate.sourceStrategy, "OCR_TEXT_EXTRACTION", "stronger OCR candidate wins on merit");
  assert.equal(r.ocrRecovered, true);
});

/* ---- PDF image-dominance (mixed-content PDF gap) ---- */

const PDF_MIME = "application/pdf";

await check("P1: mixed-content PDF — injected inspector finds content image → OCR fires", async () => {
  const xmlThin = mkCandidate("DOCLING_MAPPER", emptyParsedCV(), "x".repeat(500));
  const strongOcr = {
    ...emptyParsedCV(),
    personalData: { firstName: "P", lastName: "S", email: "p@s.x" },
    education: [{ id: "e1", institution: "MIT-WPU", degree: "B.Tech", endYear: "2023" } as any],
    skills: { technical: ["SQL"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 3000, parseWarnings: [],
    parserMeta: { engine: "rapidocr" as const, ocrUsed: true },
  } as ParsedCV;
  let inspected = false, ocrCalled = false;
  const r = await importResume(Buffer.from("%PDF-mixed"), "mixed.pdf", PDF_MIME,
    [fixedStrategy("DOCLING_MAPPER", xmlThin)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
      async parse() { ocrCalled = true; return mkCandidate("OCR_TEXT_EXTRACTION", strongOcr, "x".repeat(3000)); } },
    async () => { inspected = true; return { contentImageCount: 1 }; });
  assert.ok(inspected, "PDF inspector must be consulted for non-GOOD thin text");
  assert.ok(ocrCalled, "OCR must fire on image-dominant PDF");
  assert.equal(r.candidate.sourceStrategy, "OCR_TEXT_EXTRACTION");
  assert.equal(r.ocrRecovered, true);
});

await check("P2: text PDF + only decorative image (contentImageCount=0) → no OCR", async () => {
  const thin = mkCandidate("DOCLING_MAPPER", emptyParsedCV(), "x".repeat(500));
  let ocrCalled = false;
  const r = await importResume(Buffer.from("%PDF-logo"), "logo.pdf", PDF_MIME,
    [fixedStrategy("DOCLING_MAPPER", thin)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 1000, async parse() { ocrCalled = true; throw new Error("should not run"); } },
    async () => ({ contentImageCount: 0 }));
  assert.equal(ocrCalled, false, "no content images → no OCR");
  assert.equal(r.candidate.sourceStrategy, "DOCLING_MAPPER");
  assert.ok(!r.ocrRecovered);
});

await check("P3: GOOD PDF parse — inspector never consulted, no OCR", async () => {
  const good = mkCandidate("DOCLING_MAPPER", {
    ...emptyParsedCV(),
    personalData: { firstName: "A", lastName: "B", email: "a@b.c" },
    education: [{ id: "e1", institution: "Uni", degree: "BS", endYear: "2020" } as any],
    experience: [{ id: "x1", type: "", organization: "Acme", role: "Eng", startDate: "2020", endDate: "2022" } as any],
    skills: { technical: ["X"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 500, parseWarnings: [],
  } as any, OCR_TEXT);
  let inspected = false;
  const r = await importResume(Buffer.from("%PDF"), "t.pdf", PDF_MIME,
    [fixedStrategy("DOCLING_MAPPER", good)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 1000, async parse() { throw new Error("should not run"); } },
    async () => { inspected = true; return { contentImageCount: 5 }; });
  assert.equal(inspected, false, "GOOD parse must skip PDF inspection entirely");
  assert.equal(r.candidate.sourceStrategy, "DOCLING_MAPPER");
});

await check("P4: no duplicate merge — OCR candidate competes, winner is single canonical", async () => {
  const xmlCandidate = mkCandidate("DOCLING_MAPPER", emptyParsedCV(), "CONFIDENTIAL — Application copy — reference number MX-2024-77 header");
  const weakOcr = {
    ...emptyParsedCV(),
    rawTextLength: 300, parseWarnings: [],
    parserMeta: { engine: "rapidocr" as const, ocrUsed: true },
  } as ParsedCV;
  const r = await importResume(Buffer.from("%PDF"), "m.pdf", PDF_MIME,
    [fixedStrategy("DOCLING_MAPPER", xmlCandidate)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
      async parse() { return mkCandidate("OCR_TEXT_EXTRACTION", weakOcr, "x".repeat(300)); } },
    async () => ({ contentImageCount: 2 }));
  // winner stays ONE candidate — no concatenated rawText
  const validLens = [xmlCandidate.diagnostics.rawTextLength, 300];
  assert.ok(validLens.includes(r.candidate.diagnostics.rawTextLength),
    `winner rawText must come from one candidate, got ${r.candidate.diagnostics.rawTextLength}`);
  assert.ok((r.candidateDiagnostics?.length ?? 0) >= 2, "both candidates ranked");
  assert.equal(r.attempts.filter(a => a.strategy === "OCR_TEXT_EXTRACTION").length, 1);
});

await check("P5: inspector failure degrades safely (no OCR, original winner kept)", async () => {
  const thin = mkCandidate("DOCLING_MAPPER", emptyParsedCV(), "x".repeat(500));
  const r = await importResume(Buffer.from("%PDF"), "m.pdf", PDF_MIME,
    [fixedStrategy("DOCLING_MAPPER", thin)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 1000, async parse() { throw new Error("should not run"); } },
    async () => { throw new Error("inspect service down"); });
  assert.equal(r.candidate.sourceStrategy, "DOCLING_MAPPER", "inspect failure → keep normal winner");
});

await check("A4e: text-rich DOCX + content image but clean GOOD parse → OCR skipped", async () => {
  const buf = await fakeDocx([[1240, 1692]]);
  const good = mkCandidate("MAMMOTH_SEMANTIC", {
    ...emptyParsedCV(),
    personalData: { firstName: "A", lastName: "B", email: "a@b.c" },
    education: [{ id: "e1", institution: "Uni", degree: "BS", endYear: "2020" } as any],
    experience: [{ id: "x1", type: "", organization: "Acme", role: "Eng", startDate: "2020", endDate: "2022" } as any],
    skills: { technical: ["Welding"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 500, parseWarnings: [],
  } as any, OCR_TEXT);
  let ocrCalled = false;
  const r = await importResume(buf, "rich.docx", DOCX_MIME,
    [fixedStrategy("MAMMOTH_SEMANTIC", good)],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 1000, async parse() { ocrCalled = true; throw new Error("nope"); } });
  assert.equal(ocrCalled, false, "cleanly-GOOD parse must not OCR even with a big image");
  assert.equal(r.candidate.sourceStrategy, "MAMMOTH_SEMANTIC");
});

await check("C-sim: OCR invoked when every strategy fails; text flows through pipeline", async () => {
  const ocrParsed = {
    ...emptyParsedCV(),
    personalData: { firstName: "K", lastName: "M", email: "k@m.x" },
    education: [{ id: "e1", institution: "Indus University", degree: "B.Tech", specialization: "CS", startYear: "", endYear: "2026", cgpa: "", cgpaScale: "" }],
    skills: { technical: ["Python", "SQL"], programming: [], tools: [], software: [], domain: [], soft: [] },
    rawTextLength: 4000, parseWarnings: ["OCR_TEXT_RECOVERED"],
    parserMeta: { engine: "rapidocr" as const, ocrUsed: true },
  } as ParsedCV;
  const ocrStrategy: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() { return mkCandidate("OCR_TEXT_EXTRACTION", ocrParsed, "x".repeat(4000)); },
  };
  const r = await importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
    [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT"), failingStrategy("TEXT_EXTRACTION", "CV_EXTRACTION_EMPTY")],
    ocrStrategy);
  assert.equal(r.candidate.sourceStrategy, "OCR_TEXT_EXTRACTION");
  assert.equal(r.ocrRecovered, true);
  assert.equal(r.ocrEngine, "rapidocr");
  assert.ok(r.attempts.some(a => a.strategy === "OCR_TEXT_EXTRACTION" && a.status === "OK"));
  assert.ok(r.state === "PARSED" || r.state === "PARSED_WITH_WARNINGS" || r.state === "PARTIAL_PARSE",
    `OCR candidate must flow through normal pipeline, got ${r.state}`);
});

await check("E: OCR text with zero structure → EXTRACTION_ONLY, not crash", async () => {
  const weakOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() {
      return mkCandidate("OCR_TEXT_EXTRACTION", { ...emptyParsedCV(), rawTextLength: 600 } as ParsedCV, "x".repeat(600));
    },
  };
  const r = await importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
    [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
    weakOcr);
  assert.equal(r.state, "EXTRACTION_ONLY");
  assert.equal(r.candidate.diagnostics.rawTextLength, 600);
});

await check("F1: OCR engine failure → stable CV_OCR_EXTRACTION_FAILED", async () => {
  const badOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() { const e: any = new Error("ocr dead"); e.code = "OCR_SERVICE_ERROR"; throw e; },
  };
  await assert.rejects(
    importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
      [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT"), failingStrategy("TEXT_EXTRACTION", "CV_EXTRACTION_EMPTY")],
      badOcr),
    (e: any) => e?.code === "CV_OCR_EXTRACTION_FAILED",
  );
});

await check("F2: file with NO image content keeps original error (not OCR's)", async () => {
  const noImgOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() { const e: any = new Error("OCR_NO_IMAGE_CONTENT"); e.code = "OCR_NO_IMAGE_CONTENT"; throw e; },
  };
  await assert.rejects(
    importResume(Buffer.from("corrupt"), "corrupt.docx", DOCX_MIME,
      [failingStrategy("MAMMOTH_SEMANTIC", "CV_EXTRACTION_FAILED")],
      noImgOcr),
    (e: any) => e?.code === "CV_EXTRACTION_FAILED",
  );
});

await check("G1: OCR limit exceeded → CV_OCR_LIMIT_EXCEEDED", async () => {
  const bigOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() { const e: any = new Error("too big"); e.code = "OCR_LIMIT_EXCEEDED"; throw e; },
  };
  await assert.rejects(
    importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
      [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
      bigOcr),
    (e: any) => e?.code === "CV_OCR_LIMIT_EXCEEDED",
  );
});

await check("G2: OCR timeout is bounded — attempt logged, stable failure", async () => {
  const slowOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 50,
    async parse() { await new Promise(r => setTimeout(r, 5000)); throw new Error("never"); },
  };
  const t0 = Date.now();
  await assert.rejects(
    importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
      [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
      slowOcr),
    (e: any) => e?.code === "CV_OCR_EXTRACTION_FAILED",
  );
  assert.ok(Date.now() - t0 < 3000, "OCR attempt must be time-bounded");
});

await check("H: OCR candidate ranked normally — no privileged score", async () => {
  // text-extraction candidate with real text (no OCR trigger)... instead
  // craft: chain leaves only near-empty text → OCR fires → OCR candidate
  // is worse than nothing? Ranking always picks ≥1 candidate; assert the
  // OCR candidate participates in candidateDiagnostics like any other.
  const junkOcr: ResumeParserStrategy = {
    id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
    async parse() {
      const p = {
        ...emptyParsedCV(),
        education: Array.from({ length: 12 }, (_, i) => ({
          id: `e${i}`, institution: "", degree: "", specialization: "",
          startYear: "2020", endYear: "2021", cgpa: "", cgpaScale: "",
        })),
        rawTextLength: 600, parseWarnings: [],
      } as ParsedCV;
      return mkCandidate("OCR_TEXT_EXTRACTION", p, "x".repeat(600));
    },
  };
  const r = await importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
    [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
    junkOcr);
  assert.equal(r.candidate.sourceStrategy, "OCR_TEXT_EXTRACTION");
  const wd = (r.candidate as any).candidateDiagnostics;
  assert.ok(wd, "OCR candidate gets diagnostics");
  assert.ok(wd.malformedEducationCount === 12, `all-12 date-only edu records malformed, got ${wd.malformedEducationCount}`);
  assert.equal(wd.plausibleEducationCount, 0);
  // Coverage = section presence; plausibility affects ranking. All-malformed
  // structure → review state, never PARSED.
  assert.ok(["PARTIAL_PARSE", "EXTRACTION_ONLY"].includes(r.state),
    `all-malformed OCR parse must not be PARSED, got ${r.state}`);
});

await check("I: attempts/diagnostics carry no PII — only codes and counts", async () => {
  const r = await importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
    [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
    {
      id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
      async parse() { return mkCandidate("OCR_TEXT_EXTRACTION", emptyParsedCV(), "x".repeat(100)); },
    }).catch(() => null);
  for (const t of [importResume]) {
    void t;
  }
  // inspect attempt log shape from a real result
  const r2 = await importResume(Buffer.from("img"), "img.docx", DOCX_MIME,
    [failingStrategy("MAMMOTH_SEMANTIC", "INSUFFICIENT_TEXT")],
    { id: "OCR_TEXT_EXTRACTION", timeoutMs: 2000,
      async parse() { return mkCandidate("OCR_TEXT_EXTRACTION", emptyParsedCV(), "x".repeat(100)); } });
  for (const a of r2.attempts) {
    assert.deepEqual(Object.keys(a).sort(),
      ["coverage", "durationMs", "status", "strategy"].filter(k =>
        k !== "coverage" || a.coverage !== undefined).sort()
        .concat(a.errorCode !== undefined ? ["errorCode"] : [])
        .sort(),
      `attempt keys must be whitelisted, got ${Object.keys(a)}`);
    assert.equal(typeof a.strategy, "string");
    assert.equal(typeof a.durationMs, "number");
  }
  void r;
});

await check("J: OCR extractor creates no temp files (in-memory only)", () => {
  const src = readFileSync("services/cv-parser/ocr_extract.py", "utf-8");
  assert.ok(!/tempfile|mkstemp|NamedTemporaryFile|open\(.*["']w/.test(src),
    "ocr_extract.py must not write temp files");
  assert.ok(!/subprocess|os\.system|Popen|shell=True/.test(src),
    "ocr_extract.py must not shell out");
});

/* ---- real corpus (gated) ---- */

const KUNJ_IMG_DOCX = "/Users/shivang/Desktop/AI SOP/Test pdf/kunj modh (1) (1).docx";
const MIXED_DOCX = "test-output/affinda/fixtures/synth-mixed-text-image.docx";
const MIXED_PDF = "test-output/affinda/fixtures/synth-mixed-text-image.pdf";
const LOGO_PDF = "test-output/affinda/fixtures/synth-text-plus-logo.pdf";
const SCANNED_PDF = "test-output/affinda/fixtures/synth-scanned.pdf";
const NORMAL_DOCX = "test-output/affinda/fixtures/synth-table.docx";
const NORMAL_PDF = "test-output/affinda/fixtures/synth-singlecol.pdf";
const doclingUp = await doclingHealth();

await check("B: normal DOCX — OCR NOT invoked", async () => {
  if (!existsSync(NORMAL_DOCX) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(NORMAL_DOCX), "t.docx", DOCX_MIME);
  assert.ok(r.attempts.every(a => a.strategy !== "OCR_TEXT_EXTRACTION"),
    "OCR must not fire on text-based DOCX");
  assert.ok(!r.ocrRecovered);
});

await check("B2: normal PDF — OCR fallback NOT invoked", async () => {
  if (!existsSync(NORMAL_PDF) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(NORMAL_PDF), "t.pdf", "application/pdf");
  assert.ok(r.attempts.every(a => a.strategy !== "OCR_TEXT_EXTRACTION"));
});

await check("C: Kunj image-only DOCX → OCR invoked, text recovered, not FAILED_FILE", async () => {
  if (!existsSync(KUNJ_IMG_DOCX) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(KUNJ_IMG_DOCX), "kunj.docx", DOCX_MIME);
  const ocrAttempt = r.attempts.find(a => a.strategy === "OCR_TEXT_EXTRACTION");
  assert.ok(ocrAttempt && ocrAttempt.status === "OK", "OCR must be invoked and succeed");
  assert.equal(r.ocrRecovered, true);
  assert.ok(r.candidate.diagnostics.rawTextLength > 500,
    `meaningful OCR text expected, got ${r.candidate.diagnostics.rawTextLength}`);
  assert.notEqual(r.state, "EXTRACTION_ONLY");
  assert.ok((r.candidate as any).candidateDiagnostics.plausibleEducationCount >= 1,
    "education recovered from images");
});

await check("C2: real mixed text+image DOCX (57 chars XML + page image) → OCR invoked", async () => {
  if (!existsSync(MIXED_DOCX) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(MIXED_DOCX), "mixed.docx", DOCX_MIME);
  const ocrAttempt = r.attempts.find(a => a.strategy === "OCR_TEXT_EXTRACTION");
  assert.ok(ocrAttempt && ocrAttempt.status === "OK",
    "OCR must fire: 57-char XML text + 1240x1692 page image = image-dominant");
  assert.equal(r.ocrRecovered, true);
  assert.ok(r.candidate.diagnostics.rawTextLength > 500);
});

await check("D2: real mixed-content PDF (>10 chars text + page image) → OCR invoked", async () => {
  if (!existsSync(MIXED_PDF) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(MIXED_PDF), "mixed.pdf", "application/pdf");
  const ocrAttempt = r.attempts.find(a => a.strategy === "OCR_TEXT_EXTRACTION");
  assert.ok(ocrAttempt && ocrAttempt.status === "OK",
    "OCR must fire: thin text layer + page-sized CV image = image-dominant");
  assert.equal(r.ocrRecovered, true);
  assert.ok(r.candidate.diagnostics.rawTextLength > 100);
  assert.ok((r.candidate as any).candidateDiagnostics.plausibleEducationCount >= 1,
    "image-borne education recovered");
});

await check("D3: real text+logo PDF — /inspect reports zero content images", async () => {
  if (!existsSync(LOGO_PDF) || !doclingUp) { console.log("   (skip)"); return; }
  const insp = await inspectPdfWithService(await readFile(LOGO_PDF), "logo.pdf");
  assert.equal(insp.imageCount, 1, "logo present");
  assert.equal(insp.contentImageCount, 0, "logo must NOT count as content image");
});

await check("D: scanned PDF → OCR path used, text recovered", async () => {
  if (!existsSync(SCANNED_PDF) || !doclingUp) { console.log("   (skip)"); return; }
  const r = await importResume(await readFile(SCANNED_PDF), "scan.pdf", "application/pdf");
  assert.equal(r.ocrRecovered, true, "scanned PDF must carry ocrRecovered provenance");
  assert.ok(r.candidate.diagnostics.rawTextLength > 100);
  assert.notEqual(r.state, "EXTRACTION_ONLY");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
main();
