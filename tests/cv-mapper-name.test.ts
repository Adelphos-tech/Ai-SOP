/**
 * cv-mapper-name.test.ts — applicant-name detection regression.
 *
 * Bug from the production E2E: "QA E2E Applicant" was rejected by
 * looksLikeName's blanket /\d/ check, leaving firstName/lastName empty.
 *
 * Fixture = the REAL docling /parse output for qa-e2e-resume.pdf
 * (orders preserved).
 */
import assert from "node:assert/strict";
import { mapDoclingToParsedCV } from "../src/lib/application/cv-mapper-docling";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name} — ${(e as Error).message}`); }
}

const B = (type: string, text: string, order: number, page = 1) => ({ type, text, page, order });
const doc = (...blocks: any[]) => ({ blocks, doclingVersion: "f", sourceHash: "f", pages: 1 } as any);

const CONTACT = "Ahmedabad, India  |  +91 9000001401  |  qa-e2e@example.test  |  github.com/qa-e2eapplicant";
const SECTIONS = [
  B("section_header", "Education", 3),
  B("text", "B.Tech in CS - Indus University 2020 - 2024", 4),
  B("section_header", "Experience", 5),
  B("text", "Software Engineer - Acme Corp Jan 2024 - Dec 2025 Built tools.", 6),
];

const E2E_DOC = doc(
  B("section_header", "QA E2E Applicant", 0),
  B("text", CONTACT, 1),
  B("section_header", "Summary", 2),
  B("text", "Final-year undergraduate preparing for a Master's degree.", 3),
  ...SECTIONS.map(b => ({ ...b, order: b.order + 1 })),
);

console.log("\ncv-mapper NAME detection regression\n");

check("1: E2E synthetic header produces the applicant name", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.personalData.firstName, "QA", JSON.stringify(cv.personalData));
  assert.equal(cv.personalData.lastName, "E2E Applicant");
});

check("2: ordinary two-word name", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Priya Sharma", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "Priya");
  assert.equal(cv.personalData.lastName, "Sharma");
});

check("3: three- and four-word names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("title", "Jean Claude Van Damme", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "Jean");
  assert.equal(cv.personalData.lastName, "Claude Van Damme");
});

check("4: Unicode/accented name", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "José García Márquez", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "José");
  assert.equal(cv.personalData.lastName, "García Márquez");
});

check("5: hyphenated and apostrophe names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Mary-Jane O'Brien", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "Mary-Jane");
  assert.equal(cv.personalData.lastName, "O'Brien");
});

check("6: name with an initial", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "R. Madhavan", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "R.");
  assert.equal(cv.personalData.lastName, "Madhavan");
});

check("7: ALL-CAPS name header is title-cased for display", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "PRIYA SHARMA", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "Priya");
  assert.equal(cv.personalData.lastName, "Sharma");
});

check("8: lowercase particle surname (van/de/di)", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Leonardo da Vinci", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "Leonardo");
  assert.equal(cv.personalData.lastName, "da Vinci");
});

check("9: institution and company headers never become names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Massachusetts Institute of Technology", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
  const cv2 = mapDoclingToParsedCV(doc(
    B("section_header", "Acme Corporation", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv2.personalData.firstName, "");
});

check("10: job-title headers never become names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Senior Software Engineer", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
});

check("11: section-heading blocks never become names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("text", "No name here at all", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
});

check("12: digit-tag name needs corroborating contact evidence", () => {
  // Same header, but no contact block follows → not enough evidence.
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "QA E2E Applicant", 0),
    B("text", "Final-year undergraduate preparing for a Master's degree.", 1),
    ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
});

check("13: no name evidence → stays unidentified", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Resume", 0), B("text", "Some prose.", 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
});

check("14: competing headers — first strong candidate wins conservatively", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "PRIYA SHARMA", 0),
    B("text", CONTACT, 1),
    B("section_header", "Education", 2),
    B("title", "Indus University, Ahmedabad", 3),
    B("text", "B.Tech 2016 - 2020", 4),
  ));
  assert.equal(cv.personalData.firstName, "Priya");
});

check("15: name does not disturb Education/Experience/Projects extraction", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.education.length, 1);
  assert.equal(cv.experience.length, 1);
});

check("16: single-word or pure-number headers are not names", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Alexander", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv.personalData.firstName, "", JSON.stringify(cv.personalData));
  const cv2 = mapDoclingToParsedCV(doc(
    B("section_header", "Sprint 2024 Report", 0), B("text", CONTACT, 1), ...SECTIONS));
  assert.equal(cv2.personalData.firstName, "", JSON.stringify(cv2.personalData));
});

check("17: institution vocabulary headers rejected across word shapes", () => {
  for (const org of ["Northbridge University", "Harborview Institute",
      "Eastern Academy", "Consulting Partners"]) {
    const cv = mapDoclingToParsedCV(doc(
      B("section_header", org, 0), B("text", CONTACT, 1), ...SECTIONS));
    assert.equal(cv.personalData.firstName, "", `"${org}" became a name: ${JSON.stringify(cv.personalData)}`);
  }
});

check("18: Unicode ALL-CAPS names normalize correctly", () => {
  for (const [header, first, last] of [
    ["ÉLODIE DURAND", "Élodie", "Durand"],
    ["ŁUKASZ KOWALSKI", "Łukasz", "Kowalski"],
    ["JOSÉ GARCÍA", "José", "García"],
  ] as const) {
    const cv = mapDoclingToParsedCV(doc(
      B("section_header", header, 0), B("text", CONTACT, 1), ...SECTIONS));
    assert.equal(cv.personalData.firstName, first, `${header}: ${JSON.stringify(cv.personalData)}`);
    assert.equal(cv.personalData.lastName, last);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
