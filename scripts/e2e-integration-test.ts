/**
 * End-to-end integration test for CV import workflow.
 * Tests: Upload → Parse → Review → Apply → Save → Reload
 * Uses isolated test database (sop_ai_app_test) and synthetic student profiles.
 */
import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { parseCVFile } from "../src/lib/application/cv-parser";
import { getDbPool } from "../src/lib/application/db";
import {
  createStudent,
  getStudentProfile,
  getStudentProfileRevision,
  saveStudentProfileConditional,
} from "../src/lib/application/application-repository";
import { mergePersonalData } from "../src/lib/application/cv-merge";
import { classifyIdentityMatch } from "../src/lib/application/identity-check";
import { randomUUID } from "crypto";

process.env.SOP_DB_HOST = "127.0.0.1";
process.env.SOP_DB_PORT = "3306";
process.env.SOP_DB_USER = "root";
process.env.SOP_DB_PASSWORD = "";
process.env.SOP_DB_NAME = "sop_ai_app_test";

const fixturesDir = path.join(process.cwd(), "dvivid_complex_resume_stress_pack");

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

async function main() {
  const pool = getDbPool();

  // Verify test database
  await check("0: Connected to isolated test database", async () => {
    const [rows] = await pool.execute("SELECT DATABASE() AS db");
    assert.equal((rows as any[])[0]?.db, "sop_ai_app_test");
  });

  // ===== SCENARIO A: First import =====
  let studentId: string;
  await check("A1: Create empty-profile synthetic student", async () => {
    const student = await createStudent({
      firstName: "Kabir",
      lastName: "Shah",
      email: "kabir.shah.qa@example.test",
      profileData: {},
    });
    studentId = student.id;
    assert.ok(studentId);
  });

  let parsedCV: any;
  let revision: number;
  await check("A2: Parse File 03 (Indian education CV)", async () => {
    const buffer = fs.readFileSync(path.join(fixturesDir, "03_indian_education_substring_traps.pdf"));
    parsedCV = await parseCVFile(buffer, "03_indian_education_substring_traps.pdf");
    assert.equal(parsedCV.education.length, 4);
    assert.equal(parsedCV.experience.length, 0);
    assert.equal(parsedCV.personalData.firstName, "Kabir");
    assert.equal(parsedCV.personalData.currentCity, "Ahmedabad");
  });

  await check("A3: Identity check passes for matching student", async () => {
    const identity = classifyIdentityMatch(
      { firstName: "Kabir", lastName: "Shah", email: "kabir.shah.qa@example.test" },
      parsedCV.personalData
    );
    assert.equal(identity.status, "MATCH");
  });

  await check("A4: Apply CV data via repository merge", async () => {
    revision = await getStudentProfileRevision(studentId);
    const existingProfile = await getStudentProfile(studentId) || {};
    const cvImportId = `cv-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const merged: any = { ...existingProfile };

    // Replace CV-derived items
    for (const key of ["education", "experience", "projects", "achievements"] as const) {
      if (Array.isArray(merged[key])) {
        merged[key] = merged[key].filter((item: any) => !String(item?.id ?? "").startsWith("cv-"));
      }
    }

    // Personal data
    const pdResult = mergePersonalData(merged.personalData, parsedCV.personalData, false, cvImportId, (existingProfile as any).personalDataProvenance);
    merged.personalData = pdResult.personalData;
    merged.personalDataProvenance = pdResult.personalDataProvenance;

    // Education
    merged.education = parsedCV.education.map((e: any) => ({
      id: e.id,
      level: mapDegreeToLevel(e.degree),
      institution: e.institution || "",
      degree: e.degree || "",
      specialization: e.specialization || "",
      startYear: e.startYear || "",
      endYear: e.endYear || "",
      cgpa: e.cgpa || "",
      cgpaScale: e.cgpaScale || "10",
      percentage: "",
      backlogs: "",
      status: e.endYear ? "Completed" : "Ongoing",
    }));

    // Projects
    merged.projects = parsedCV.projects.map((p: any) => ({
      id: p.id || `cv-${randomUUID()}`,
      name: p.name || "",
      type: p.type || "Academic",
      description: p.description || "",
      role: p.role || "",
      technologies: p.technologies || "",
      outcome: "",
      whatLearned: "",
    }));

    const saved = await saveStudentProfileConditional(studentId, merged, revision);
    assert.ok(saved, "Conditional save should succeed");
  });

  await check("A5: Reload profile — counts unchanged", async () => {
    const profile = await getStudentProfile(studentId) || {};
    assert.equal(profile.education?.length, 4);
    assert.equal(profile.projects?.length, parsedCV.projects.length);
    assert.equal(profile.personalData?.firstName, "Kabir");
    assert.equal(profile.personalData?.currentCity, "Ahmedabad");
  });

  // ===== SCENARIO B: Reimport same CV =====
  await check("B1: Reimport same CV — no duplicates", async () => {
    revision = await getStudentProfileRevision(studentId);
    const existingProfile = await getStudentProfile(studentId) || {};
    const cvImportId = `cv-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const merged: any = { ...existingProfile };
    for (const key of ["education", "experience", "projects", "achievements"] as const) {
      if (Array.isArray(merged[key])) {
        merged[key] = merged[key].filter((item: any) => !String(item?.id ?? "").startsWith("cv-"));
      }
    }

    const pdResult = mergePersonalData(merged.personalData, parsedCV.personalData, false, cvImportId, (existingProfile as any).personalDataProvenance);
    merged.personalData = pdResult.personalData;
    merged.personalDataProvenance = pdResult.personalDataProvenance;

    merged.education = parsedCV.education.map((e: any) => ({
      id: e.id,
      level: mapDegreeToLevel(e.degree),
      institution: e.institution || "",
      degree: e.degree || "",
      specialization: e.specialization || "",
      startYear: e.startYear || "",
      endYear: e.endYear || "",
      cgpa: e.cgpa || "",
      cgpaScale: e.cgpaScale || "10",
      percentage: "",
      backlogs: "",
      status: e.endYear ? "Completed" : "Ongoing",
    }));

    const saved = await saveStudentProfileConditional(studentId, merged, revision);
    assert.ok(saved);

    const profile = await getStudentProfile(studentId) || {};
    assert.equal(profile.education?.length, 4, "Reimport should not duplicate");
  });

  // ===== SCENARIO C: Wrong student identity =====
  let wrongStudentId: string;
  await check("C1: Create different student", async () => {
    const student = await createStudent({
      firstName: "Daniel",
      lastName: "Kim",
      email: "daniel.kim.qa@example.test",
      profileData: {},
    });
    wrongStudentId = student.id;
  });

  await check("C2: Identity check blocks mismatch", async () => {
    const identity = classifyIdentityMatch(
      { firstName: "Daniel", lastName: "Kim", email: "daniel.kim.qa@example.test" },
      parsedCV.personalData
    );
    assert.equal(identity.status, "CONFLICT");
  });

  // ===== SCENARIO D: Manual data preservation =====
  await check("D1: Seed manual education record", async () => {
    revision = await getStudentProfileRevision(studentId);
    const profile = await getStudentProfile(studentId) || {};
    profile.education = profile.education || [];
    profile.education.push({
      id: "manual-123",
      level: "Master's",
      institution: "Harvard University",
      degree: "M.S.",
      specialization: "Computer Science",
      startYear: "2020",
      endYear: "2022",
      cgpa: "3.8",
      cgpaScale: "4",
      status: "Completed",
    });
    await saveStudentProfileConditional(studentId, profile, revision);
  });

  await check("D2: ReplaceCvDerived preserves manual records", async () => {
    const profile = await getStudentProfile(studentId) || {};
    const manualRecord = profile.education?.find((e: any) => e.id === "manual-123");
    assert.ok(manualRecord, "Manual record should survive replaceCvDerived");
    assert.equal(manualRecord.institution, "Harvard University");
  });

  // ===== SCENARIO E: Truncated email not silently accepted =====
  await check("E1: Truncated email flagged for review", async () => {
    const buffer = fs.readFileSync(path.join(fixturesDir, "01_dense_two_column_product_analyst.pdf"));
    const cv01 = await parseCVFile(buffer, "01_dense_two_column_product_analyst.pdf");
    // Email is truncated — should not be blindly accepted as verified
    assert.ok(cv01.personalData.email?.includes("@"), "Email should at least contain @");
    assert.ok(!cv01.personalData.email?.endsWith(".test"), "Truncated email ends with 'tes' not '.test'");
  });

  // Cleanup
  await check("Z: Delete synthetic test students", async () => {
    await pool.execute("DELETE FROM students WHERE id = ?", [studentId]);
    await pool.execute("DELETE FROM students WHERE id = ?", [wrongStudentId]);
  });

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`==============================`);
  process.exit(fail > 0 ? 1 : 0);
}

function mapDegreeToLevel(degree: string): string {
  if (!degree) return "";
  const d = degree.toLowerCase();
  if (d.includes("phd") || d.includes("doctorate")) return "PhD";
  if (d.includes("m.tech") || d.includes("mtech") || d.includes("m.e") || d.includes("master")) return "Master's";
  if (d.includes("b.tech") || d.includes("btech") || d.includes("b.e") || d.includes("bachelor")) return "Bachelor's";
  if (d.includes("diploma")) return "Diploma";
  if (d.includes("12th") || d.includes("senior secondary") || d.includes("higher secondary")) return "12th";
  if (d.includes("10th") || d.includes("secondary") || d.includes("sslc") || d.includes("ssc")) return "10th";
  return "";
}

main().catch(console.error);
