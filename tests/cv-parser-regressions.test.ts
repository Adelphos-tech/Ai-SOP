/**
 * cv-parser-regressions.test.ts — Brick CV-2 synthetic regression suite.
 *
 * Covers the generic-mapper defects diagnosed in Brick CV-1 and fixed in
 * CV-2. All fixtures are anonymized synthetic resumes — no real student
 * data.
 *
 *  1. Repeated identical internship titles at different employers
 *  2. Unusual project/certification headings
 *  3. Tab-/multi-space-aligned columns (Mammoth-flattened DOCX layout)
 *  4. Multiple projects with descriptions
 *  5. Publications & patents (title + status lines)
 *  6. Repeated canonical sections (two EXPERIENCE headings)
 *  7. Education month-year ranges ("Jun 2021 – Mar 2023")
 */
import assert from "node:assert/strict";
import { parseCVFromDocument } from "../src/lib/application/cv-parser";
import { deduplicateCanonicalBlocks } from "../src/lib/application/cv-extraction";
import type { ExtractedDocument, TextBlock } from "../src/lib/application/cv-parser";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name} — ${(e as Error).message}`); }
}

const blk = (text: string): TextBlock => ({ text, page: 1, blockType: "paragraph" });
const docOf = (lines: string[]): ExtractedDocument => ({
  blocks: lines.map(blk),
  fullText: lines.join("\n"),
  pageCount: 1,
  extractor: "mammoth",
  ocrUsed: false,
  warnings: [],
});

// ---------------------------------------------------------------- fixture A
// Columnar experience + month-year education + repeated role titles
const RESUME_A = docOf([
  "Jane Example",
  "jane@example.test | +1 555 0100",
  "EXPERIENCE",
  "Alpha Industries | Springfield \t                   Jun 2025 – Aug 2025",
  "Product Design Intern",
  "Built packaging prototypes for three product lines.",
  "Beta Studio | Springfield \t                       May 2024 – Jul 2024",
  "Product Design Intern",
  "Designed onboarding screens for a client web app.",
  "Gamma Works | Springfield \t                       Jan 2024 – Mar 2024",
  "Product Design Intern",
  "Drafted component specs for an internal dashboard.",
  "EDUCATION",
  "State University \t\t\t                    Aug 2022 – May 2026",
  "Bachelor of Design in Industrial Design",
  "CGPA: 8.5",
  "Regional Board of Secondary Education \t\t   Jun 2020 – Mar 2022",
  "Higher Secondary Education – 12th Standard",
  "Percentage: 93.2",
]);

// ---------------------------------------------------------------- fixture B
// Unusual headings + multi-project + publications/patents
const RESUME_B = docOf([
  "John Sample",
  "john@example.test",
  "PROJECT WORK DETAILS",
  "Project One - Smart Irrigation Controller",
  "Description of the project:",
  "Automated drip scheduling using soil-moisture telemetry.",
  "Project Two - Inventory Forecasting Engine",
  "Description of the project:",
  "Time-series demand model reducing stock-outs by 20%.",
  "PUBLICATIONS & PATENTS",
  "Low-Power Sensor Enclosure",
  "Indian Patent Application - Draft under preparation (filing expected Aug. 2027)",
  "Grid Telemetry Unit",
  "Indian Design Registration | Application No. 123456-001 | Registration pending | India | 2026",
  "CERTIFICATION & SPECIALISATION",
  "Intro to Data Science on Coursera",
  "Product Management by ExampleOrg",
  "EXTRA-CURRICULAR ACTIVITIES",
  "Debating society president, 2023-2024",
  "SKILLS",
  "Python, CAD, Figma",
]);

// ---------------------------------------------------------------- fixture C
// Repeated canonical headings (split experience across two sections)
const RESUME_C = docOf([
  "Pat Doe",
  "pat@example.test",
  "EXPERIENCE",
  "Delta Corp | Metroville \t          Jun 2023 – Dec 2023",
  "Research Intern",
  "Analyzed survey datasets for a pilot study.",
  "INTERNSHIPS",
  "Echo Labs | Metroville \t          Jan 2023 – May 2023",
  "Research Intern",
  "Maintained experiment logs and drafted summaries.",
]);

console.log("cv-parser-regressions.test.ts");

// 1. repeated identical role titles at different employers
check("three identical 'Product Design Intern' roles at different employers all kept", () => {
  const r = parseCVFromDocument(RESUME_A);
  assert.equal(r.experience.length, 3);
  const roles = r.experience.map(e => e.role);
  assert.deepEqual(roles, ["Product Design Intern", "Product Design Intern", "Product Design Intern"]);
  const orgs = r.experience.map(e => e.organization);
  assert.ok(orgs.includes("Alpha Industries") && orgs.includes("Beta Studio") && orgs.includes("Gamma Works"));
});

// 2. columnar org|location + date, role on next line
check("pipe-separated org/location and next-line role extracted", () => {
  const r = parseCVFromDocument(RESUME_A);
  const e = r.experience[0];
  assert.equal(e.organization, "Alpha Industries");
  assert.equal(e.role, "Product Design Intern");
  assert.equal(e.startDate, "2025-06");
  assert.equal(e.endDate, "2025-08");
});

// 3. tab-aligned education columns — institution clean, no date glue
check("tab-aligned education: institution has no appended dates", () => {
  const r = parseCVFromDocument(RESUME_A);
  assert.equal(r.education.length, 2);
  assert.equal(r.education[0].institution, "State University");
  assert.ok(!/\d{4}/.test(r.education[0].institution));
  assert.equal(r.education[1].institution, "Regional Board of Secondary Education");
});

// 4. month-year ranges produce both start and end years
check("education month-year range yields startYear and endYear", () => {
  const r = parseCVFromDocument(RESUME_A);
  assert.equal(r.education[0].startYear, "2022");
  assert.equal(r.education[0].endYear, "2026");
  assert.equal(r.education[1].startYear, "2020");
  assert.equal(r.education[1].endYear, "2022");
});

// 5. unusual headings route to canonical sections
check("PROJECT WORK DETAILS / CERTIFICATION & SPECIALISATION / PUBLICATIONS & PATENTS classified", () => {
  const r = parseCVFromDocument(RESUME_B);
  assert.equal(r.projects.length, 2);
  assert.equal(r.certifications.length, 2);
  assert.equal((r.publications || []).length, 2);
});

// 6. projects keep full title and pick up description lines
check("projects keep 'Name - Subtitle' titles and descriptions", () => {
  const r = parseCVFromDocument(RESUME_B);
  assert.equal(r.projects[0].name, "Project One - Smart Irrigation Controller");
  assert.ok(r.projects[0].description.includes("soil-moisture"));
});

// 7. publications preserve title + raw status, never fabricated
check("publication records preserve title and verbatim status", () => {
  const r = parseCVFromDocument(RESUME_B);
  const pubs = r.publications || [];
  const patent = pubs.find(p => p.title === "Low-Power Sensor Enclosure");
  assert.ok(patent, "patent record present");
  assert.ok(patent!.status.includes("Draft under preparation"), "status preserved verbatim");
  assert.ok(!/granted|published/i.test(patent!.status), "no fabricated outcome");
  const design = pubs.find(p => p.title === "Grid Telemetry Unit");
  assert.equal(design!.year, "2026");
  assert.ok(design!.status.includes("Registration pending"));
});

// 8. repeated canonical sections merge, not first-find-only
check("second EXPERIENCE-family section merges — both internships parsed", () => {
  const r = parseCVFromDocument(RESUME_C);
  assert.equal(r.experience.length, 2);
  const orgs = r.experience.map(e => e.organization);
  assert.ok(orgs.includes("Delta Corp") && orgs.includes("Echo Labs"));
});

// 9. same-extractor identical lines are never deduplicated
check("deduplicateCanonicalBlocks preserves same-strategy repeated lines", () => {
  const mk = (text: string, order: number): any => ({
    text, page: 1, order, blockType: "PARAGRAPH",
    sourceStrategy: "mammoth_html", confidence: 0.9, metadata: {},
  });
  const blocks = [mk("Product Design Intern", 1), mk("Product Design Intern", 5), mk("Product Design Intern", 9)];
  const out = deduplicateCanonicalBlocks(blocks);
  assert.equal(out.length, 3);
});

// 10. 'work' inside a project heading must not classify as EXPERIENCE
check("'PROJECT WORK DETAILS' does not classify as EXPERIENCE", () => {
  const r = parseCVFromDocument(RESUME_B);
  assert.equal(r.experience.length, 0, "no phantom experience from project heading");
});

console.log(`# ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
