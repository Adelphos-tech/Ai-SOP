/**
 * cv-mapper-skills.test.ts — SKILLS merged-label regression.
 *
 * Bugs from the production E2E:
 *  a) "Languages: Python, JavaScript, SQL" routes to candidate.skills
 *     .languages — NOT one of the six UI-visible ParsedCV buckets — so the
 *     programming languages vanished into a warning string.
 *  b) "Frameworks/Tools:" (unspaced slash) fails STRICT_LABEL — the label
 *     is dropped and its items merge into the previous group's values.
 *
 * Fixture = the REAL docling /parse output for qa-e2e-resume.pdf.
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

const E2E_SKILLS = "Languages: Python, JavaScript, SQL  |  Frameworks/Tools: Flask, Node.js, scikit-learn, PostgreSQL, Docker, Git, Linux";

const E2E_DOC = doc(
  B("section_header", "QA E2E Applicant", 0),
  B("section_header", "Education", 1),
  B("text", "Bachelor of Technology in Computer Science - QA Institute of Technology (Synthetic), Ahmedabad 2022 - 2026 (expected)  |  CGPA 8.9/10.0", 2),
  B("section_header", "Experience", 3),
  B("text", "Software Engineering Intern - QA Synthetic Labs (Test Only), Ahmedabad Jun 2025 - Dec 2025 Built REST APIs.", 4),
  B("section_header", "Projects", 5),
  B("text", "Campus Notes ETL Pipeline - Python, PostgreSQL, Docker (Jan 2025 - Apr 2025) Designed an ETL pipeline.", 6),
  B("section_header", "Technical Skills", 7),
  B("text", E2E_SKILLS, 8),
);

const UI_BUCKETS = (cv: any) => [
  ...cv.skills.technical, ...cv.skills.programming, ...cv.skills.tools,
  ...cv.skills.software, ...cv.skills.domain, ...cv.skills.soft,
];

console.log("\ncv-mapper SKILLS merged-label regression\n");

check("1: all 10 E2E skills present in UI-visible buckets", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  const all = UI_BUCKETS(cv);
  const expected = ["Python", "JavaScript", "SQL", "Flask", "Node.js", "scikit-learn", "PostgreSQL", "Docker", "Git", "Linux"];
  for (const s of expected) {
    assert.ok(all.includes(s), `missing "${s}" — buckets: ${JSON.stringify(cv.skills)}`);
  }
});

check("2: programming languages land in the programming bucket", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const s of ["Python", "JavaScript", "SQL"]) {
    assert.ok(cv.skills.programming.includes(s), `"${s}" not in programming: ${JSON.stringify(cv.skills.programming)}`);
  }
});

check("3: Frameworks/Tools items land in the tools bucket", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const s of ["Flask", "Node.js", "scikit-learn", "PostgreSQL", "Docker", "Git", "Linux"]) {
    assert.ok(cv.skills.tools.includes(s), `"${s}" not in tools: ${JSON.stringify(cv.skills.tools)}`);
  }
});

check("4: no item is a concatenated category-label string", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const s of UI_BUCKETS(cv)) {
    assert.doesNotMatch(s, /Languages:|Frameworks\/Tools:|Tools:/);
    assert.ok(!/\|/.test(s), `pipe leaked into item "${s}"`);
  }
});

check("5: spaced slash label 'Frameworks / Tools' works", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Frameworks / Tools: React, Express", 1),
  ));
  assert.ok(cv.skills.tools.includes("React"), JSON.stringify(cv.skills));
  assert.ok(cv.skills.tools.includes("Express"));
});

check("6: bare label line + values on next block", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Cloud / DevOps:", 1),
    B("text", "AWS, Kubernetes, Terraform", 2),
  ));
  assert.ok(cv.skills.tools.includes("AWS"), JSON.stringify(cv.skills));
  assert.ok(cv.skills.tools.includes("Kubernetes"));
  assert.ok(cv.skills.tools.includes("Terraform"));
});

check("7: 'Technical Skills' and 'Programming Languages' labels", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Technical Skills: React, Webpack  |  Programming Languages: Java, C++", 1),
  ));
  assert.ok(cv.skills.technical.includes("React"), JSON.stringify(cv.skills));
  assert.ok(cv.skills.programming.includes("Java"));
  assert.ok(cv.skills.programming.includes("C++"));
});

check("8: existing AI/GenAI + slash-value parsing preserved", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "AI / GenAI: LLMs · RAG · LangChain · Deepgram STT/TTS Product & BA: Roadmapping · Prioritisation", 1),
  ));
  // "STT/TTS" is a VALUE, never a label; "Deepgram STT/TTS" stays an item
  const all = UI_BUCKETS(cv);
  assert.ok(all.includes("Deepgram STT/TTS"), JSON.stringify(cv.skills));
  assert.ok(all.includes("LLMs") && all.includes("RAG"));
  assert.ok(cv.skills.domain.includes("Roadmapping"), JSON.stringify(cv.skills.domain));
  assert.ok(cv.skills.domain.includes("Prioritisation"));
});

check("9: spoken languages are NOT programming skills — evidence preserved", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Languages: English, Hindi, Gujarati", 1),
  ));
  assert.deepEqual(cv.skills.programming, [], JSON.stringify(cv.skills.programming));
  assert.ok(cv.parseWarnings.some(w => /English/.test(w)), "spoken-language evidence must survive (warning)");
});

check("10: mixed 'Languages' label splits items by evidence", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Languages: Python, English, SQL", 1),
  ));
  assert.ok(cv.skills.programming.includes("Python"));
  assert.ok(cv.skills.programming.includes("SQL"));
  assert.ok(!cv.skills.programming.includes("English"), "English is spoken, not programming");
});

check("11: repeated skills deduplicate, distinct ones survive", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Tools: Git, Docker, Git, Kubernetes", 1),
    B("text", "Tools: Git, Helm", 2),
  ));
  assert.deepEqual(cv.skills.tools, ["Git", "Docker", "Kubernetes", "Helm"]);
});

check("12: empty skills section fabricates nothing", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("section_header", "Education", 1),
  ));
  for (const b of Object.values(cv.skills)) assert.deepEqual(b, []);
});

check("13: ordinary sentences in the skills section fabricate no skills", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "I am a quick learner who enjoys working with teams.", 1),
    B("text", "Over the years I have grown more confident presenting ideas.", 2),
  ));
  const all = UI_BUCKETS(cv);
  assert.equal(all.length, 0, JSON.stringify(all));
});

check("14: skills never contaminate education/experience/projects", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const s of UI_BUCKETS(cv)) {
    assert.doesNotMatch(s, /Institute|Intern|Pipeline/i);
  }
  assert.equal(cv.experience.length, 1);
  assert.ok(cv.projects.length >= 1);
});

check("16: ambiguous 'Languages' — programming items by positive evidence only", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Technical Skills", 0),
    B("text", "Languages: Python, Marathi, Polish, Rust", 1),
  ));
  assert.ok(cv.skills.programming.includes("Python"));
  assert.ok(cv.skills.programming.includes("Rust"));
  assert.ok(!cv.skills.programming.includes("Marathi"), "Marathi is spoken, not programming");
  assert.ok(!cv.skills.programming.includes("Polish"), "Polish is spoken, not programming");
  // Spoken-language evidence preserved via the warning mechanism
  assert.ok(cv.parseWarnings.some(w => /Marathi/.test(w) && /Polish/.test(w)), JSON.stringify(cv.parseWarnings));
});

check("17: spoken language ABSENT from any wordlist is not auto-programming", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Languages: Go, Bhojpuri", 1), // Bhojpuri is deliberately NOT in SPOKEN_LANG
  ));
  assert.ok(cv.skills.programming.includes("Go"));
  assert.ok(!cv.skills.programming.includes("Bhojpuri"),
    "unrecognized ambiguous item must not be labelled programming");
  // …but it must not be silently discarded either — evidence survives.
  assert.ok(cv.parseWarnings.some(w => /Bhojpuri/.test(w)), JSON.stringify(cv.parseWarnings));
});

check("18: explicit 'Programming Languages' label keeps bulk programming routing", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Programming Languages: Java, C++, Scala", 1),
  ));
  for (const s of ["Java", "C++", "Scala"]) {
    assert.ok(cv.skills.programming.includes(s), `${s}: ${JSON.stringify(cv.skills.programming)}`);
  }
});

check("19: explicit 'Spoken Languages' label creates no technical skills", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Spoken Languages: English, Telugu", 1),
  ));
  assert.equal(UI_BUCKETS(cv).length, 0, JSON.stringify(UI_BUCKETS(cv)));
  assert.ok(cv.parseWarnings.some(w => /English/.test(w) && /Telugu/.test(w)), JSON.stringify(cv.parseWarnings));
});

check("20: explicit 'Spoken Languages' overrides ambiguous item vocabulary", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Spoken Languages: Go, English, R", 1),
  ));
  // "Go" and "R" look like programming languages, but the explicit
  // category wins — no programming skills are created.
  assert.deepEqual(cv.skills.programming, [], JSON.stringify(cv.skills.programming));
  assert.equal(UI_BUCKETS(cv).length, 0, JSON.stringify(UI_BUCKETS(cv)));
  for (const s of ["Go", "English", "R"]) {
    assert.ok(cv.parseWarnings.some(w => w.includes(s)),
      `spoken-language evidence for '${s}' must survive: ${JSON.stringify(cv.parseWarnings)}`);
  }
});

check("21: short first-person prose without a label fabricates no skills", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "I enjoy working in teams.", 1),
    B("text", "I like building software.", 2),
  ));
  assert.equal(UI_BUCKETS(cv).length, 0, JSON.stringify(UI_BUCKETS(cv)));
});

check("22: genuine unlabelled skills still extracted", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "React, GraphQL, Terraform", 1),
    B("text", "Kubernetes", 2),
  ));
  for (const s of ["React", "GraphQL", "Terraform", "Kubernetes"]) {
    assert.ok(cv.skills.technical.includes(s), `${s}: ${JSON.stringify(cv.skills.technical)}`);
  }
});

check("23: Title-Case noun phrases containing verb-like words are kept", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Skills", 0),
    B("text", "Use Case Modeling, Work Breakdown Structure, Build Automation Pipelines", 1),
    B("text", "Soft Skills: Public Speaking, Active Listening", 2),
  ));
  for (const s of ["Use Case Modeling", "Work Breakdown Structure", "Build Automation Pipelines"]) {
    assert.ok(cv.skills.technical.includes(s), `${s}: ${JSON.stringify(cv.skills.technical)}`);
  }
  for (const s of ["Public Speaking", "Active Listening"]) {
    assert.ok(cv.skills.soft.includes(s), `${s}: ${JSON.stringify(cv.skills.soft)}`);
  }
});

check("15: full ParsedCV keeps the six-bucket contract after sanitization", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const k of ["technical", "programming", "tools", "software", "domain", "soft"]) {
    assert.ok(Array.isArray((cv.skills as any)[k]), `missing bucket ${k}`);
  }
  assert.equal(cv.skills.programming.length, 3);
  assert.equal(cv.skills.tools.length, 7);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
