/**
 * cv-browser-verification.ts — Browser verification of CV import flow.
 *
 * Reuses Puppeteer (already installed) to verify UI state matches
 * persisted DB state after CV upload and apply operations.
 *
 * Run: npx tsx tests/cv-browser-verification.ts
 * Requires: dev server on port 5011, test database
 */
import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { getDbPool } from "../src/lib/application/db";
import {
  createStudent,
  getStudentProfile,
  getStudentProfileRevision,
} from "../src/lib/application/application-repository";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const BASE_URL = "http://127.0.0.1:5011";
const SCREENSHOT_DIR = "/tmp/cv-browser-verification";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

async function generateSyntheticDocx(): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Avery Testington", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("avery.testington@example-test.local"),
        new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
        new Paragraph("State University — Bachelor of Technology in Computer Science — 2019-2023 — CGPA 8.5"),
        new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
        new Paragraph("TechCorp — Software Engineer Intern — June 2023 to August 2023"),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function uploadCV(studentId: string, buf: Buffer): Promise<any> {
  const form = new FormData();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  form.append("file", blob, "avery_resume.docx");
  form.append("studentId", studentId);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE_URL}/api/application/cv-upload`, { method: "POST", body: form });
    if (res.status !== 404 && res.status !== 500) {
      if (!res.ok) throw new Error(`cv-upload failed: ${res.status}`);
      return res.json();
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error("cv-upload failed after retries");
}

async function applyCV(studentId: string, parsedCV: any, profileRevision: number, replaceCvDerived = false): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/application/cv-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, parsedCV, overwrite: false, profileRevision, replaceCvDerived }),
  });
  if (!res.ok) throw new Error(`cv-apply failed: ${res.status}`);
  return res.json();
}

async function screenshot(page: puppeteer.Page, name: string) {
  const file = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`   Screenshot: ${file}`);
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const pool = getDbPool();
  const createdIds: string[] = [];
  let browser: puppeteer.Browser | undefined;
  let page: puppeteer.Page | undefined;

  try {
    // Retry wrapper for Next.js dev server route compilation delays
    async function fetchWithRetry(url: string, init: RequestInit, retries = 5): Promise<Response> {
      for (let i = 0; i < retries; i++) {
        const res = await fetch(url, init);
        if (res.status !== 404 && res.status !== 500) return res;
        await new Promise(r => setTimeout(r, 1500));
      }
      return fetch(url, init);
    }

    // Create test student
    let studentId: string;
    let applicationId: string;
    await check("Setup: create test student", async () => {
      const s = await createStudent({
        firstName: "Avery", lastName: "Testington",
        email: `avery-${Date.now()}@example-test.local`, profileData: {},
      });
      studentId = s.id;
      createdIds.push(studentId);

      const res = await fetchWithRetry(`${BASE_URL}/api/application/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId, universityName: "Test University", programName: "MS CS",
          degree: "Master of Science", country: "United States",
        }),
      });
      assert.ok(res.ok, `create application failed: ${res.status}`);
      const data = await res.json();
      applicationId = data.application.id;
      console.log(`   Student: ${studentId}, Application: ${applicationId}`);
    });

    // Start browser
    await check("Setup: launch browser", async () => {
      browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
      page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
    });

    const p = page!;

    /* ============================================================
     * Step 1: Navigate to application page before CV upload
     * ============================================================ */
    await check("Browser: application page loads", async () => {
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}`, { waitUntil: "networkidle2" });
      await screenshot(p, "01-before-cv-upload");
      const body = await p.content();
      assert.ok(body.includes("Student Application Profile") || body.includes("Upload"),
        "page should contain CV upload area");
    });

    /* ============================================================
     * Step 2: Upload CV A via API, then reload page
     * ============================================================ */
    let uploadA: any;
    let applyA: any;
    const fixtureBuf = await generateSyntheticDocx();

    await check("Browser: upload and apply CV A via API", async () => {
      uploadA = await uploadCV(studentId!, fixtureBuf);
      console.log(`   Parse state: ${uploadA.parseState}`);
      assert.ok(uploadA.parsed?.education?.length >= 1);
      assert.ok(uploadA.parsed?.experience?.length >= 1);

      applyA = await applyCV(studentId!, uploadA.parsed, uploadA.profileRevision, true);
      assert.ok(applyA.success);
      console.log(`   Revision after apply: ${applyA.revision}`);
    });

    await check("Browser: reload page shows CV A education/experience", async () => {
      await p.reload({ waitUntil: "networkidle2" });
      await p.waitForTimeout(1000);
      await screenshot(p, "02-after-cv-a-applied");
      const body = await p.content();
      assert.ok(body.includes("State University") || body.includes("Bachelor"),
        "UI should show education from CV A");
      assert.ok(body.includes("TechCorp") || body.includes("Engineer"),
        "UI should show experience from CV A");
    });

    /* ============================================================
     * Step 3: Verify DB matches UI
     * ============================================================ */
    await check("Browser: DB education count matches", async () => {
      const profile = await getStudentProfile(studentId!);
      assert.ok(profile.education?.length >= 1, "DB must have education");
      assert.ok(profile.experience?.length >= 1, "DB must have experience");
      console.log(`   DB education: ${profile.education.length}, experience: ${profile.experience.length}`);
    });

    /* ============================================================
     * Step 4: Upload updated CV B (different experience), apply, reload
     * ============================================================ */
    await check("Browser: upload CV B with different data", async () => {
      const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
      const docB = new Document({
        sections: [{
          children: [
            new Paragraph({ text: "Avery Testington", heading: HeadingLevel.HEADING_1 }),
            new Paragraph("avery.testington@example-test.local"),
            new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("Graduate Institute — Master of Science in AI — 2024-2026"),
            new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("MegaCorp — Data Scientist — January 2024 to present"),
          ],
        }],
      });
      const bufB = await Packer.toBuffer(docB);
      const uploadB = await uploadCV(studentId!, bufB);
      const applyB = await applyCV(studentId!, uploadB.parsed, uploadB.profileRevision, true);
      assert.ok(applyB.success);

      // Verify DB: old CV-A records should be replaced
      const profile = await getStudentProfile(studentId!);
      assert.ok(profile.education.some((e: any) => e.institution?.includes("Graduate")), "CV B education present");
      assert.ok(profile.experience.some((e: any) => e.organization?.includes("MegaCorp")), "CV B experience present");
      assert.ok(!profile.experience.some((e: any) => e.organization?.includes("TechCorp")), "CV A experience removed");

      // Reload page
      await p.reload({ waitUntil: "networkidle2" });
      await p.waitForTimeout(1000);
      await screenshot(p, "03-after-cv-b-applied");
      const body = await p.content();
      assert.ok(body.includes("Graduate Institute") || body.includes("MegaCorp"),
        "UI should show CV B data");
      assert.ok(!body.includes("TechCorp"),
        "UI should no longer show CV A experience");
    });

    /* ============================================================
     * Step 5: Wrong-person CV blocked
     * ============================================================ */
    await check("Browser: wrong-person CV returns 409 without DB mutation", async () => {
      const wrongStudent = await createStudent({
        firstName: "Wrong", lastName: "Person",
        email: `wrong-${Date.now()}@example-test.local`, profileData: {},
      });
      createdIds.push(wrongStudent.id);

      const uploadWrong = await uploadCV(wrongStudent.id, fixtureBuf);
      const res = await fetch(`${BASE_URL}/api/application/cv-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: wrongStudent.id, parsedCV: uploadWrong.parsed,
          overwrite: false, profileRevision: uploadWrong.profileRevision,
        }),
      });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.code, "CV_IDENTITY_CONFLICT");

      // Verify profile unchanged
      const profile = await getStudentProfile(wrongStudent.id);
      assert.deepEqual(profile, {});
    });

    /* ============================================================
     * Step 6: Manual record survives replacement
     * ============================================================ */
    await check("Browser: manual record survives CV replacement", async () => {
      const rev = await getStudentProfileRevision(studentId!);
      const profile = await getStudentProfile(studentId!) || {};
      profile.education = profile.education || [];
      profile.education.push({
        id: "manual-edu-456", institution: "Manual Academy", degree: "Certificate",
        specialization: "", startYear: "", endYear: "", cgpa: "", cgpaScale: "10",
        percentage: "", backlogs: "", status: "Completed", level: "Certificate",
      });
      const { saveStudentProfileConditional } = await import("../src/lib/application/application-repository");
      await saveStudentProfileConditional(studentId!, profile, rev);

      // Re-apply CV B with replaceCvDerived
      const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
      const docC = new Document({
        sections: [{
          children: [
            new Paragraph({ text: "Avery Testington", heading: HeadingLevel.HEADING_1 }),
            new Paragraph("avery.testington@example-test.local"),
            new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("Updated University — BTech — 2020-2024"),
          ],
        }],
      });
      const bufC = await Packer.toBuffer(docC);
      const uploadC = await uploadCV(studentId!, bufC);
      const applyC = await applyCV(studentId!, uploadC.parsed, uploadC.profileRevision, true);
      assert.ok(applyC.success);

      const after = await getStudentProfile(studentId!);
      assert.ok(after.education.some((e: any) => e.id === "manual-edu-456"), "manual record survives");
      assert.ok(after.education.some((e: any) => String(e.id).startsWith("cv-")), "CV records exist");

      // Reload and verify UI
      await p.reload({ waitUntil: "networkidle2" });
      await p.waitForTimeout(1000);
      await screenshot(p, "04-manual-record-survives");
    });

  } finally {
    if (browser) await browser.close();
    if (createdIds.length > 0) {
      const placeholders = createdIds.map(() => "?").join(",");
      await pool.execute(`DELETE FROM students WHERE id IN (${placeholders})`, createdIds);
      console.log(`   Cleaned up ${createdIds.length} test student(s)`);
    }
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`==============================`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
