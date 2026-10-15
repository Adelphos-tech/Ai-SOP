import { chromium, Browser } from "playwright";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const BASE_URL = "http://127.0.0.1:5010";
const FIXTURES = path.join(process.cwd(), "dvivid_complex_resume_stress_pack");
const OUT_DIR = path.join(process.cwd(), "browser-gate-screenshots");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

let browser: Browser;
let pass = 0, fail = 0;

const KABIR_ID = "df1589de-df62-4203-bae5-770c44657658";
const KABIR_APP = "8e56972d-f9e6-4c92-be5b-f424bb2c5395";
const DANIEL_ID = "aabbccdd-1122-3344-5566-778899aabbcc";
const DANIEL_APP = "90afe2e7-bca8-403e-96b2-e3e08bdb767b";
const ISHITA_ID = "c1d2e3f4-a5b6-7c8d-9e0f-123456789abc";
const ISHITA_APP = "f9e8d7c6-b5a4-3c2d-1e0f-abcdef123456";

async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

async function navigate(page: any, studentId: string, appId: string, section: string) {
  await page.goto(`${BASE_URL}/students/${studentId}/applications/${appId}/intake/${section}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return body.includes("Upload Resume") || body.includes("Section") || body.includes("Personal") || body.includes("Education") || body.includes("Academics");
  }, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function uploadFileViaFetch(page: any, filePath: string, studentId: string) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const fileName = path.basename(filePath);
  const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return await page.evaluate(async ({ studentId, base64, fileName, mimeType, baseUrl }: any) => {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("studentId", studentId);
    const res = await fetch(`${baseUrl}/api/application/cv-upload`, { method: "POST", body: formData });
    return res.json();
  }, { studentId, base64, fileName, mimeType, baseUrl: BASE_URL });
}

async function applyCVViaFetch(page: any, studentId: string, parsedCV: any, profileRevision: number, replaceCvDerived = false) {
  return await page.evaluate(async ({ studentId, parsedCV, profileRevision, replaceCvDerived, baseUrl }: any) => {
    const res = await fetch(`${baseUrl}/api/application/cv-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, parsedCV, overwrite: false, profileRevision, ...(replaceCvDerived ? { replaceCvDerived: true } : {}) }),
    });
    return { status: res.status, data: await res.json() };
  }, { studentId, parsedCV, profileRevision, replaceCvDerived, baseUrl: BASE_URL });
}

function getPool() {
  return mysql.createPool({ host: "127.0.0.1", port: 3306, user: "root", password: "", database: "sop_ai_app_test" });
}

async function resetProfile(studentId: string) {
  const pool = getPool();
  await pool.execute("UPDATE students SET profile_data = ? WHERE id = ?", [JSON.stringify({}), studentId]);
  await pool.end();
}

async function getProfileRevision(studentId: string) {
  const pool = getPool();
  const [rows] = await pool.execute("SELECT profile_data FROM students WHERE id = ?", [studentId]);
  const profile = (rows as any[])[0]?.profile_data || {};
  const parsed = typeof profile === 'string' ? JSON.parse(profile) : profile;
  const revision = parsed._revision || 0;
  await pool.end();
  return revision;
}

async function ensureStudent(id: string, firstName: string, lastName: string, email: string) {
  const pool = getPool();
  const [rows] = await pool.execute("SELECT id FROM students WHERE id = ?", [id]);
  if ((rows as any[]).length === 0) {
    await pool.execute(
      `INSERT INTO students (id, external_ref_id, first_name, last_name, email, phone, country, profile_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, null, firstName, lastName, email, null, null, JSON.stringify({})]
    );
  }
  await pool.end();
}

async function ensureApplication(id: string, studentId: string) {
  const pool = getPool();
  const [rows] = await pool.execute("SELECT id FROM applications WHERE id = ?", [id]);
  if ((rows as any[]).length === 0) {
    await pool.execute(
      `INSERT INTO applications (id, student_id, university_name, program_name, degree, department, country, intake, intake_year, application_context_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 'DRAFT')`,
      [id, studentId, "Test University", "Computer Science", "M.S.", null, "USA", "Fall", "2025"]
    );
  }
  await pool.end();
}

async function main() {
  browser = await chromium.launch({ headless: true });

  await check("S1: Desktop intake page renders", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s1-intake-desktop-empty.png"), fullPage: true });
    const text = await page.locator('body').innerText();
    if (!text.includes("Upload Resume")) throw new Error("CV upload section not found");
    await ctx.close();
  });

  await check("S2: PDF upload populates form fields", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "03_indian_education_substring_traps.pdf"), KABIR_ID);
    if (!data.parsed) throw new Error("Parse failed: " + JSON.stringify(data));
    const applyRes = await applyCVViaFetch(page, KABIR_ID, data.parsed, data.profileRevision ?? 0);
    if (applyRes.status !== 200) throw new Error(`Apply failed: ${applyRes.status} ${JSON.stringify(applyRes.data)}`);

    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s2-form-after-pdf-apply.png"), fullPage: true });
    const firstName = await page.locator('input[name="personalData.firstName"]').inputValue();
    if (!firstName.includes("Kabir")) throw new Error(`Kabir not in form after PDF apply: firstName=${firstName}`);
    await ctx.close();
  });

  await check("S3: DOCX upload populates form fields", async () => {
    await ensureStudent(ISHITA_ID, "Ishita", "Sen", "ishita.sen.qa@example.test");
    await ensureApplication(ISHITA_APP, ISHITA_ID);
    await resetProfile(ISHITA_ID);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, ISHITA_ID, ISHITA_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "05_academic_research_cv.docx"), ISHITA_ID);
    if (!data.parsed) throw new Error("Parse failed: " + JSON.stringify(data));
    const applyRes = await applyCVViaFetch(page, ISHITA_ID, data.parsed, data.profileRevision ?? 0);
    if (applyRes.status !== 200) throw new Error(`Apply failed: ${applyRes.status} ${JSON.stringify(applyRes.data)}`);

    await navigate(page, ISHITA_ID, ISHITA_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s3-form-after-docx-apply.png"), fullPage: true });
    const firstName = await page.locator('input[name="personalData.firstName"]').inputValue();
    if (!firstName.includes("Ishita")) throw new Error(`Ishita not in form after DOCX apply: firstName=${firstName}`);
    await ctx.close();
  });

  await check("S4: Education section populated after PDF apply", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "03_indian_education_substring_traps.pdf"), KABIR_ID);
    if (!data.parsed) throw new Error("Parse failed: " + JSON.stringify(data));
    const applyRes = await applyCVViaFetch(page, KABIR_ID, data.parsed, data.profileRevision ?? 0);
    if (applyRes.status !== 200) throw new Error(`Apply failed: ${applyRes.status} ${JSON.stringify(applyRes.data)}`);

    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s4-education-desktop.png"), fullPage: true });
    const text = await page.locator('body').innerText();
    if (!text.includes("B.Tech") && !text.includes("Bachelor")) throw new Error("Education not populated");
    await ctx.close();
  });

  await check("S5: Identity mismatch blocks apply", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, DANIEL_ID, DANIEL_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "03_indian_education_substring_traps.pdf"), DANIEL_ID);
    const applyRes = await applyCVViaFetch(page, DANIEL_ID, data.parsed, data.profileRevision ?? 0);
    if (applyRes.status !== 409) throw new Error(`Expected 409, got ${applyRes.status}: ${JSON.stringify(applyRes.data)}`);
    await ctx.close();
  });

  await check("S6: Truncated email flagged in parsed data", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "01_dense_two_column_product_analyst.pdf"), KABIR_ID);
    const email = data.parsed?.personalData?.email || "";
    if (!email.includes("aarav.mehta.qa@example")) throw new Error(`Email not as expected: ${email}`);
    await ctx.close();
  });

  await check("S7: Manual data preserved on replaceCvDerived", async () => {
    await resetProfile(KABIR_ID);
    const pool = getPool();
    const [rows] = await pool.execute("SELECT profile_data FROM students WHERE id = ?", [KABIR_ID]);
    const profile = (rows as any[])[0]?.profile_data || {};
    const parsed = typeof profile === 'string' ? JSON.parse(profile) : profile;
    parsed.education = [{ id: "manual-browser-123", level: "Master's", institution: "Harvard University", degree: "M.S.", specialization: "Computer Science", startYear: "2020", endYear: "2022", status: "Completed" }];
    await pool.execute("UPDATE students SET profile_data = ? WHERE id = ?", [JSON.stringify(parsed), KABIR_ID]);
    const revision = parsed._revision || 0;
    await pool.end();

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "03_indian_education_substring_traps.pdf"), KABIR_ID);
    const applyRes = await applyCVViaFetch(page, KABIR_ID, data.parsed, revision, true);
    if (applyRes.status !== 200) throw new Error(`Apply failed: ${applyRes.status} ${JSON.stringify(applyRes.data)}`);

    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s7-education-after-replace.png"), fullPage: true });
    const text = await page.locator('body').innerText();
    if (!text.includes("Harvard University")) throw new Error("Manual Harvard record lost");
    await ctx.close();
  });

  await check("S8: Mobile layout renders intake page", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s8-intake-mobile-empty.png"), fullPage: true });
    const text = await page.locator('body').innerText();
    if (!text.includes("Upload Resume")) throw new Error("CV upload not visible on mobile");
    await ctx.close();
  });

  await check("S9: Mobile layout shows populated data", async () => {
    await resetProfile(KABIR_ID);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" });
    const page = await ctx.newPage();
    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    const data = await uploadFileViaFetch(page, path.join(FIXTURES, "03_indian_education_substring_traps.pdf"), KABIR_ID);
    const applyRes = await applyCVViaFetch(page, KABIR_ID, data.parsed, data.profileRevision ?? 0);
    if (applyRes.status !== 200) throw new Error(`Apply failed: ${applyRes.status} ${JSON.stringify(applyRes.data)}`);

    await navigate(page, KABIR_ID, KABIR_APP, "student-details");
    await page.screenshot({ path: path.join(OUT_DIR, "s9-intake-mobile-with-data.png"), fullPage: true });
    const firstName = await page.locator('input[name="personalData.firstName"]').inputValue();
    if (!firstName.includes("Kabir")) throw new Error(`Kabir not visible on mobile: firstName=${firstName}`);
    await ctx.close();
  });

  await browser.close();

  console.log(`\n========== BROWSER GATE SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`Screenshots: ${OUT_DIR}`);
  console.log(`==========================================`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exit(1);
});
