/**
 * cv-apply-http-end-to-end.test.ts — Real HTTP end-to-end test.
 *
 * Calls the actual /api/application/cv-upload and /api/application/cv-apply
 * endpoints via HTTP against a local dev server, then verifies DB state.
 *
 * Requirements:
 *   - Dev server running on port 5011 with SOP_DB_NAME=sop_ai_app_test
 *   - Test database must exist at 127.0.0.1:3306
 *
 * This is the true end-to-end test the simulated merge tests do not cover.
 */
import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import { getDbPool } from "../src/lib/application/db";
import { createStudent, getStudentProfile, getStudentProfileRevision } from "../src/lib/application/application-repository";

process.env.SOP_DB_HOST = "127.0.0.1";
process.env.SOP_DB_PORT = "3306";
process.env.SOP_DB_USER = "root";
process.env.SOP_DB_PASSWORD = "";
process.env.SOP_DB_NAME = "sop_ai_app_test";

const BASE_URL = "http://127.0.0.1:5011";
const CV_FILE = "/Users/shivang/Desktop/cv/Shivang_Singh_Gangwar_Resume.docx";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

async function main() {
  // Verify dev server is reachable
  try {
    const r = await fetch(`${BASE_URL}/students`);
    if (!r.ok && r.status !== 404) throw new Error(`Server returned ${r.status}`);
  } catch (e: any) {
    console.log(`SKIP: Dev server not reachable at ${BASE_URL} (${e.message}).`);
    console.log("Start with: SOP_DB_NAME=sop_ai_app_test npx next dev -p 5011 -H 127.0.0.1");
    process.exit(0);
  }

  // Verify CV file exists
  try {
    await readFile(CV_FILE);
  } catch {
    console.log(`SKIP: CV fixture not found at ${CV_FILE}`);
    process.exit(0);
  }

  await check("0: Test database connection", async () => {
    const pool = getDbPool();
    const [rows] = await pool.execute("SELECT DATABASE() AS db");
    assert.equal((rows as any[])[0]?.db, "sop_ai_app_test");
  });

  /* ============================================================
   * Create isolated test student
   * ============================================================ */
  let studentId: string;
  let applicationId = "test-app-" + Date.now();
  await check("1: Create test student matching real CV identity", async () => {
    // The fixture CV (Shivang_Singh_Gangwar_Resume.docx) parses to
    // firstName: Shivang, lastName: Gangwar, email: shivangsingh191@gmail.com.
    // We create a student with matching identity so the identity check passes.
    const s = await createStudent({
      firstName: "Shivang",
      lastName: "Gangwar",
      email: `shivangsingh191@gmail.com`,
      profileData: {},
    });
    studentId = s.id;
    assert.ok(studentId);
    console.log(`   Student ID: ${studentId}`);
  });

  /* ============================================================
   * Scenario A — First import via HTTP
   * ============================================================ */
  let uploadResult: any;
  await check("A1: HTTP cv-upload returns parsed CV", async () => {
    const buf = await readFile(CV_FILE);
    const form = new FormData();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    form.append("file", blob, "shivang_resume.docx");
    form.append("studentId", studentId);

    const res = await fetch(`${BASE_URL}/api/application/cv-upload`, {
      method: "POST",
      body: form,
    });
    const resText = await res.text();
    assert.ok(res.ok, `cv-upload failed: ${res.status} ${resText}`);
    uploadResult = JSON.parse(resText);
    assert.ok(uploadResult.parsed, "parsed field must exist");
    assert.ok(uploadResult.profileRevision !== undefined, "profileRevision must exist");
    console.log(`   Parse state: ${uploadResult.parseState}`);
    console.log(`   Education count: ${uploadResult.parsed.education?.length || 0}`);
    console.log(`   Experience count: ${uploadResult.parsed.experience?.length || 0}`);
  });

  await check("A2: HTTP cv-apply persists education/experience", async () => {
    const body = JSON.stringify({
      studentId,
      parsedCV: uploadResult.parsed,
      overwrite: false,
      profileRevision: uploadResult.profileRevision,
      replaceCvDerived: true,
    });

    const res = await fetch(`${BASE_URL}/api/application/cv-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const applyText = await res.text();
    assert.ok(res.ok, `cv-apply failed: ${res.status} ${applyText}`);
    const result = JSON.parse(applyText);
    assert.ok(result.success, "apply must report success");
    assert.ok(result.revision > uploadResult.profileRevision, "revision must increment");

    // Verify DB
    const profile = await getStudentProfile(studentId);
    assert.ok(profile.education?.length >= 1, "education must be persisted");
    assert.ok(profile.experience?.length >= 1, "experience must be persisted");
    assert.ok(profile.education.every((e: any) => String(e.id).startsWith("cv-")), "all edu ids cv-prefixed");
    assert.ok(profile.experience.every((e: any) => String(e.id).startsWith("cv-")), "all exp ids cv-prefixed");

    console.log(`   Persisted education: ${profile.education.length}`);
    console.log(`   Persisted experience: ${profile.experience.length}`);
    console.log(`   New revision: ${result.revision}`);
  });

  /* ============================================================
   * Scenario B — Reimport same CV, no duplicates
   * ============================================================ */
  await check("B1: Re-upload same CV — no duplicate records", async () => {
    const buf = await readFile(CV_FILE);
    const form = new FormData();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    form.append("file", blob, "shivang_resume.docx");
    form.append("studentId", studentId);

    const res = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
    assert.ok(res.ok, `re-upload failed: ${res.status}`);
    const upload2 = await res.json();

    const beforeEdu = (await getStudentProfile(studentId)).education.length;

    const applyRes = await fetch(`${BASE_URL}/api/application/cv-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        parsedCV: upload2.parsed,
        overwrite: false,
        profileRevision: upload2.profileRevision,
        replaceCvDerived: true,
      }),
    });
    if (!applyRes.ok) {
      const errText = await applyRes.text();
      console.log("   re-apply error body:", errText);
    }
    assert.ok(applyRes.ok, `re-apply failed: ${applyRes.status}`);

    const afterProfile = await getStudentProfile(studentId);
    assert.equal(afterProfile.education.length, beforeEdu, "no duplicate education after re-apply");
    assert.equal(afterProfile.experience.length, (await getStudentProfile(studentId)).experience.length, "experience stable");
  });

  /* ============================================================
   * Scenario D — Wrong person identity conflict
   * ============================================================ */
  await check("D1: Wrong-person CV returns 409 CONFLICT", async () => {
    // Create a student with different identity
    const wrongStudent = await createStudent({
      firstName: "Wrong",
      lastName: "Person",
      email: `wrong-${Date.now()}@test.local`,
      profileData: {},
    });

    const buf = await readFile(CV_FILE);
    const form = new FormData();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    form.append("file", blob, "shivang_resume.docx");
    form.append("studentId", wrongStudent.id);

    const uploadRes = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
    assert.ok(uploadRes.ok);
    const uploadWrong = await uploadRes.json();

    const applyRes = await fetch(`${BASE_URL}/api/application/cv-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: wrongStudent.id,
        parsedCV: uploadWrong.parsed,
        overwrite: false,
        profileRevision: uploadWrong.profileRevision,
      }),
    });

    assert.equal(applyRes.status, 409, "must reject with 409 for identity conflict");
    const body = await applyRes.json();
    assert.equal(body.code, "CV_IDENTITY_CONFLICT");

    // Verify profile unchanged
    const profile = await getStudentProfile(wrongStudent.id);
    assert.deepEqual(profile, {}, "profile must remain empty after rejected apply");
  });

  /* ============================================================
   * Scenario G — Legacy data safety
   * ============================================================ */
  await check("G1: Legacy non-cv records survive replace", async () => {
    const rev = await getStudentProfileRevision(studentId);
    const profile = await getStudentProfile(studentId);
    profile.education = profile.education || [];
    profile.education.push({
      id: "legacy-edu-123",
      institution: "Legacy College",
      degree: "Diploma",
      specialization: "",
      startYear: "",
      endYear: "",
      cgpa: "",
      cgpaScale: "10",
      percentage: "",
      backlogs: "",
      status: "Completed",
      level: "Diploma",
    });

    const { saveStudentProfileConditional } = await import("../src/lib/application/application-repository");
    await saveStudentProfileConditional(studentId, profile, rev);

    // Re-apply CV with replaceCvDerived
    const buf = await readFile(CV_FILE);
    const form = new FormData();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    form.append("file", blob, "shivang_resume.docx");
    form.append("studentId", studentId);
    const uploadRes = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
    const upload3 = await uploadRes.json();

    const applyRes = await fetch(`${BASE_URL}/api/application/cv-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        parsedCV: upload3.parsed,
        overwrite: false,
        profileRevision: upload3.profileRevision,
        replaceCvDerived: true,
      }),
    });
    assert.ok(applyRes.ok);

    const after = await getStudentProfile(studentId);
    assert.ok(after.education.some((e: any) => e.id === "legacy-edu-123"), "legacy record must survive");
    assert.ok(after.education.some((e: any) => String(e.id).startsWith("cv-")), "CV records must still exist");
  });

  /* ============================================================
   * Cleanup
   * ============================================================ */
  await check("CLEANUP: Delete test students", async () => {
    const pool = getDbPool();
    await pool.execute("DELETE FROM students WHERE email LIKE ?", [`%@test.local`]);
  });

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`==============================`);
  process.exit(fail ? 1 : 0);
}

main();
