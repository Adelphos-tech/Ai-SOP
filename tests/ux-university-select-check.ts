/**
 * UniversitySelect verification — searchable university picker on
 * /students/new and /students/[studentId] new-application form.
 * Checks: General first, partial search "aal" → Aalen, case-insensitive,
 * unknown → "University not found", responsive widths. No OpenAI calls.
 */
import puppeteer from "puppeteer";

const BASE = process.env.UX_BASE || "https://sop.adelphostech.com";
const STUDENT_URL = "/students/45e4a41d-9940-4dc8-8b59-22683a0efb9c";
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const failures: string[] = [];
  const page = await browser.newPage();
  const getOptions = () => page.$$eval('[role="option"]', els => els.map(e => (e.textContent || "").trim()));
  const getValue = () => page.$eval('input[role="combobox"]', (el: any) => el.value);
  const clearInput = () => page.evaluate(() => {
    const el = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // ---------- /students/new ----------
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/students/new`, { waitUntil: "networkidle0", timeout: 30000 });
  await wait(1200);

  const uniInput = await page.$('input[role="combobox"]');
  if (!uniInput) {
    failures.push("/students/new: combobox input missing");
  } else {
    await uniInput.click();
    await wait(800);

    const options1 = await getOptions();
    if (options1[0] !== "General") failures.push(`first option "${options1[0]}", expected "General"`);
    if (!options1.includes("Aalen University")) failures.push("Aalen University missing from options");
    if (!options1.includes("MIT")) failures.push("MIT missing from options");

    await uniInput.type("aal");
    await wait(400);
    if (!(await getOptions()).includes("Aalen University")) failures.push('"aal" search missing Aalen');

    await uniInput.click();
    await clearInput();
    await uniInput.type("AAL");
    await wait(400);
    if (!(await getOptions()).includes("Aalen University")) failures.push('"AAL" (uppercase) missing Aalen');

    await page.keyboard.press("Enter");
    await wait(300);
    const val = await getValue();
    if (val !== "Aalen University") failures.push(`selected value "${val}", expected "Aalen University"`);

    await uniInput.click();
    await clearInput();
    await uniInput.type("Nonexistent Place");
    await wait(500);
    const notFound = await page.evaluate(() => document.body.innerText.includes("University not found"));
    if (!notFound) failures.push("'University not found' hint missing for unknown value");
    if ((await getValue()) !== "Nonexistent Place") failures.push("typed value not preserved");
  }

  // ---------- /students/[studentId] new-application form ----------
  await page.goto(`${BASE}${STUDENT_URL}`, { waitUntil: "networkidle0", timeout: 30000 });
  await wait(1200);
  let clicked = false;
  for (const b of await page.$$("button")) {
    const t = await b.evaluate((el: any) => el.textContent || "");
    if (/New Application/.test(t)) { await b.click(); clicked = true; break; }
  }
  if (!clicked) {
    failures.push("student page: '+ New Application' button not found");
  } else {
    await wait(700);
    const uniInput2 = await page.$('input[role="combobox"]');
    if (!uniInput2) {
      failures.push("student page: UniversitySelect missing in new-application form");
    } else {
      await uniInput2.click();
      await wait(600);
      const opts = await getOptions();
      if (opts[0] !== "General") failures.push(`student page: first option "${opts[0]}", expected "General"`);
    }
  }

  // ---------- responsive overflow on both pages ----------
  for (const w of [390, 768, 938, 1024, 1440]) {
    for (const url of ["/students/new", STUDENT_URL]) {
      await page.setViewport({ width: w, height: 900 });
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0", timeout: 30000 });
      await wait(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) failures.push(`${url} @${w}px: horizontal overflow ${overflow}px`);
    }
  }

  await browser.close();
  if (failures.length) {
    failures.forEach(f => console.log(`  ✗ ${f}`));
    console.log(`\n${failures.length} checks failed`);
    process.exit(1);
  }
  console.log("ALL PASS — selector: General first, aal→Aalen, case-insensitive, unknown fallback, both pages, all widths");
  process.exit(0);
}

main();
