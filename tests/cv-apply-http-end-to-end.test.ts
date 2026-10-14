/**
 * cv-apply-http-end-to-end.test.ts — Real HTTP end-to-end test.
 *
 * Calls the actual /api/application/cv-upload and /api/application/cv-apply
 * endpoints via HTTP against a local dev server, then verifies DB state.
 *
 * Requirements:
 *   - Dev server running on port 5011
 *   - Test database must exist at 127.0.0.1:3306 (name MUST contain "test")
 *
 * This is the true end-to-end test the simulated merge tests do not cover.
 *
 * CI SAFETY:
 *   - Missing server or DB → FAIL (not skip)
 *   - Synthetic DOCX fixture generated on the fly (no committed binaries)
 *   - Only test-named databases allowed
 *   - Only test-created student IDs are deleted in cleanup
 */
import assert from "node:assert/strict";
import { getDbPool } from "../src/lib/application/db";
import { createStudent, getStudentProfile, getStudentProfileRevision } from "../src/lib/application/application-repository";

// Database credentials from environment (defaults for local dev only)
process.env.SOP_DB_HOST = process.env.SOP_DB_HOST || "127.0.0.1";
process.env.SOP_DB_PORT = process.env.SOP_DB_PORT || "3306";
process.env.SOP_DB_USER = process.env.SOP_DB_USER || "root";
process.env.SOP_DB_PASSWORD = process.env.SOP_DB_PASSWORD || "";
process.env.SOP_DB_NAME = process.env.SOP_DB_NAME || "sop_ai_app_test";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:5011";
const DB_NAME = process.env.SOP_DB_NAME;

if (!DB_NAME || !DB_NAME.toLowerCase().includes("test")) {
  console.error(`FATAL: Refusing to run against non-test database: "${DB_NAME}"`);
  process.exit(1);
}

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

/* ---------- synthetic fixture ---------- */

// Fictitious test identity — must match the synthetic fixture content
const TEST_FIRST_NAME = "Avery";
const TEST_LAST_NAME = "Testington";
const TEST_EMAIL = "avery.testington@example-test.local";

async function generateSyntheticDocx(): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: `${TEST_FIRST_NAME} ${TEST_LAST_NAME}`,
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph(TEST_EMAIL),
        new Paragraph({
          text: "EDUCATION",
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph("State University — Bachelor of Technology in Computer Science — 2019-2023 — CGPA 8.5"),
        new Paragraph({
          text: "EXPERIENCE",
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph("TechCorp — Software Engineer Intern — June 2023 to August 2023"),
        new Paragraph({
          text: "PROJECTS",
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph("AI Chatbot — NLP-based chatbot using Python and TensorFlow"),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

/* ---------- main ---------- */

async function main() {
  const createdStudentIds: string[] = [];

  // Cleanup helper — runs in finally
  async function cleanup() {
    const pool = getDbPool();
    if (createdStudentIds.length > 0) {
      const placeholders = createdStudentIds.map(() => "?").join(",");
      await pool.execute(`DELETE FROM students WHERE id IN (${placeholders})`, createdStudentIds);
      console.log(`   Cleaned up ${createdStudentIds.length} test student(s)`);
    }
  }

  try {
    // Verify dev server is reachable
    await check("0: Dev server reachable", async () => {
      const res = await fetch(`${BASE_URL}/students`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok && res.status !== 404) throw new Error(`Server returned ${res.status}`);
    });

    // Verify test database connection
    await check("0b: Test database connection", async () => {
      const pool = getDbPool();
      const [rows] = await pool.execute("SELECT DATABASE() AS db");
      const actualDb = (rows as any[])[0]?.db;
      assert.equal(actualDb, DB_NAME, `expected DB ${DB_NAME}, got ${actualDb}`);
    });

    /* ============================================================
     * Create isolated test student
     * ============================================================ */
    let studentId: string;
    let applicationId = "test-app-" + Date.now();
    await check("1: Create test student matching synthetic CV identity", async () => {
      const s = await createStudent({
        firstName: TEST_FIRST_NAME,
        lastName: TEST_LAST_NAME,
        email: TEST_EMAIL,
        profileData: {},
      });
      studentId = s.id;
      createdStudentIds.push(studentId);
      assert.ok(studentId);
      console.log(`   Student ID: ${studentId}`);
    });

    /* ============================================================
     * Generate fixture
     * ============================================================ */
    let fixtureBuf: Buffer;
    await check("1b: Generate synthetic DOCX fixture", async () => {
      fixtureBuf = await generateSyntheticDocx();
      assert.ok(fixtureBuf.length > 0);
    });

    /* ============================================================
     * Scenario A — First import via HTTP
     * ============================================================ */
    let uploadResult: any;
    await check("A1: HTTP cv-upload returns parsed CV", async () => {
      const form = new FormData();
      const blob = new Blob([fixtureBuf!], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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

    await check("A2: HTTP cv-apply persists education/experience with provenance", async () => {
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

      // Provenance must exist and match record IDs exactly
      assert.ok(Array.isArray(profile.educationProvenance), "educationProvenance must exist");
      assert.ok(Array.isArray(profile.experienceProvenance), "experienceProvenance must exist");
      const eduIds = new Set(profile.education.map((e: any) => e.id));
      const eduProvIds = new Set(profile.educationProvenance.map((p: any) => p.id));
      assert.deepStrictEqual(eduIds, eduProvIds, "education record IDs must match provenance IDs exactly");
      const expIds = new Set(profile.experience.map((e: any) => e.id));
      const expProvIds = new Set(profile.experienceProvenance.map((p: any) => p.id));
      assert.deepStrictEqual(expIds, expProvIds, "experience record IDs must match provenance IDs exactly");

      console.log(`   Persisted education: ${profile.education.length}`);
      console.log(`   Persisted experience: ${profile.experience.length}`);
      console.log(`   New revision: ${result.revision}`);
    });

    /* ============================================================
     * Scenario B — Reimport same CV, no duplicates
     * ============================================================ */
    await check("B1: Re-upload same CV — no duplicate records", async () => {
      const form = new FormData();
      const blob = new Blob([fixtureBuf!], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      form.append("file", blob, "shivang_resume.docx");
      form.append("studentId", studentId);

      const res = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
      assert.ok(res.ok, `re-upload failed: ${res.status}`);
      const upload2 = await res.json();

      const beforeProfile = await getStudentProfile(studentId);
      const beforeEduCount = beforeProfile.education?.length || 0;
      const beforeExpCount = beforeProfile.experience?.length || 0;
      const beforeProvCount = beforeProfile.educationProvenance?.length || 0;

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
      assert.equal(afterProfile.education.length, beforeEduCount, "no duplicate education after re-apply");
      assert.equal(afterProfile.experience.length, beforeExpCount, "no duplicate experience after re-apply");
      assert.equal(afterProfile.educationProvenance?.length, beforeProvCount, "provenance count stable");
    });

    /* ============================================================
     * Scenario C — CV replacement (re-upload with replaceCvDerived)
     * ============================================================ */
    await check("C1: CV replace removes old provenance", async () => {
      // We already re-applied; now verify the provenance entries are fresh
      const profile = await getStudentProfile(studentId);
      const eduIds = new Set(profile.education.map((e: any) => e.id));
      const eduProvIds = new Set(profile.educationProvenance.map((p: any) => p.id));
      assert.deepStrictEqual(eduIds, eduProvIds, "provenance must stay in sync after re-apply");
    });

    /* ============================================================
     * Scenario D — Wrong person identity conflict
     * ============================================================ */
    let wrongStudentId: string;
    await check("D1: Wrong-person CV returns 409 CONFLICT", async () => {
      // Create a student with different identity
      const wrongStudent = await createStudent({
        firstName: "Wrong",
        lastName: "Person",
        email: `wrong-${Date.now()}@test.local`,
        profileData: {},
      });
      wrongStudentId = wrongStudent.id;
      createdStudentIds.push(wrongStudentId);

      const form = new FormData();
      const blob = new Blob([fixtureBuf!], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      form.append("file", blob, "shivang_resume.docx");
      form.append("studentId", wrongStudentId);

      const uploadRes = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
      assert.ok(uploadRes.ok);
      const uploadWrong = await uploadRes.json();

      const applyRes = await fetch(`${BASE_URL}/api/application/cv-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: wrongStudentId,
          parsedCV: uploadWrong.parsed,
          overwrite: false,
          profileRevision: uploadWrong.profileRevision,
        }),
      });

      assert.equal(applyRes.status, 409, "must reject with 409 for identity conflict");
      const body = await applyRes.json();
      assert.equal(body.code, "CV_IDENTITY_CONFLICT");

      // Verify profile unchanged
      const profile = await getStudentProfile(wrongStudentId);
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
      const form = new FormData();
      const blob = new Blob([fixtureBuf!], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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

      // Provenance must not contain the legacy id
      const provIds = (after.educationProvenance || []).map((p: any) => p.id);
      assert.ok(!provIds.includes("legacy-edu-123"), "legacy id must not appear in provenance");
    });

    /* ============================================================
     * Scenario H — Unrelated student survives cleanup
     * ============================================================ */
    let unrelatedId: string;
    await check("H1: Unrelated test student survives cleanup", async () => {
      const unrelated = await createStudent({
        firstName: "Unrelated",
        lastName: "Student",
        email: `unrelated-${Date.now()}@test.local`,
        profileData: {},
      });
      unrelatedId = unrelated.id;
      // NOTE: intentionally NOT added to createdStudentIds
    });

    await check("H2: Cleanup deletes only tracked IDs", async () => {
      const pool = getDbPool();
      const placeholders = createdStudentIds.map(() => "?").join(",");
      await pool.execute(`DELETE FROM students WHERE id IN (${placeholders})`, createdStudentIds);

      // Verify unrelated student still exists
      const [rows] = await pool.execute("SELECT id FROM students WHERE id = ?", [unrelatedId]);
      assert.ok((rows as any[]).length === 1, "unrelated student must survive targeted cleanup");

      // Now delete the unrelated student explicitly
      await pool.execute("DELETE FROM students WHERE id = ?", [unrelatedId]);
    });

  } finally {
    await cleanup();
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`==============================`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
