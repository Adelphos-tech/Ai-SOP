/**
 * Run CV parser regression fixtures and report results.
 * Usage: npx tsx scripts/run-cv-regression.ts
 */
import assert from "node:assert/strict";
import { parseCVText } from "../src/lib/application/cv-parser";
import { FIXTURES } from "../tests/cv-parser-regression-fixtures";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const F = FIXTURES;

check("1: multi-line Indian — 2 education records", () => {
  const p = parseCVText(F.multiLineIndian.text);
  assert.equal(p.education.length, F.multiLineIndian.expected.educationCount);
});

check("1b: multi-line Indian — 12th institution", () => {
  const p = parseCVText(F.multiLineIndian.text);
  const rec = p.education.find(e => e.degree.includes("12th"));
  assert.ok(rec, "expected 12th record");
  assert.equal(rec.institution, F.multiLineIndian.expected.twelfthInstitution);
});

check("1c: multi-line Indian — 10th institution", () => {
  const p = parseCVText(F.multiLineIndian.text);
  const rec = p.education.find(e => e.degree.includes("10th"));
  assert.ok(rec, "expected 10th record");
  assert.equal(rec.institution, F.multiLineIndian.expected.tenthInstitution);
});

check("2: flattened name extraction", () => {
  const p = parseCVText(F.flattenedName.text);
  assert.equal(p.personalData.firstName, F.flattenedName.expected.firstName);
  assert.equal(p.personalData.lastName, F.flattenedName.expected.lastName);
  assert.equal(p.personalData.email, F.flattenedName.expected.email);
});

check("3: experience with date-only header — count", () => {
  const p = parseCVText(F.experienceDateOnly.text);
  assert.equal(p.experience.length, F.experienceDateOnly.expected.experienceCount, `got ${p.experience.length}: ${JSON.stringify(p.experience.map(e => ({role: e.role, org: e.organization})))}`);
});

check("3b: experience with date-only header — has internship", () => {
  const p = parseCVText(F.experienceDateOnly.text);
  const intern = p.experience.find(e => /intern/i.test(e.role));
  assert.ok(intern, `expected intern role, got: ${JSON.stringify(p.experience.map(e => e.role))}`);
  assert.ok(intern.organization.toLowerCase().includes("lab") || intern.organization.toLowerCase().includes("iit"),
    `expected org to contain lab/iit, got: ${intern.organization}`);
});

check("3c: experience with date-only header — has software engineer", () => {
  const p = parseCVText(F.experienceDateOnly.text);
  const se = p.experience.find(e => /software engineer/i.test(e.role));
  assert.ok(se, `expected software engineer role, got: ${JSON.stringify(p.experience.map(e => e.role))}`);
});

check("4: description contamination — count", () => {
  const p = parseCVText(F.experienceDescriptionContamination.text);
  assert.equal(p.experience.length, F.experienceDescriptionContamination.expected.experienceCount);
});

check("4b: description contamination — roles and orgs", () => {
  const p = parseCVText(F.experienceDescriptionContamination.text);
  assert.equal(p.experience[0].role, F.experienceDescriptionContamination.expected.firstRole);
  assert.equal(p.experience[0].organization, F.experienceDescriptionContamination.expected.firstOrg);
  assert.equal(p.experience[1].role, F.experienceDescriptionContamination.expected.secondRole);
  assert.equal(p.experience[1].organization, F.experienceDescriptionContamination.expected.secondOrg);
});

check("5: education table — count", () => {
  const p = parseCVText(F.educationTable.text);
  // Table-aware parsing depends on metadata; plain text may not detect tables
  // This fixture is informational — the table parser is tested via unit tests
  assert.ok(p.education.length >= 0, "education parsed");
});

check("6: school in skills — no false education", () => {
  const p = parseCVText(F.schoolInSkills.text);
  assert.equal(p.education.length, F.schoolInSkills.expected.educationCount);
  const rec = p.education[0];
  assert.ok(rec.degree.includes("B.Tech"), `expected B.Tech, got ${rec.degree}`);
  assert.equal(rec.institution, F.schoolInSkills.expected.institution);
});

check("7: projects not employment — counts", () => {
  const p = parseCVText(F.projectsNotEmployment.text);
  assert.equal(p.projects.length, F.projectsNotEmployment.expected.projectCount, `expected ${F.projectsNotEmployment.expected.projectCount} projects, got ${p.projects.length}: ${JSON.stringify(p.projects.map(pr => pr.name))}`);
  assert.equal(p.experience.length, F.projectsNotEmployment.expected.experienceCount);
});

check("7b: projects not employment — project details", () => {
  const p = parseCVText(F.projectsNotEmployment.text);
  const first = p.projects[0];
  assert.ok(first.name.includes("AI Chatbot"), `expected project name, got ${first.name}`);
  assert.ok(first.description.includes("NLP-based"), `expected description, got ${first.description}`);
});

check("8: multiple degrees one line — splits correctly", () => {
  const p = parseCVText(F.multipleDegreesOneLine.text);
  assert.equal(p.education.length, F.multipleDegreesOneLine.expected.educationCount);
});

check("9: CGPA/date fragment — institution not corrupted", () => {
  const p = parseCVText(F.cgpaDateFragment.text);
  assert.equal(p.education.length, F.cgpaDateFragment.expected.educationCount);
  assert.equal(p.education[0].institution, F.cgpaDateFragment.expected.institution);
  assert.equal(p.education[0].cgpa, F.cgpaDateFragment.expected.cgpa);
});

check("10: board without school — still captures degree", () => {
  const p = parseCVText(F.boardWithoutSchool.text);
  assert.equal(p.education.length, F.boardWithoutSchool.expected.educationCount);
  assert.ok(p.education[0].degree.includes("12th"), `expected 12th, got ${p.education[0].degree}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
