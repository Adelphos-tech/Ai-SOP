/**
 * cv-mapper-education.test.ts — EDUCATION merged-text-block regression.
 *
 * Bugs from the production E2E:
 *  a) A single merged education entry ("Degree - Institution, City YYYY - YYYY
 *     (expected) | CGPA …") was split at the date boundary, producing a
 *     phantom second record whose degree was "(expected)".
 *  b) The no-pipe branch dumped the whole line into `institution`, losing
 *     degree, specialization and GPA.
 *
 * Fixture = the REAL docling /parse output for qa-e2e-resume.pdf
 * (17 blocks, captured from the production sidecar 2026-10-22).
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

const E2E_EDU = "Bachelor of Technology in Computer Science - QA Institute of Technology (Synthetic), Ahmedabad 2022 - 2026 (expected)  |  CGPA 8.9/10.0 Relevant coursework: Data Structures, Algorithms, Database Systems.";

// Real blocks from qa-e2e-resume.pdf (orders preserved)
const E2E_DOC = {
  blocks: [
    B("section_header", "QA E2E Applicant", 0),
    B("text", "Ahmedabad, India  |  +91 9000001401  |  qa-e2e-20261022-1540@example.test  |  github.com/qa-e2eapplicant", 1),
    B("section_header", "Summary", 2),
    B("text", "Final-year Computer Science undergraduate preparing for a Master's in Computer Science in the United States. Interested in data engineering and applied machine learning.", 3),
    B("section_header", "Education", 4),
    B("text", E2E_EDU, 5),
    B("section_header", "Experience", 6),
    B("text", "Software Engineering Intern - QA Synthetic Labs (Test Only), Ahmedabad Jun 2025 - Dec 2025 Built REST APIs in Node.js used by a campus scheduling tool. Wrote pytest suites raising coverage to 85%. Profiled and optimized PostgreSQL queries, reducing report-generation latency 35%.", 7),
    B("section_header", "Projects", 8),
    B("text", "Campus Notes ETL Pipeline - Python, PostgreSQL, Docker (Jan 2025 - Apr 2025) Designed an ETL pipeline ingesting 40,000 lecture notes into a searchable Postgres index. Cut average query time by 60%.", 9),
    B("section_header", "Technical Skills", 10),
    B("text", "Languages: Python, JavaScript, SQL", 11),
  ],
  doclingVersion: "e2e-fixture", sourceHash: "qa-e2e", pages: 1,
} as any;

console.log("\ncv-mapper EDUCATION merged-text regression\n");

check("1: E2E education produces exactly ONE record", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.education.length, 1, JSON.stringify(cv.education.map(e => ({ i: e.institution, d: e.degree }))));
});

check("2: E2E education fields match the fixture exactly", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const e = cv.education[0];
  assert.ok(e, "no education record");
  assert.equal(e.degree, "Bachelor of Technology");
  assert.equal(e.specialization, "Computer Science");
  assert.equal(e.institution, "QA Institute of Technology (Synthetic)");
  assert.equal(e.startYear, "2022");
  assert.equal(e.endYear, "2026");
  assert.equal(e.cgpa, "8.9");
  assert.equal(e.cgpaScale, "10.0");
});

check("3: '(expected)' never becomes a degree or phantom record", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const e of cv.education) {
    assert.doesNotMatch(e.degree + e.institution + e.specialization, /expected/i);
  }
});

check("4: multi-record pipe layout stays separate (existing behavior)", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "MBA in IT | Intl Univ, Berlin Sep 2024 - Dec 2025 | Bachelor of Science | Indus University, Ahmedabad Jun 2016 - Sep 2020", 1),
  ));
  assert.equal(cv.education.length, 2, JSON.stringify(cv.education.map(e => e.degree)));
  const mba = cv.education.find(e => /MBA/.test(e.degree))!;
  assert.equal(mba.specialization, "IT");
  assert.equal(mba.institution, "Intl Univ");
  const bsc = cv.education.find(e => /Bachelor of Science/.test(e.degree))!;
  assert.equal(bsc.institution, "Indus University");
  assert.equal(bsc.startYear, "2016");
});

check("5: header-based education extraction unchanged", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("title", "Indus University, Ahmedabad", 1),
    B("text", "Bachelor of Commerce", 2),
    B("text", "Jun 2016 - Sep 2020", 3),
    B("text", "CGPA 9.1", 4),
  ));
  assert.equal(cv.education.length, 1);
  const e = cv.education[0];
  assert.equal(e.institution, "Indus University");
  assert.equal(e.degree, "Bachelor of Commerce");
  assert.equal(e.startYear, "2016");
  assert.equal(e.endYear, "2020");
  assert.equal(e.cgpa, "9.1");
});

check("6: institution header + merged degree/date line completes one record", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("title", "State University", 1),
    B("text", "B.Tech in Mechanical Engineering 2019 - 2023", 2),
  ));
  assert.equal(cv.education.length, 1, JSON.stringify(cv.education.map(e => e.institution)));
  const e = cv.education[0];
  assert.equal(e.institution, "State University");
  assert.equal(e.degree, "B.Tech");
  assert.equal(e.specialization, "Mechanical Engineering");
  assert.equal(e.startYear, "2019");
  assert.equal(e.endYear, "2023");
});

check("7: no-pipe merged entry (degree - institution, city dates)", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Master of Science in Physics - Riverside College, Boston 2018 - 2020", 1),
  ));
  assert.equal(cv.education.length, 1);
  const e = cv.education[0];
  assert.equal(e.degree, "Master of Science");
  assert.equal(e.specialization, "Physics");
  assert.equal(e.institution, "Riverside College");
  assert.equal(e.startYear, "2018");
  assert.equal(e.endYear, "2020");
});

check("8: ongoing study keeps startYear, endYear empty", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "B.Tech in Civil Engineering - Coastal Institute, Kochi 2021 - Present", 1),
  ));
  assert.equal(cv.education.length, 1);
  assert.equal(cv.education[0].startYear, "2021");
  assert.equal(cv.education[0].endYear, "");
});

check("9: non-degree noise in education section fabricates nothing", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Member of the hiking club and campus volunteer group.", 1),
    B("text", "Attended workshops between 2020 - 2021 on leadership.", 2),
  ));
  assert.equal(cv.education.length, 0, JSON.stringify(cv.education));
});

check("10: cert-looking sub-record still routes to certifications", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "MBA in Marketing | City College, Delhi Jul 2018 - May 2020 | Product Management Certification - AltUni by Inside IIM", 1),
  ));
  assert.equal(cv.education.length, 1);
  assert.ok(cv.certifications.some(c => /Product Management Certification/.test(c)), JSON.stringify(cv.certifications));
});

check("11: education does not leak into experience or projects", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const e of cv.experience) {
    assert.doesNotMatch(e.organization + e.role, /Institute of Technology|Bachelor/i);
  }
  for (const p of cv.projects) {
    assert.doesNotMatch(p.name, /Bachelor|Institute/i);
  }
});

check("12: missing fields stay empty — degree-only record, no institution invented", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("title", "Riverside Polytechnic", 1),
    B("text", "Diploma in Electronics", 2),
  ));
  assert.equal(cv.education.length, 1);
  assert.equal(cv.education[0].institution, "Riverside Polytechnic");
  assert.equal(cv.education[0].degree, "Diploma");
  assert.equal(cv.education[0].specialization, "Electronics");
  assert.equal(cv.education[0].startYear, "");
  assert.equal(cv.education[0].cgpa, "");
});

check("14: GPA + coursework after dates without a pipe separator", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Bachelor of Science in Chemistry - Harborview University, Portland 2019 - 2023 CGPA 3.8/4.0 Relevant coursework: Organic Chemistry, Lab Methods", 1),
  ));
  assert.equal(cv.education.length, 1);
  const e = cv.education[0];
  assert.equal(e.degree, "Bachelor of Science");
  assert.equal(e.specialization, "Chemistry");
  assert.equal(e.institution, "Harborview University");
  assert.doesNotMatch(e.institution, /coursework/i);
  assert.equal(e.startYear, "2019");
  assert.equal(e.endYear, "2023");
  assert.equal(e.cgpa, "3.8");
  assert.equal(e.cgpaScale, "4.0");
});

check("15: explicit entry institution wins over header guess", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("title", "Northbridge University", 1),
    B("text", "Master of Science in Physics - Lakeside College, Boston 2022 - 2024", 2),
  ));
  assert.equal(cv.education.length, 1, JSON.stringify(cv.education.map(e => e.institution)));
  const e = cv.education[0];
  assert.equal(e.institution, "Lakeside College");
  assert.equal(e.degree, "Master of Science");
  assert.equal(e.specialization, "Physics");
  assert.equal(e.startYear, "2022");
  assert.equal(e.endYear, "2024");
});

check("16: degree+dates-only line still completes the header record", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("title", "Northbridge University", 1),
    B("text", "B.Tech in Physics 2020 - 2024", 2),
  ));
  assert.equal(cv.education.length, 1);
  const e = cv.education[0];
  assert.equal(e.institution, "Northbridge University");
  assert.equal(e.degree, "B.Tech");
  assert.equal(e.specialization, "Physics");
  assert.equal(e.startYear, "2020");
  assert.equal(e.endYear, "2024");
});

check("13: full ParsedCV survives sanitization with expected values", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const e = cv.education[0];
  assert.ok(e.id.startsWith("cv-docling-"), "id provenance");
  assert.equal(e.institution, "QA Institute of Technology (Synthetic)");
  assert.equal(e.degree, "Bachelor of Technology");
  assert.equal(e.specialization, "Computer Science");
});

// ---- Brick 7B: GPA continuation after separators ----
// Real Élodie block 6: the "| GPA 3.7/4.0" tail started with a pipe that
// EDU_CONTINUATION didn't tolerate → spawned a GPA-only weak record →
// dropped, losing the grade.

const ELODIE_EDU = "Bachelor of Science in Information Systems - Riverton Polytechnic, Lyon 2021 - 2025 | GPA 3.7/4.0";

check("17: pipe-separated GPA continuation stays on the record", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", ELODIE_EDU, 1),
  ));
  assert.equal(cv.education.length, 1, JSON.stringify(cv.education.map(e => e.institution)));
  const e = cv.education[0];
  assert.equal(e.degree, "Bachelor of Science");
  assert.equal(e.specialization, "Information Systems");
  assert.equal(e.institution, "Riverton Polytechnic");
  assert.equal(e.startYear, "2021");
  assert.equal(e.endYear, "2025");
  assert.equal(e.cgpa, "3.7");
  assert.equal(e.cgpaScale, "4.0");
  assert.ok(!cv.parseWarnings.some(w => /GPA|gpa|Dropped weak/.test(w)),
    "GPA continuation must not surface as a dropped weak entry: " + JSON.stringify(cv.parseWarnings));
});

check("18: standalone GPA block attaches to a merged-block record", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Bachelor of Science in Chemistry - Harborview University, Portland 2019 - 2023", 1),
    B("text", "GPA 3.9/4.0", 2),
  ));
  assert.equal(cv.education.length, 1, JSON.stringify(cv.education));
  assert.equal(cv.education[0].cgpa, "3.9");
  assert.equal(cv.education[0].cgpaScale, "4.0");
});

check("19: no-GPA entry keeps empty grade fields, no phantom record", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Master of Science in Physics - Riverside College, Boston 2018 - 2020", 1),
  ));
  assert.equal(cv.education.length, 1);
  assert.equal(cv.education[0].cgpa, "");
  assert.equal(cv.education[0].cgpaScale, "");
});

check("20: multiple entries keep their own GPAs — no cross-attachment", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Bachelor of Arts in History - Elmwood College 2020 - 2024 | GPA 3.8/4.0 | Master of Science in Biology - Northfield University 2024 - 2026 | GPA 3.9/4.0", 1),
  ));
  assert.equal(cv.education.length, 2, JSON.stringify(cv.education.map(e => ({ i: e.institution, g: e.cgpa }))));
  const ba = cv.education.find(e => /Bachelor of Arts/.test(e.degree))!;
  const ms = cv.education.find(e => /Master of Science/.test(e.degree))!;
  assert.equal(ba.institution, "Elmwood College");
  assert.equal(ba.cgpa, "3.8");
  assert.equal(ms.institution, "Northfield University");
  assert.equal(ms.cgpa, "3.9");
  assert.equal(ms.cgpaScale, "4.0");
});

check("21: a standalone GPA never overwrites an earlier record's grade", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "Bachelor of Arts in History - Elmwood College 2020 - 2024 | GPA 3.8/4.0", 1),
    B("text", "Master of Science in Biology - Northfield University 2024 - 2026", 2),
    B("text", "GPA 3.9/4.0", 3),
  ));
  assert.equal(cv.education.length, 2, JSON.stringify(cv.education.map(e => e.cgpa)));
  const ba = cv.education.find(e => /Bachelor of Arts/.test(e.degree))!;
  const ms = cv.education.find(e => /Master of Science/.test(e.degree))!;
  assert.equal(ba.cgpa, "3.8");
  assert.equal(ms.cgpa, "3.9");
});

check("22: labeled variants still parse (CGPA, colon, percentage)", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Education", 0),
    B("text", "B.Tech in Physics - Coastal Institute 2020 - 2024 | CGPA: 9.0/10.0", 1),
    B("text", "Diploma in Electronics - Riverside Polytechnic 2016 - 2019 | Percentage 85%", 2),
  ));
  assert.equal(cv.education.length, 2, JSON.stringify(cv.education.map(e => e.cgpa)));
  const bt = cv.education.find(e => /B\.Tech/.test(e.degree))!;
  assert.equal(bt.cgpa, "9.0");
  assert.equal(bt.cgpaScale, "10.0");
  const dp = cv.education.find(e => /Diploma/.test(e.degree))!;
  assert.equal(dp.cgpa, "85");
  assert.equal(dp.cgpaScale, "100");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
