/**
 * cv-browser-verification.ts — Browser verification of CV import flow.
 *
 * Reuses Puppeteer (already installed) to verify UI state matches
 * persisted DB state after CV upload and apply operations.
 *
 * Run: npx tsx tests/cv-browser-verification.ts
 * Requires: production server on port 5011, test database, writable SOP_CV_STORAGE
 */
import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { getDbPool } from "../src/lib/application/db";
import {
  createStudent,
  getStudentProfile,
  getStudentProfileRevision,
} from "../src/lib/application/application-repository";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const BASE_URL = "http://127.0.0.1:5011";
const SCREENSHOT_DIR = "/tmp/cv-browser-verification";

// Respect CI-provided database credentials; only fall back to local defaults
process.env.SOP_DB_HOST = process.env.SOP_DB_HOST || "127.0.0.1";
process.env.SOP_DB_PORT = process.env.SOP_DB_PORT || "3306";
process.env.SOP_DB_USER = process.env.SOP_DB_USER || "root";
process.env.SOP_DB_PASSWORD = process.env.SOP_DB_PASSWORD || "";
process.env.SOP_DB_NAME = process.env.SOP_DB_NAME || "sop_ai_app_test";

const DB_NAME = process.env.SOP_DB_NAME;
if (!DB_NAME || !DB_NAME.toLowerCase().includes("test")) {
  console.error(`FATAL: Refusing to run against non-test database: "${DB_NAME}"`);
  process.exit(1);
}

let pass = 0, fail = 0;
const createdIds: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

async function generateSyntheticDocx(opts?: { firstName?: string; lastName?: string; email?: string; institution?: string; organization?: string }): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const firstName = opts?.firstName ?? "Avery";
  const lastName = opts?.lastName ?? "Testington";
  const email = opts?.email ?? "avery.testington@example-test.local";
  const institution = opts?.institution ?? "State University";
  const organization = opts?.organization ?? "TechCorp";
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `${firstName} ${lastName}`, heading: HeadingLevel.HEADING_1 }),
        new Paragraph(email),
        new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
        new Paragraph(`${institution} — Bachelor of Technology in Computer Science — 2019-2023 — CGPA 8.5`),
        new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
        new Paragraph(`${organization} — Software Engineer Intern — June 2023 to August 2023`),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function uploadCVViaAPI(studentId: string, buf: Buffer): Promise<any> {
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

async function applyCVViaAPI(studentId: string, parsedCV: any, profileRevision: number, replaceCvDerived = false, identityConflictOverride = false): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/application/cv-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, parsedCV, overwrite: false, profileRevision, replaceCvDerived, identityConflictOverride }),
  });
  if (!res.ok) throw new Error(`cv-apply failed: ${res.status}`);
  return res.json();
}

async function screenshot(page: puppeteer.Page, name: string) {
  const file = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`   Screenshot: ${file}`);
}

/** Check if any input value or visible text on the page contains the given text */
async function pageContains(page: puppeteer.Page, text: string): Promise<boolean> {
  return page.evaluate((t) => {
    // Check visible text
    if (document.body.innerText.includes(t)) return true;
    // Check input values
    const inputs = document.querySelectorAll('input, textarea');
    for (const input of inputs) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if ((el.value || "").includes(t)) return true;
    }
    return false;
  }, text);
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const pool = getDbPool();
  let browser: puppeteer.Browser | undefined;
  let page: puppeteer.Page | undefined;
  let tempCvPath: string | undefined;

  try {
    // Create test student and application
    let studentId: string;
    let applicationId: string;
    let studentEmail: string;
    await check("Setup: create test student", async () => {
      studentEmail = `avery-${Date.now()}@example-test.local`;
      const s = await createStudent({
        firstName: "Avery", lastName: "Testington",
        email: studentEmail, profileData: {},
      });
      studentId = s.id;
      createdIds.push(studentId);

      const res = await fetch(`${BASE_URL}/api/application/create`, {
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

    // Write synthetic DOCX to temp file for UI upload (use student's actual email to avoid identity conflict)
    const fixtureBuf = await generateSyntheticDocx({ email: studentEmail! });
    tempCvPath = `/tmp/cv-browser-verification-cva.docx`;
    await writeFile(tempCvPath, fixtureBuf);

    // Start browser
    await check("Setup: launch browser", async () => {
      browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
      page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
    });

    const p = page!;

    /* ============================================================
     * Step 1: Navigate to Student Details intake page before CV upload
     * ============================================================ */
    await check("Browser: Student Details page loads with CV upload area", async () => {
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}/intake/student-details`, { waitUntil: "networkidle2" });
      await screenshot(p, "01-before-cv-upload");
      const hasUpload = await pageContains(p, "Upload a CV") || await pageContains(p, "Upload CV");
      assert.ok(hasUpload, "page should contain CV upload area");
    });

    /* ============================================================
     * Step 2: Upload CV A via UI (file input), apply, verify
     * ============================================================ */
    await check("UI: upload CV A via file input and apply", async () => {
      // Trigger file selection on the hidden input
      const input = await p.$('input[type="file"]');
      assert.ok(input, "file input should exist");
      await input!.uploadFile(tempCvPath!);

      // Wait for parsing/upload to complete (review screen with Apply button)
      await p.waitForFunction(() => {
        const body = document.body.innerText;
        return body.includes("CV imported:") || body.includes("Apply to Profile");
      }, { timeout: 30000 });

      await screenshot(p, "02-cv-a-uploaded");

      // Click "Apply to Profile" button
      let clicked = false;
      const buttons = await p.$$('button');
      for (const btn of buttons) {
        const text = await p.evaluate(el => el.textContent, btn);
        if (text?.includes("Apply to Profile")) { await btn.click(); clicked = true; break; }
      }
      assert.ok(clicked, "Apply to Profile button not found");

      // Wait for apply to complete (component resets to upload area)
      await new Promise(r => setTimeout(r, 3000));
      await screenshot(p, "03-cv-a-applied");
      console.log("   CV A applied via UI");
    });

    /* ============================================================
     * Step 3: Reload page and verify CV A education visible on Student Details
     * ============================================================ */
    await check("Browser: reload shows CV A education on Student Details", async () => {
      await p.reload({ waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1500));
      await screenshot(p, "04-after-reload-cv-a");
      const hasEdu = await pageContains(p, "State University") || await pageContains(p, "Bachelor");
      assert.ok(hasEdu, "UI should show education from CV A");
    });

    /* ============================================================
     * Step 4: Navigate to Work Experience and verify CV A experience
     * ============================================================ */
    await check("Browser: Work Experience page shows CV A experience", async () => {
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}/intake/work-experience`, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1500));
      await screenshot(p, "04b-work-experience-cv-a");
      const hasExp = await pageContains(p, "TechCorp") || await pageContains(p, "Engineer");
      assert.ok(hasExp, "UI should show experience from CV A");
    });

    /* ============================================================
     * Step 5: Verify DB matches expected counts
     * ============================================================ */
    await check("Browser: DB education/experience count matches", async () => {
      const profile = await getStudentProfile(studentId!);
      assert.ok(profile.education?.length >= 1, "DB must have education");
      assert.ok(profile.experience?.length >= 1, "DB must have experience");
      // Verify CV A experience fields (organization or role may contain company)
      const hasCvAExp = profile.experience.some((e: any) =>
        (e.organization?.includes("TechCorp")) || (e.role?.includes("TechCorp")) ||
        (e.organization?.includes("Engineer")) || (e.role?.includes("Engineer"))
      );
      assert.ok(hasCvAExp, "CV A experience present in DB");
      console.log(`   DB education: ${profile.education.length}, experience: ${profile.experience.length}`);
    });

    /* ============================================================
     * Step 6: Upload CV B (different data) via UI, replace, verify
     * ============================================================ */
    await check("UI: upload CV B with different data and replace", async () => {
      const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
      const docB = new Document({
        sections: [{
          children: [
            new Paragraph({ text: "Avery Testington", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(studentEmail!),
            new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("Graduate Institute — Master of Science in AI — 2024-2026"),
            new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("MegaCorp — Data Scientist — January 2024 to present"),
          ],
        }],
      });
      const bufB = await Packer.toBuffer(docB);
      const tempPathB = `/tmp/cv-browser-verification-cvb.docx`;
      await writeFile(tempPathB, bufB);

      // Navigate back to Student Details for upload
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}/intake/student-details`, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1000));

      // Upload new file
      const input = await p.$('input[type="file"]');
      assert.ok(input, "file input should exist");
      await input!.uploadFile(tempPathB);

      // Wait for review screen
      await p.waitForFunction(() => {
        const body = document.body.innerText;
        return body.includes("CV imported:") || body.includes("Apply to Profile");
      }, { timeout: 30000 });

      await screenshot(p, "05-cv-b-uploaded");

      // Check "Replace previous CV-imported data" checkbox if present
      const replaceCheckbox = await p.$('input[type="checkbox"]');
      if (replaceCheckbox) {
        await replaceCheckbox.click();
      }

      // Click Apply
      const buttons = await p.$$('button');
      for (const btn of buttons) {
        const text = await p.evaluate(el => el.textContent, btn);
        if (text?.includes("Apply to Profile")) { await btn.click(); break; }
      }

      await new Promise(r => setTimeout(r, 3000));
      await screenshot(p, "06-cv-b-applied");
      await rm(tempPathB).catch(() => {});
    });

    await check("Browser: CV B replaces CV A education after reload", async () => {
      await p.reload({ waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1500));
      await screenshot(p, "07-after-cv-b-reload");
      const hasB = await pageContains(p, "Graduate Institute") || await pageContains(p, "Master of Science");
      assert.ok(hasB, "UI should show CV B education");
      const hasOld = await pageContains(p, "State University");
      assert.ok(!hasOld, "UI should no longer show CV A education");

      // Verify DB
      const profile = await getStudentProfile(studentId!);
      assert.ok(profile.education.some((e: any) => e.institution?.includes("Graduate")), "CV B education present");
      const hasCvBExp = profile.experience.some((e: any) =>
        (e.organization?.includes("MegaCorp")) || (e.role?.includes("MegaCorp")) ||
        (e.organization?.includes("Data Scientist")) || (e.role?.includes("Data Scientist"))
      );
      assert.ok(hasCvBExp, "CV B experience present");
      const hasOldExp = profile.experience.some((e: any) =>
        (e.organization?.includes("TechCorp")) || (e.role?.includes("TechCorp"))
      );
      assert.ok(!hasOldExp, "CV A experience removed");
    });

    await check("Browser: Work Experience shows CV B data", async () => {
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}/intake/work-experience`, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1500));
      await screenshot(p, "07b-work-experience-cv-b");
      const hasB = await pageContains(p, "MegaCorp") || await pageContains(p, "Data Scientist");
      assert.ok(hasB, "UI should show CV B experience");
      const hasOld = await pageContains(p, "TechCorp");
      assert.ok(!hasOld, "UI should no longer show CV A experience");
    });

    /* ============================================================
     * Step 6: Wrong-person CV blocked (API-assisted)
     * ============================================================ */
    await check("API-assisted: wrong-person CV returns 409 without DB mutation", async () => {
      const wrongStudent = await createStudent({
        firstName: "Wrong", lastName: "Person",
        email: `wrong-${Date.now()}@example-test.local`, profileData: {},
      });
      createdIds.push(wrongStudent.id);

      const uploadWrong = await uploadCVViaAPI(wrongStudent.id, fixtureBuf);
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
     * Step 7: Manual record survives replacement (API-assisted setup, UI verify)
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

      // Re-apply CV C with replaceCvDerived via API (proven setup)
      const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
      const docC = new Document({
        sections: [{
          children: [
            new Paragraph({ text: "Avery Testington", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(studentEmail!),
            new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
            new Paragraph("Updated University — BTech — 2020-2024"),
          ],
        }],
      });
      const bufC = await Packer.toBuffer(docC);
      const uploadC = await uploadCVViaAPI(studentId!, bufC);
      const applyC = await applyCVViaAPI(studentId!, uploadC.parsed, uploadC.profileRevision, true);
      assert.ok(applyC.success);

      const after = await getStudentProfile(studentId!);
      assert.ok(after.education.some((e: any) => e.id === "manual-edu-456"), "manual record survives");
      assert.ok(after.education.some((e: any) => String(e.id).startsWith("cv-")), "CV records exist");

      // Reload UI and verify
      await p.goto(`${BASE_URL}/students/${studentId}/applications/${applicationId}/intake/student-details`, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 1500));
      await screenshot(p, "08-manual-record-survives");

      // Check UI shows both manual and CV records
      const hasManual = await pageContains(p, "Manual Academy") || await pageContains(p, "Certificate");
      assert.ok(hasManual, "UI should show manual record");
      const hasCv = await pageContains(p, "Updated University");
      assert.ok(hasCv, "UI should show new CV education");
    });

  } finally {
    if (browser) await browser.close();
    if (createdIds.length > 0) {
      const placeholders = createdIds.map(() => "?").join(",");
      await pool.execute(`DELETE FROM students WHERE id IN (${placeholders})`, createdIds);
      console.log(`   Cleaned up ${createdIds.length} test student(s)`);
    }
    if (tempCvPath) await rm(tempCvPath).catch(() => {});
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
