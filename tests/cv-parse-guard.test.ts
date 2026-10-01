/**
 * cv-parse-guard.test.ts — Wave-1 reliability gates for the CV pipeline.
 * Deterministic: ParsedDocument fixtures → real mapper/route helpers.
 * No provider calls, no DB, no filesystem.
 *
 * Covers:
 *   1. Substantial raw text + zero structured sections → CV_PARSE_EMPTY_STRUCTURE
 *   2. DOCX page=null can still extract name (heading-type early block)
 *   3. Sparse fresher CV does NOT falsely fail
 *   4. Error-code granularity (extraction-empty vs semantic-empty vs service-fail)
 */
import assert from "node:assert/strict";
import { mapDoclingToParsedCV } from "../src/lib/application/cv-mapper-docling";
import { normalizeCVErrorCode } from "../src/lib/application/cv-parser";
import type { ParsedDocument, DoclingBlock } from "../src/lib/application/resume-candidate.schema";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

let order = 0;
const blk = (type: string, text: string, page: number | null = null): DoclingBlock =>
  ({ type, text, page, order: order++, bbox: null, level: 0 });
const doc = (blocks: DoclingBlock[]): ParsedDocument => ({ blocks });

/* ---- 1. Table-layout DOCX (no section_header/title blocks) with plenty
        of text → must NOT return success with an empty structure ---- */
check("1: substantial raw text + zero sections → CV_PARSE_EMPTY_STRUCTURE", () => {
  order = 0;
  const d = doc([
    blk("text", "JANE APPLICANT"),
    blk("text", "jane@example.com | +1 555 0100"),
    blk("text", "EXPERIENCE"),
    blk("text", "ACME HOSPITAL /"),
    blk("text", "INTERNSHIP"),
    blk("text", "- NEW YORK, USA (JULY/2022- FEB/2023)"),
    blk("list_item", "Reviewed patient charts and assisted ward rounds daily."),
    blk("list_item", "Supported documentation and multidisciplinary discussions."),
    blk("text", "SKILLS"),
    blk("list_item", "Patient counselling."),
    blk("list_item", "Clinical documentation and reporting."),
    blk("text", "EDUCATIONAL QUALIFICATIONS:"),
    blk("text", "State University – College of Science"),
    blk("list_item", "Bachelor of Science: CGPA 8.1"),
    // pad raw text past the 300-char non-trivial threshold
    blk("list_item", "Additional detail line one of the resume body text."),
    blk("list_item", "Additional detail line two of the resume body text."),
  ]);
  assert.ok(d.blocks.reduce((n, b) => n + b.text.length, 0) > 300);
  let err: any = null;
  try { mapDoclingToParsedCV(d); } catch (e) { err = e; }
  assert.ok(err, "expected a thrown CVParseFailure");
  assert.equal(err.code, "CV_PARSE_EMPTY_STRUCTURE");
  assert.ok(err.userMessage?.length > 10);
  // diagnostics present, content-free
  assert.equal(err.diagnostics?.education, 0);
  assert.equal(err.diagnostics?.experience, 0);
  assert.equal(typeof err.diagnostics?.rawTextLength, "number");
  assert.equal(typeof err.diagnostics?.blockCount, "number");
});

/* ---- 2. DOCX page=null → early heading-type block still yields name ---- */
check("2: DOCX page=null early title block → name extracted", () => {
  order = 0;
  const d = doc([
    blk("title", "JANE DOE"), // page:null, order 0 — the DOCX regression
    blk("text", "jane.doe@example.com"),
    blk("section_header", "EDUCATION"),
    blk("title", "State University"),
    blk("text", "Bachelor of Science in Biology"),
    blk("text", "2019 - 2023"),
  ]);
  const parsed = mapDoclingToParsedCV(d);
  assert.equal(parsed.personalData?.firstName, "Jane");
  assert.equal(parsed.personalData?.lastName, "Doe");
  assert.ok((parsed.education?.length || 0) >= 1, "education entry kept");
});

/* ---- 3. Sparse fresher CV (small, but HAS structure) → no false fail ---- */
check("3: sparse fresher CV with one education record → passes", () => {
  order = 0;
  const d = doc([
    blk("title", "FRESHER TEST", 1),
    blk("text", "fresher@example.com", 1),
    blk("section_header", "EDUCATION", 1),
    blk("title", "City College", 1),
    blk("text", "High School Diploma", 1),
  ]);
  const parsed = mapDoclingToParsedCV(d);
  assert.equal(parsed.personalData?.firstName, "Fresher");
  assert.ok((parsed.education?.length || 0) >= 1);
});

/* ---- 3b. Small file (<300 chars raw) with no sections → passes through,
            NOT an empty-structure failure (gate is for non-trivial docs) ---- */
check("3b: tiny file, no sections → does not throw (below raw threshold)", () => {
  order = 0;
  const d = doc([blk("text", "x@y.z")]);
  const parsed = mapDoclingToParsedCV(d);
  assert.ok(parsed); // no throw — below non-trivial threshold
});

/* ---- 4. Error-code granularity ---- */
check("4a: DOCLING_UNREADABLE 'no readable text' → CV_EXTRACTION_EMPTY", () => {
  assert.equal(normalizeCVErrorCode("DOCLING_UNREADABLE", "No readable text found in document"), "CV_EXTRACTION_EMPTY");
});
check("4b: DOCLING_UNREADABLE other → CV_EXTRACTION_FAILED", () => {
  assert.equal(normalizeCVErrorCode("DOCLING_UNREADABLE", "unexpected container"), "CV_EXTRACTION_FAILED");
});
check("4c: DOCLING_TIMEOUT/UNREACHABLE → CV_EXTRACTION_FAILED", () => {
  assert.equal(normalizeCVErrorCode("DOCLING_TIMEOUT"), "CV_EXTRACTION_FAILED");
  assert.equal(normalizeCVErrorCode("DOCLING_UNREACHABLE"), "CV_EXTRACTION_FAILED");
});
check("4d: typed codes pass through unchanged", () => {
  for (const c of ["CV_FILE_INVALID", "CV_EXTRACTION_EMPTY", "CV_EXTRACTION_FAILED", "CV_PARSE_EMPTY_STRUCTURE", "IMAGE_ONLY_PDF", "PARSE_FAILED"]) {
    assert.equal(normalizeCVErrorCode(c), c);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
