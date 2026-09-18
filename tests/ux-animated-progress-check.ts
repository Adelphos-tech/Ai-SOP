/**
 * Animated progress UX check — verifies the GenerationProgressCard
 * renders real backend stage data + expected copy at all widths.
 * Driven by a fake RUNNING run row in the DB. No OpenAI calls.
 */
import puppeteer from "puppeteer";

const BASE = process.env.UX_BASE || "https://sop.adelphostech.com";
const DOC_URL = "/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7f4fbb07-fb2f-49e9-b028-dbc52d88eaa8/documents/1787e55b-3a0a-45c7-8cda-0a9e38c1db07";
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const failures: string[] = [];
  const page = await browser.newPage();
  const text = () => page.evaluate(() => document.body.innerText);

  for (const w of [1440, 1024, 938, 768, 390]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`${BASE}${DOC_URL}`, { waitUntil: "networkidle0", timeout: 30000 });
    await wait(4500);
    const t = await text();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    const check = (name: string, cond: boolean) => { if (!cond) failures.push(`@${w}: ${name}`); };
    check("Stage X of 6", /Stage \d+ of 6/.test(t));
    check("completed count", /\d+ complete/.test(t));
    check("elapsed MM:SS", /\d{2}:\d{2} elapsed/.test(t));
    check("current stage title", /Writing your draft|Preparing your document/.test(t));
    check("leave-page copy", /leave this page/i.test(t));
    check("cancel link", /Cancel generation/i.test(t));
    check("no raw stage names", !/qualityReviewer|languageCalibrator|factReviewer|PLANNER|WRITER/.test(t));
    check("no fake %", !/\d{2}%/.test(t));
    check("no overflow", overflow <= 2);
    if (w >= 640) {
      check("rail labels", /Prepare/.test(t) && /Verify/.test(t));
    }
    console.log(`  @${w}: checked`);
  }

  // Cancel confirm flow at desktop width
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}${DOC_URL}`, { waitUntil: "networkidle0", timeout: 30000 });
  await wait(4000);
  for (const b of await page.$$("button")) {
    const bt = await b.evaluate((el: any) => el.textContent || "");
    if (/Cancel generation/i.test(bt)) { await b.click(); break; }
  }
  await wait(600);
  const t2 = await text();
  if (!/Stop generating this document\?/i.test(t2)) failures.push("cancel confirm missing");
  if (!/may already have used some credits/i.test(t2)) failures.push("credit note missing");
  if (!/Keep generating/i.test(t2) || !/Stop generation/i.test(t2)) failures.push("confirm actions missing");
  console.log("  cancel-confirm: checked");

  await browser.close();
  if (failures.length) {
    failures.forEach(f => console.log(`  ✗ ${f}`));
    console.log(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nALL PASS");
  process.exit(0);
}

main();
