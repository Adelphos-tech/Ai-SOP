/**
 * Progress-card state verification — reads the rendered panel for
 * whatever lifecycle state is currently seeded in the DB.
 * Usage: npx tsx tests/ux-progress-states-check.ts <expect-regex> [staleWait]
 */
import puppeteer from "puppeteer";

const BASE = process.env.UX_BASE || "https://sop.adelphostech.com";
const DOC_URL = "/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7f4fbb07-fb2f-49e9-b028-dbc52d88eaa8/documents/1787e55b-3a0a-45c7-8cda-0a9e38c1db07";

async function main() {
  const expect = new RegExp(process.argv[2] || ".", "i");
  const staleWait = process.argv[3] === "stale";
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}${DOC_URL}`, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise(r => setTimeout(r, staleWait ? 16000 : 4500));
  const t = await page.evaluate(() => document.body.innerText);
  await browser.close();
  if (expect.test(t)) {
    console.log(`PASS — matched ${expect}`);
    process.exit(0);
  }
  console.log(`FAIL — ${expect} not found`);
  console.log(t.split("\n").filter(l => /Generat|Stage|Checking|Stopp|interrupt|elapsed|draft|error/i.test(l)).slice(0, 12).join("\n"));
  process.exit(1);
}

main();
