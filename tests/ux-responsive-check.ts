/**
 * UX responsive check — canonical consultant pages at 5 widths.
 * Checks horizontal overflow + presence of a primary CTA.
 * Read-only. No OpenAI calls.
 */
import puppeteer from "puppeteer";

const BASE = process.env.UX_BASE || "https://sop.adelphostech.com";
const WIDTHS = [1440, 1024, 938, 768, 390];

const PAGES: Array<{ name: string; path: string; primaryText?: RegExp }> = [
  { name: "students", path: "/students", primaryText: /New Applicant/i },
  { name: "new-applicant", path: "/students/new", primaryText: /Create Applicant/i },
  {
    name: "student-workspace",
    path: "/students/45e4a41d-9940-4dc8-8b59-22683a0efb9c",
    primaryText: /New Application/i,
  },
  {
    name: "app-workspace",
    path: "/students/45e4a41d-9940-4dc8-8b59-22683a0efb9c/applications/140fe367-52a7-45df-9033-65065891b168",
  },
  {
    name: "missing-info-wizard",
    path: "/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7f4fbb07-fb2f-49e9-b028-dbc52d88eaa8/intake/missing",
  },
  {
    name: "doc-not-started",
    path: "/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7f4fbb07-fb2f-49e9-b028-dbc52d88eaa8/documents/1787e55b-3a0a-45c7-8cda-0a9e38c1db07",
    primaryText: /Generate/i,
  },
  {
    name: "doc-generated",
    path: "/students/45e4a41d-9940-4dc8-8b59-22683a0efb9c/applications/140fe367-52a7-45df-9033-65065891b168/documents/f34415b0-c22e-4a2d-b801-16bf184c60f9",
  },
];

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  let failures = 0;

  for (const page of PAGES) {
    for (const width of WIDTHS) {
      const tab = await browser.newPage();
      try {
        await tab.setViewport({ width, height: 900 });
        await tab.goto(`${BASE}${page.path}`, { waitUntil: "networkidle0", timeout: 30000 });
        await new Promise(r => setTimeout(r, 800));

        const result = await tab.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          const bodyText = document.body.innerText.slice(0, 400);
          // Primary CTA = visible filled button or prominent link
          const buttons = Array.from(document.querySelectorAll("button, a")).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const texts = buttons.map(b => (b.textContent || "").trim()).filter(Boolean);
          return { overflow, bodyText: bodyText.replace(/\s+/g, " "), texts: texts.slice(0, 30) };
        });

        const issues: string[] = [];
        if (result.overflow > 2) issues.push(`horizontal overflow ${result.overflow}px`);
        if (page.primaryText && !result.texts.some(t => page.primaryText!.test(t)) && !page.primaryText.test(result.bodyText)) {
          issues.push(`primary CTA not found (${page.primaryText})`);
        }

        if (issues.length) {
          failures++;
          console.log(`  ✗ ${page.name} @${width}px: ${issues.join("; ")}`);
        } else {
          console.log(`  ✓ ${page.name} @${width}px`);
        }
      } catch (e: any) {
        failures++;
        console.log(`  ✗ ${page.name} @${width}px: ${e?.message?.slice(0, 100)}`);
      }
      await tab.close();
    }
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} checks failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
