/**
 * cv-parser-education-regression.test.ts
 * Regression for multi-line Indian secondary-school CV format where
 * subject lines and co-curricular lines were falsely promoted into
 * Education because of missing word boundaries in keyword regexes.
 */
import assert from "node:assert/strict";
import { parseCVText } from "../src/lib/application/cv-parser";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const MULTI_LINE_CV = `
Akshansh Patel
Contact No. (+91) 9909907503- akshanshpatel18@gmail.com
OBJECTIVE
Higher secondary graduate seeking admission to a Bachelor's program.
EDUCATION
Gujarat Secondary and Higher Secondary Education Board.                                     JUN 2024- FEB-MAR 2025
Nirman High School
12th Standard
Percentage-77.2%
Gujarat Secondary and Higher Secondary Education Board	                                     JUN 2022 -MAR 2023
Nirman High School
10th Standard
Percentage- 70.83%
SUBJECTS KNOWN
ACCOUNTANCY
Accounting for partnership reconstitution and dissolution
Accounting for share capital and debentures
Analysis of financial statements
Cash flow statements
STATISTICS
Index numbers
Linear correlation and regression
Time series, normal distribution, limits and differentiation
Probability, random variables, and discrete probability
ECONOMICS
Introduction to microeconomics and macroeconomics
Basics of money market and capital markets in India
Analysis of demand and supply
CO-CURRICULAR ACTIVITIES
Media Relations Volunteer – BAPS Swaminarayan Sanstha; contributed to community events including Karyakar Suvarna Mahotsav (December 2024).
Audio Video Volunteer – Pramukh Varni Amrut Mahotsav, Ahmedabad (December 2025).
Participated in various BAPS social and community initiatives and other community events.
Participated in the SOF International Mathematics Olympiad, Level 1 (Dec 2019, Class 7).
Part of a 6,500-student world record krumping performance organized by Nirman Foundation Charitable Trust, Ahmedabad, supporting the "Save Girl Child and Educate Girl Child" cause (Nov 2019).
Participated in school Sports Day and Kabaddi at Khel Mahakumbh.
SKILLS
Knowledge of business management: planning, organising, staffing, directing and controlling
`.trim();

check("1: multi-line CV extracts exactly 2 education records", () => {
  const parsed = parseCVText(MULTI_LINE_CV);
  assert.equal(parsed.education.length, 2, `expected 2 education records, got ${parsed.education.length}`);
});

check("2: 12th record has correct institution and score", () => {
  const parsed = parseCVText(MULTI_LINE_CV);
  const twelfth = parsed.education.find(e => e.degree.includes("12th"));
  assert.ok(twelfth, "expected 12th record");
  assert.equal(twelfth.institution, "Nirman High School");
  assert.equal(twelfth.cgpa, "77.2");
});

check("3: 10th record has correct institution and score", () => {
  const parsed = parseCVText(MULTI_LINE_CV);
  const tenth = parsed.education.find(e => e.degree.includes("10th"));
  assert.ok(tenth, "expected 10th record");
  assert.equal(tenth.institution, "Nirman High School");
  assert.equal(tenth.cgpa, "70.83");
});

check("4: subject and co-curricular lines are NOT promoted to education", () => {
  const parsed = parseCVText(MULTI_LINE_CV);
  const bogusDegrees = [
    "Time series",
    "limits and differentiation",
    "Audio Video Volunteer",
    "Save Girl Child",
    "Part",
    "be",
    "me",
  ];
  for (const bogus of bogusDegrees) {
    const found = parsed.education.some(e =>
      e.degree.toLowerCase().includes(bogus.toLowerCase()) ||
      e.institution.toLowerCase().includes(bogus.toLowerCase())
    );
    assert.ok(!found, `expected no education record containing "${bogus}"`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
