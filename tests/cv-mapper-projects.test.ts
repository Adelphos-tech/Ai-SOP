/**
 * cv-mapper-projects.test.ts — PROJECTS merged-text-block regression.
 *
 * Bug: the Docling mapper only opened project records on
 * section_header/title blocks. Real PDFs emit an entire project entry as a
 * single merged text block ("Name - Tech, Stack (Jan 2025 - Apr 2025)
 * Built…") → `if (!cur) continue` silently dropped every project.
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

// Classic header layout: title opens the project, text is its description.
const HEADER_DOC = doc(
  B("section_header", "Projects", 0),
  B("title", "Image Classifier - TensorFlow, Keras", 1),
  B("text", "Achieved 92% accuracy on the benchmark test set.", 2),
  B("title", "Recommender Service", 3),
  B("text", "Academic AI Project", 4),
);

// Two consecutive merged project blocks = two separate projects.
const TWO_MERGED_DOC = doc(
  B("section_header", "Projects", 0),
  B("text", "Inventory Forecasting Engine - pandas, Prophet (Feb 2024 - May 2024) Forecasted weekly demand.", 1),
  B("text", "Document Search Index - Elasticsearch, FastAPI (Jun 2024 - Aug 2024) Served sub-second lookups.", 2),
);

// Description-only paragraphs — must NOT fabricate projects.
const NOISE_DOC = doc(
  B("section_header", "Projects", 0),
  B("text", "During college I explored many problem domains and built confidence.", 1),
  B("text", "Built several small utilities over the years while learning to code.", 2),
  B("text", "The coursework ran from 2021 - 2024 across multiple semesters.", 3), // date range, no name/tech evidence
);

// Alternative separators / layouts
const ALT_LAYOUTS_DOC = doc(
  B("section_header", "Projects", 0),
  B("text", "Budget Tracker | React, Node.js, MongoDB", 1),          // pipe separator, no dates
  B("text", "Chat Relay — Go, WebSockets", 2),                       // em-dash, no dates
  B("text", "Personal Knowledge Vault", 3),                          // bare title, no tech/dates
  B("text", "Built encrypted local-first note storage.", 4),         // → description of #3
  B("text", "Route Visualizer : Dijkstra, OSRM, Leaflet", 5),        // colon separator? currently unsupported → description/ignored
);

console.log("\ncv-mapper PROJECTS merged-text regression\n");

check("1: E2E Project 1 extracted from merged text block", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const p = cv.projects.find(x => /Campus Notes/.test(x.name));
  assert.ok(p, `project not found: ${JSON.stringify(cv.projects.map(x => x.name))}`);
  assert.equal(p.name, "Campus Notes ETL Pipeline");
  assert.match(p.technologies, /Python/);
  assert.match(p.technologies, /PostgreSQL/);
  assert.match(p.technologies, /Docker/);
  assert.match(p.description, /Jan 2025 - Apr 2025/, "dates preserved");
  assert.match(p.description, /ETL pipeline/);
});

check("2: E2E Project 2 extracted, following description attaches to it", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const p = cv.projects.find(x => /Attendance/.test(x.name));
  assert.ok(p, "project 2 not found");
  assert.equal(p.name, "Student Attendance Predictor");
  assert.match(p.technologies, /scikit-learn/);
  assert.match(p.description, /Sep 2024 - Nov 2024/);
  assert.match(p.description, /logistic-regression/, "next block attached as description");
});

check("3: description of project 2 does not leak into project 1", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.projects.length, 2, JSON.stringify(cv.projects.map(p => p.name)));
  assert.doesNotMatch(cv.projects[0].description, /attendance/i);
});

check("4: two consecutive merged project blocks stay separate", () => {
  const cv = mapDoclingToParsedCV(TWO_MERGED_DOC);
  assert.equal(cv.projects.length, 2);
  assert.equal(cv.projects[0].name, "Inventory Forecasting Engine");
  assert.equal(cv.projects[1].name, "Document Search Index");
  assert.match(cv.projects[1].technologies, /Elasticsearch/);
  assert.match(cv.projects[0].description, /Forecasted weekly demand/);
});

check("5: header-based project extraction unchanged", () => {
  const cv = mapDoclingToParsedCV(HEADER_DOC);
  assert.equal(cv.projects.length, 2, JSON.stringify(cv.projects.map(p => p.name)));
  assert.equal(cv.projects[0].name, "Image Classifier");
  assert.match(cv.projects[0].technologies, /TensorFlow/);
  assert.match(cv.projects[0].description, /92%/);
  // role-hint line still attaches to the open header record
  assert.equal(cv.projects[1].name, "Recommender Service");
  assert.equal(cv.projects[1].role, "Academic AI Project");
});

check("6: no technologies stated → none invented", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("text", "Stockpile Manager (Mar 2024 - Jun 2024) Tracked warehouse levels.", 1),
  ));
  assert.equal(cv.projects.length, 1);
  assert.equal(cv.projects[0].name, "Stockpile Manager");
  assert.equal(cv.projects[0].technologies, "");
});

check("7: description-only paragraphs fabricate no projects", () => {
  const cv = mapDoclingToParsedCV(NOISE_DOC);
  assert.equal(cv.projects.length, 0, JSON.stringify(cv.projects));
});

check("8: projects and experience do not contaminate each other", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.experience.length, 1, "exactly the internship, not projects");
  assert.match(cv.experience[0].organization, /QA Synthetic Labs/);
  for (const p of cv.projects) {
    assert.doesNotMatch(p.name, /QA Synthetic Labs|Intern/i);
  }
  for (const e of cv.experience) {
    assert.doesNotMatch(e.organization + e.role, /Pipeline|Predictor/i);
  }
});

check("9: unrelated sections do not create projects", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("text", "Portfolio Site - Next.js, Tailwind (Mar 2024 - May 2024) Deployed on Vercel.", 1),
    B("section_header", "Skills", 2),
    B("text", "Tools: Git, Docker, Linux", 3),
    B("section_header", "Education", 4),
    B("text", "B.Tech Computer Science - State University, Pune 2020 - 2024 | CGPA 9.1", 5),
  ));
  assert.equal(cv.projects.length, 1, JSON.stringify(cv.projects.map(p => p.name)));
  assert.equal(cv.projects[0].name, "Portfolio Site");
});

check("10: alternative separators and bare-name layout", () => {
  const cv = mapDoclingToParsedCV(ALT_LAYOUTS_DOC);
  const names = cv.projects.map(p => p.name);
  assert.ok(names.includes("Budget Tracker"), JSON.stringify(names));
  assert.ok(names.includes("Chat Relay"), JSON.stringify(names));
  assert.ok(names.includes("Personal Knowledge Vault"), JSON.stringify(names));
  const vault = cv.projects.find(p => p.name === "Personal Knowledge Vault")!;
  assert.match(vault.description, /encrypted local-first/);
  const budget = cv.projects.find(p => p.name === "Budget Tracker")!;
  assert.match(budget.technologies, /React/);
});

check("11: title-shaped fragments under an open project become its project, sentences become its description", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("text", "Image Retriever - CLIP, FAISS (Apr 2024 - Jun 2024) Indexed photos.", 1),
    B("text", "Improved recall from 0.71 to 0.84 on the held-out set.", 2), // verb-led → description
    B("text", "Built dashboards for latency, error rate, index size.", 3),  // verb-led → description
  ));
  assert.equal(cv.projects.length, 1, JSON.stringify(cv.projects.map(p => p.name)));
  assert.match(cv.projects[0].description, /recall/);
  assert.match(cv.projects[0].description, /dashboards/);
});

check("12: empty Projects section fabricates nothing", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("section_header", "Skills", 1),
  ));
  assert.equal(cv.projects.length, 0);
});

check("14: project title containing 'Project' is not eaten by segmentation", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("title", "Student Management Project", 1),
    B("text", "Built a student management application using React and PostgreSQL.", 2),
  ));
  assert.equal(cv.projects.length, 1, JSON.stringify(cv.projects.map(p => p.name)));
  assert.equal(cv.projects[0].name, "Student Management Project");
  assert.match(cv.projects[0].description, /React and PostgreSQL/);
});

check("15: title-cased subheadings do not create extra project records", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("text", "Campus Relay - Python, Docker Jan 2024 - Mar 2024", 1),
    B("text", "Key Contributions", 2),
    B("text", "Built REST APIs for student scheduling.", 3),
    B("text", "Technical Implementation", 4),
    B("text", "Implemented PostgreSQL queries and data validation.", 5),
  ));
  assert.equal(cv.projects.length, 1, JSON.stringify(cv.projects.map(p => p.name)));
  assert.equal(cv.projects[0].name, "Campus Relay");
  assert.match(cv.projects[0].description, /REST APIs/);
  assert.match(cv.projects[0].description, /PostgreSQL queries/);
});

check("16: consecutive category lines never duplicate or overwrite", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Projects", 0),
    B("title", "Image Classifier - TensorFlow, Keras", 1),
    B("text", "Academic AI Project", 2),
    B("text", "Personal Project", 3),
  ));
  assert.equal(cv.projects.length, 1, JSON.stringify(cv.projects.map(p => p.name)));
  assert.equal(cv.projects[0].name, "Image Classifier");
  assert.match(cv.projects[0].technologies, /TensorFlow/);
  assert.equal(cv.projects[0].role, "Academic AI Project", "first role kept");
  assert.doesNotMatch(cv.projects[0].description, /Personal Project/);
});

check("13: full ParsedCV survives sanitization with correct project values", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.projects.length, 2);
  for (const p of cv.projects) {
    assert.ok(p.id.startsWith("cv-docling-"), "id provenance");
    assert.equal(p.type, "Academic");
    assert.ok(p.name.length > 0, "sanitized name kept");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
