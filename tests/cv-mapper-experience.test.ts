/**
 * cv-mapper-experience.test.ts — EXPERIENCE merged-text-block regression.
 *
 * Bug: the Docling mapper only opened experience entries on
 * section_header/title blocks. Real PDFs emit an entire internship as a
 * single merged text block ("Role - Org, City Jun 2025 - Dec 2025 Built…")
 * → `if (!cur) continue` silently dropped the whole entry.
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

// Real blocks from qa-e2e-resume.pdf (orders preserved)
const E2E_DOC = {
  blocks: [
    B("section_header", "QA E2E Applicant", 0),
    B("text", "Ahmedabad, India  |  +91 9000001401  |  qa-e2e-20261022-1540@example.test  |  github.com/qa-e2eapplicant", 1),
    B("section_header", "Summary", 2),
    B("text", "Final-year Computer Science undergraduate preparing for a Master's in Computer Science in the United States. Interested in data engineering and applied machine learning.", 3),
    B("section_header", "Education", 4),
    B("text", "Bachelor of Technology in Computer Science - QA Institute of Technology (Synthetic), Ahmedabad 2022 - 2026 (expected)  |  CGPA 8.9/10.0 Relevant coursework: Data Structures, Algorithms, Database Systems.", 5),
    B("section_header", "Experience", 6),
    B("text", "Software Engineering Intern - QA Synthetic Labs (Test Only), Ahmedabad Jun 2025 - Dec 2025 Built REST APIs in Node.js used by a campus scheduling tool. Wrote pytest suites raising coverage to 85%. Profiled and optimized PostgreSQL queries, reducing report-generation latency 35%.", 7),
    B("section_header", "Projects", 8),
    B("text", "Campus Notes ETL Pipeline - Python, PostgreSQL, Docker (Jan 2025 - Apr 2025) Designed an ETL pipeline ingesting 40,000 lecture notes into a searchable Postgres index. Cut average query time by 60%.", 9),
    B("text", "Student Attendance Predictor - Python, scikit-learn, Flask (Sep 2024 - Nov 2024)", 10),
    B("text", "Trained a logistic-regression model predicting attendance dips from timetable and engagement features; achieved 0.81 validation AUC.", 11),
    B("section_header", "Technical Skills", 12),
    B("text", "Languages: Python, JavaScript, SQL  |  Frameworks/Tools: Flask, Node.js, scikit-learn, PostgreSQL, Docker, Git, Linux", 13),
    B("section_header", "Certifications & Achievements", 14),
    B("text", "AWS Certified Cloud Practitioner (synthetic) - 2025 Google Data Analytics Certificate (synthetic) - 2024", 15),
    B("text", "University Merit Scholarship - 2024  |  Hackathon Finalist, CodeSprint - 2025", 16),
  ],
  doclingVersion: "e2e-fixture", sourceHash: "qa-e2e", pages: 1,
} as any;

// Header-based layout (classic per-entry headers)
const HEADER_DOC = {
  blocks: [
    B("section_header", "Anita Rao", 0),
    B("section_header", "Experience", 1),
    B("title", "Data Science Intern Jun 2024 - Aug 2024", 2),
    B("title", "Initech | Bengaluru, India", 3),
    B("text", "Built churn dashboards.", 4),
    B("title", "Globex Corporation", 5),
    B("text", "Analytics Associate | Pune, India", 6),
    B("text", "Sep 2024 - Present", 7),
    B("text", "Owned weekly revenue reporting.", 8),
  ],
  doclingVersion: "fixture", sourceHash: "hdr", pages: 1,
} as any;

// Two merged text blocks = two separate internships
const TWO_MERGED_DOC = {
  blocks: [
    B("section_header", "Experience", 0),
    B("text", "QA Intern - Widgets Pvt Ltd, Pune Jan 2024 - Mar 2024 Tested release builds and filed defects.", 1),
    B("text", "Backend Intern - Acme Systems, Mumbai May 2024 - Aug 2024 Maintained billing microservices.", 2),
  ],
  doclingVersion: "fixture", sourceHash: "two", pages: 1,
} as any;

// Description-only paragraphs — must NOT fabricate entries
const NOISE_DOC = {
  blocks: [
    B("section_header", "Experience", 0),
    B("text", "During my studies I volunteered at campus events and helped organize a coding club.", 1),
    B("text", "I have worked hard to develop my communication skills over the years.", 2),
    B("text", "The program ran from 2020 - 2024 across three campuses.", 3), // date range but no role/org evidence
  ],
  doclingVersion: "fixture", sourceHash: "noise", pages: 1,
} as any;

console.log("\ncv-mapper EXPERIENCE merged-text regression\n");

check("1: E2E internship extracted from merged text block", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.experience.length, 1, `expected 1 experience, got ${cv.experience.length}`);
});

check("2: extracted org/role/dates match fixture exactly", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const e = cv.experience[0];
  assert.ok(e, "no experience record");
  assert.equal(e.organization, "QA Synthetic Labs (Test Only)");
  assert.equal(e.role, "Software Engineering Intern");
  assert.equal(e.location, "Ahmedabad");
  assert.equal(e.startDate, "Jun 2025");
  assert.equal(e.endDate, "Dec 2025");
  assert.match(e.responsibilities || "", /REST APIs/);
  assert.match(e.responsibilities || "", /85%/);
});

check("3: header-based experience extraction still works", () => {
  const cv = mapDoclingToParsedCV(HEADER_DOC);
  assert.equal(cv.experience.length, 2, JSON.stringify(cv.experience.map(e => ({ org: e.organization, role: e.role }))));
  assert.equal(cv.experience[0].organization, "Initech");
  assert.equal(cv.experience[0].role, "Data Science Intern");
  assert.equal(cv.experience[1].organization, "Globex Corporation");
  assert.equal(cv.experience[1].role, "Analytics Associate");
  assert.equal(cv.experience[1].currentlyWorking, true);
});

check("4: multiple merged text records stay separate", () => {
  const cv = mapDoclingToParsedCV(TWO_MERGED_DOC);
  assert.equal(cv.experience.length, 2);
  assert.equal(cv.experience[0].organization, "Widgets Pvt Ltd");
  assert.equal(cv.experience[1].organization, "Acme Systems");
  assert.equal(cv.experience[1].startDate, "May 2024");
});

check("5: description-only text fabricates nothing", () => {
  const cv = mapDoclingToParsedCV(NOISE_DOC);
  assert.equal(cv.experience.length, 0, JSON.stringify(cv.experience));
});

check("6: education/project content cannot become experience", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const e of cv.experience) {
    assert.doesNotMatch(e.organization + e.role, /Institute of Technology|Pipeline|Predictor/i);
  }
});

check("7: missing fields stay empty — role-only head, no org invented", () => {
  const doc = { blocks: [
    B("section_header", "Experience", 0),
    B("text", "Freelance Developer Mar 2023 - Nov 2023 Shipped two client dashboards.", 1),
  ], doclingVersion: "f", sourceHash: "f", pages: 1 } as any;
  const cv = mapDoclingToParsedCV(doc);
  assert.equal(cv.experience.length, 1);
  assert.equal(cv.experience[0].role, "Freelance Developer");
  assert.equal(cv.experience[0].organization, "");
});

check("8: full ParsedCV survives sanitization with correct values", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const e = cv.experience[0];
  assert.ok(e.id.startsWith("cv-docling-"), "id provenance");
  assert.equal(e.type, "Internship", "intern role → Internship type");
  assert.equal(cv.education.length >= 1, true, "education still parsed");
});

// ---- Code-review findings ----
const doc = (...blocks: any[]) => ({ blocks, doclingVersion: "f", sourceHash: "f", pages: 1 } as any);

check("9: date-bearing responsibility with dash does not create a job", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Experience", 0),
    B("text", "Built reporting dashboard - SQL tools Jan 2024 - Mar 2024", 1),
  ));
  assert.equal(cv.experience.length, 0, JSON.stringify(cv.experience));
});

check("10: role keyword inside unrelated word does not create a job", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Experience", 0),
    B("text", "International collaborations Jan 2024 - Mar 2024", 1),
    B("text", "Leadership summit Feb 2023 - Apr 2023", 2),
  ));
  assert.equal(cv.experience.length, 0, JSON.stringify(cv.experience));
});

check("11: responsibility bullets under an open job stay bullets", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Experience", 0),
    B("text", "Data Analyst - Initech, Pune Jan 2023 - Dec 2023 Owned reporting.", 1),
    B("text", "Built reporting dashboard - SQL tools Jan 2024 - Mar 2024", 2),
    B("text", "International collaborations Jan 2024 - Mar 2024", 3),
  ));
  assert.equal(cv.experience.length, 1, JSON.stringify(cv.experience.map(e => e.role)));
  assert.match(cv.experience[0].responsibilities, /reporting dashboard/);
});

check("12: header org + role/date text → one record, org preserved", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Experience", 0),
    B("title", "Acme Corporation", 1),
    B("text", "Software Engineer Jan 2024 - Mar 2024", 2),
  ));
  assert.equal(cv.experience.length, 1, JSON.stringify(cv.experience));
  const e = cv.experience[0];
  assert.equal(e.organization, "Acme Corporation");
  assert.equal(e.role, "Software Engineer");
  assert.equal(e.startDate, "Jan 2024");
  assert.equal(e.endDate, "Mar 2024");
});

check("13: empty Experience section fabricates nothing", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Experience", 0),
    B("section_header", "Projects", 1),
  ));
  assert.equal(cv.experience.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
