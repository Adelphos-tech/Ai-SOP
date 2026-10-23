/**
 * cv-mapper-certs-achievements.test.ts — CERTIFICATIONS/ACHIEVEMENTS
 * merged-block regression.
 *
 * Bugs from the production E2E:
 *  a) Two certifications merged in ONE text block with no separator were
 *     stored as a single concatenated record.
 *  b) Pipe-separated achievements under a combined
 *     "Certifications & Achievements" heading were stored as one
 *     concatenated certification; achievements stayed empty.
 *
 * Fixture = the REAL docling /parse output for qa-e2e-resume.pdf
 * (combined heading + two merged text blocks, orders preserved).
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

const E2E_DOC = doc(
  B("section_header", "QA E2E Applicant", 0),
  B("section_header", "Education", 1),
  B("text", "Bachelor of Technology in Computer Science - QA Institute of Technology (Synthetic), Ahmedabad 2022 - 2026 (expected)  |  CGPA 8.9/10.0", 2),
  B("section_header", "Experience", 3),
  B("text", "Software Engineering Intern - QA Synthetic Labs (Test Only), Ahmedabad Jun 2025 - Dec 2025 Built REST APIs.", 4),
  B("section_header", "Technical Skills", 5),
  B("text", "Languages: Python, JavaScript, SQL  |  Frameworks/Tools: Flask, Node.js, Docker", 6),
  B("section_header", "Certifications & Achievements", 7),
  B("text", "AWS Certified Cloud Practitioner (synthetic) - 2025 Google Data Analytics Certificate (synthetic) - 2024", 8),
  B("text", "University Merit Scholarship - 2024  |  Hackathon Finalist, CodeSprint - 2025", 9),
);

console.log("\ncv-mapper CERTIFICATIONS & ACHIEVEMENTS regression\n");

check("1: E2E combined section yields exactly 2 certs + 2 achievements", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.certifications.length, 2, JSON.stringify(cv.certifications));
  assert.equal(cv.achievements.length, 2, JSON.stringify(cv.achievements));
});

check("2: certification names and dates preserved exactly", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.ok(cv.certifications.includes("AWS Certified Cloud Practitioner (synthetic) - 2025"),
    JSON.stringify(cv.certifications));
  assert.ok(cv.certifications.includes("Google Data Analytics Certificate (synthetic) - 2024"),
    JSON.stringify(cv.certifications));
});

check("3: achievement names and dates preserved exactly", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.ok(cv.achievements.includes("University Merit Scholarship - 2024"),
    JSON.stringify(cv.achievements));
  assert.ok(cv.achievements.includes("Hackathon Finalist, CodeSprint - 2025"),
    JSON.stringify(cv.achievements));
});

check("4: no concatenated or cross-misfiled records", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  for (const c of cv.certifications) {
    assert.doesNotMatch(c, /Scholarship|Hackathon|Finalist/);
    assert.ok(!(/Practitioner/.test(c) && /Analytics/.test(c)), `concatenated: ${c}`);
  }
  for (const a of cv.achievements) {
    assert.doesNotMatch(a, /Certified|Certificate/);
  }
});

check("5: two certifications in one block via pipe and semicolon", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "Azure Fundamentals - 2023 | Scrum Master PSM I - 2022; ITIL Foundation - 2021", 1),
  ));
  assert.equal(cv.certifications.length, 3, JSON.stringify(cv.certifications));
  assert.ok(cv.certifications.includes("Azure Fundamentals - 2023"));
  assert.ok(cv.certifications.includes("Scrum Master PSM I - 2022"));
  assert.ok(cv.certifications.includes("ITIL Foundation - 2021"));
});

check("6: two achievements in one merged block", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Achievements", 0),
    B("text", "Dean's List - 2022 National Robotics Olympiad Winner - 2021", 1),
  ));
  assert.equal(cv.achievements.length, 2, JSON.stringify(cv.achievements));
  assert.ok(cv.achievements.includes("Dean's List - 2022"));
  assert.ok(cv.achievements.includes("National Robotics Olympiad Winner - 2021"));
});

check("7: standalone headings keep their own buckets", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "PMP - 2023", 1),
    B("section_header", "Achievements", 2),
    B("text", "Employee of the Year - 2023", 3),
  ));
  assert.deepEqual(cv.certifications, ["PMP - 2023"]);
  assert.deepEqual(cv.achievements, ["Employee of the Year - 2023"]);
});

check("8: item evidence routes a scholarship out of a certifications block", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "TOEFL Certificate - 2023 | Best Paper Award - 2022", 1),
  ));
  assert.deepEqual(cv.certifications, ["TOEFL Certificate - 2023"]);
  assert.deepEqual(cv.achievements, ["Best Paper Award - 2022"]);
});

check("9: dateless entries are preserved without invented dates", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "PMP", 1),
  ));
  assert.deepEqual(cv.certifications, ["PMP"]);
});

check("10: ambiguous items keep the section's own bucket", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "Sun Microsystems Campus Ambassador - 2020", 1),
  ));
  assert.deepEqual(cv.certifications, ["Sun Microsystems Campus Ambassador - 2020"]);
  assert.deepEqual(cv.achievements, []);
});

check("11: descriptive prose fabricates no records", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications & Achievements", 0),
    B("text", "I earned several certifications during college and won a prize once.", 1),
  ));
  assert.deepEqual(cv.certifications, [], JSON.stringify(cv.certifications));
  assert.deepEqual(cv.achievements, [], JSON.stringify(cv.achievements));
});

check("12: no duplicate records when the same block repeats", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "AWS Certified Developer - 2023 | AWS Certified Developer - 2023", 1),
  ));
  assert.deepEqual(cv.certifications, ["AWS Certified Developer - 2023"]);
});

check("13: no contamination of other sections or skills buckets", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.equal(cv.experience.length, 1);
  assert.equal(cv.education.length, 1);
  const allSkills = [...cv.skills.technical, ...cv.skills.programming,
    ...cv.skills.tools, ...cv.skills.software, ...cv.skills.domain, ...cv.skills.soft];
  for (const s of allSkills) {
    assert.doesNotMatch(s, /Certified|Scholarship|Hackathon/);
  }
});

check("15: parenthetical qualifier after a date stays attached", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "AWS Certified Developer - 2024 (Renewed) | Google Cloud Certificate - 2023", 1),
    B("section_header", "Achievements", 2),
    B("text", "National Science Scholarship - 2023 (Merit-based)", 3),
  ));
  assert.equal(cv.certifications.length, 2, JSON.stringify(cv.certifications));
  assert.ok(cv.certifications.includes("AWS Certified Developer - 2024 (Renewed)"));
  assert.ok(cv.certifications.includes("Google Cloud Certificate - 2023"));
  assert.deepEqual(cv.achievements, ["National Science Scholarship - 2023 (Merit-based)"],
    JSON.stringify(cv.achievements));
  for (const x of [...cv.certifications, ...cv.achievements]) {
    assert.doesNotMatch(x, /^\(/, `standalone qualifier record: ${x}`);
  }
});

check("16: determiner-led credential title preserved as achievement", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Achievements", 0),
    B("text", "The President's Award - 2023", 1),
    B("text", "The award was given to several students last year.", 2),
  ));
  assert.deepEqual(cv.achievements, ["The President's Award - 2023"],
    JSON.stringify(cv.achievements));
});

check("14: full ParsedCV mapping survives sanitization", () => {
  const cv = mapDoclingToParsedCV(E2E_DOC);
  assert.ok(Array.isArray(cv.certifications) && Array.isArray(cv.achievements));
  assert.equal(cv.certifications.length + cv.achievements.length, 4);
});

// ---- Brick 7A: non-credential footer/disclaimer rejection ----
// Real docling block 24 from new_applicant_e2e_resume_2026-10-23.pdf
// (type "text", trailing the combined credentials section) was stored
// as a third certification.

const ELODIE_TAIL = doc(
  B("section_header", "ÉLODIE DURAND", 0),
  B("text", "Lyon, France | +33 6 12 34 56 78 | elodie.durand.e2e@example.test", 1),
  B("section_header", "CERTIFICATIONS & ACHIEVEMENTS", 2),
  B("text", "AWS Certified Cloud Practitioner - 2025 Google Data Analytics Certificate - 2024", 3),
  B("text", "Regional Data Hackathon Finalist - 2025 | Academic Merit Scholarship - 2024", 4),
  B("text", "SYNTHETIC QA TEST DATA - No real person, employment or credential claims.", 5),
);

check("17: real PDF footer yields exactly 2 certs + 2 achievements, zero disclaimer records", () => {
  const cv = mapDoclingToParsedCV(ELODIE_TAIL);
  assert.deepEqual(cv.certifications, [
    "AWS Certified Cloud Practitioner - 2025",
    "Google Data Analytics Certificate - 2024",
  ], JSON.stringify(cv.certifications));
  assert.deepEqual(cv.achievements, [
    "Regional Data Hackathon Finalist - 2025",
    "Academic Merit Scholarship - 2024",
  ], JSON.stringify(cv.achievements));
  for (const x of [...cv.certifications, ...cv.achievements]) {
    assert.doesNotMatch(x, /synthetic|test data|claims|real person/i, `footer leaked: ${x}`);
  }
});

check("18: footer after a standalone certifications section is dropped", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "PMP - 2023", 1),
    B("text", "All details provided are fictional and used for validation purposes.", 2),
  ));
  assert.deepEqual(cv.certifications, ["PMP - 2023"], JSON.stringify(cv.certifications));
});

check("19: footer after a standalone achievements section is dropped", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Achievements", 0),
    B("text", "National Science Scholarship - 2023", 1),
    B("text", "This document is confidential and intended for review only.", 2),
  ));
  assert.deepEqual(cv.achievements, ["National Science Scholarship - 2023"],
    JSON.stringify(cv.achievements));
});

check("20: ordinary punctuated prose forms create no records", () => {
  for (const prose of [
    "Document generated for testing purposes only.",
    "References available on request.",
    "Candidate consent obtained for data processing.",
  ]) {
    const cv = mapDoclingToParsedCV(doc(
      B("section_header", "Certifications & Achievements", 0),
      B("text", "AWS Certified Developer - 2024", 1),
      B("text", prose, 2),
    ));
    assert.deepEqual(cv.certifications, ["AWS Certified Developer - 2024"],
      `prose leaked (${prose}): ${JSON.stringify(cv.certifications)}`);
    assert.deepEqual(cv.achievements, []);
  }
});

check("21: unpunctuated clause trailer after a dash is not a credential", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "Google Cloud Certificate - 2023", 1),
    B("text", "SAMPLE RESUME - For testing and validation use only", 2),
  ));
  assert.deepEqual(cv.certifications, ["Google Cloud Certificate - 2023"],
    JSON.stringify(cv.certifications));
});

check("22: genuine credentials survive next to a footer", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "PMP", 1),
    B("text", "CompTIA Security+ - 2024", 2),
    B("text", "Six Sigma Green Belt - 2023", 3),
    B("text", "AWS Certified Developer - 2024 (Renewed)", 4),
    B("text", "SYNTHETIC QA TEST DATA - No real person, employment or credential claims.", 5),
  ));
  assert.deepEqual(cv.certifications, [
    "PMP",
    "CompTIA Security+ - 2024",
    "Six Sigma Green Belt - 2023",
    "AWS Certified Developer - 2024 (Renewed)",
  ], JSON.stringify(cv.certifications));
});

check("23: titled credential ending with a period is preserved", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "Google Cloud Certificate - 2023.", 1),
  ));
  assert.deepEqual(cv.certifications, ["Google Cloud Certificate - 2023"],
    JSON.stringify(cv.certifications));
});

// ---- Brick 7A follow-up: punctuated titled credentials ----
// Terminal .!? alone is not prose evidence — titled records ending in a
// period must survive. Identified in independent review.

check("24: punctuated titled credentials are preserved and routed", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications & Achievements", 0),
    B("text", "AWS Certified Developer, Associate - 2024.", 1),
    B("text", "Certificate in machine learning.", 2),
    B("text", "Hackathon Finalist, CodeSprint - 2025.", 3),
  ));
  assert.deepEqual(cv.certifications, [
    "AWS Certified Developer, Associate - 2024",
    "Certificate in machine learning",
  ], JSON.stringify(cv.certifications));
  assert.deepEqual(cv.achievements, ["Hackathon Finalist, CodeSprint - 2025"],
    JSON.stringify(cv.achievements));
});

check("25: footer still rejected beside punctuated credentials", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications & Achievements", 0),
    B("text", "AWS Certified Developer, Associate - 2024.", 1),
    B("text", "SYNTHETIC QA TEST DATA - No real person, employment or credential claims.", 2),
  ));
  assert.deepEqual(cv.certifications, ["AWS Certified Developer, Associate - 2024"],
    JSON.stringify(cv.certifications));
  assert.deepEqual(cv.achievements, []);
});

check("26: punctuated prose naming a credential keyword mid-sentence stays rejected", () => {
  const cv = mapDoclingToParsedCV(doc(
    B("section_header", "Certifications", 0),
    B("text", "PMP - 2023", 1),
    B("text", "No real certification claims on file.", 2),
  ));
  assert.deepEqual(cv.certifications, ["PMP - 2023"], JSON.stringify(cv.certifications));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
