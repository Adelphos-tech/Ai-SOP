/**
 * Live progress-panel check — verifies the generation progress UI
 * renders server-driven stage data at 5 widths. Read-only; a fake
 * RUNNING run row was seeded directly in the DB. No OpenAI calls.
 */
import puppeteer from "puppeteer";

const BASE = process.env.UX_BASE || "https://sop.adelphostech.com";
const WIDTHS = [1440, 1024, 938, 768, 390];
const DOC_URL = "/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7f4fbb07-fb2f-49e9-b028-dbc52d88eaa8/documents/1787e55b-3a0a-45c7-8cda-0a9e38c1db07";

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  let failures = 0;

  for (const width of WIDTHS) {
    const tab = await browser.newPage();
    try {
      await tab.setViewport({ width, height: 900 });
      await tab.goto(`${BASE}${DOC_URL}`, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise(r => setTimeout(r, 4500)); // allow 2 poll ticks

      const result = await tab.evaluate(() => {
        const text = document.body.innerText;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          hasStageCount: /Stage \d+ of 6/.test(text),
          hasCompletedCount: /\d+ stages? complete/.test(text),
          hasElapsed: /Elapsed:/.test(text),
          hasCancelBtn: /Cancel Generation|Cancel \/ Reset Generation|Stopping/.test(text),
          hasPreparing: /Preparing document/.test(text),
          hasVerifying: /Verifying facts/.test(text),
          hasRawStage: /qualityReviewer|languageCalibrator|factReviewer/.test(text),
          hasGeneratingBadge: /Generating/.test(text),
          hasOldInterruptText: /may still be running, or it may have been interrupted/.test(text),
        };
      });

      const issues: string[] = [];
      if (!result.hasStageCount) issues.push("missing 'Stage X of 6'");
      if (!result.hasCompletedCount) issues.push("missing completed count");
      if (!result.hasElapsed) issues.push("missing elapsed");
      if (!result.hasCancelBtn) issues.push("missing Cancel button");
      if (!result.hasPreparing || !result.hasVerifying) issues.push("stage labels missing");
      if (result.hasRawStage) issues.push("RAW STAGE NAME leaked to UI");
      if (result.hasOldInterruptText) issues.push("old ambiguous interrupt text still shown");
      if (result.overflow > 2) issues.push(`horizontal overflow ${result.overflow}px`);

      if (issues.length) {
        failures++;
        console.log(`  ✗ @${width}px: ${issues.join("; ")}`);
      } else {
        console.log(`  ✓ @${width}px — stage data + cancel + elapsed, no raw names`);
      }
    } catch (e: any) {
      failures++;
      console.log(`  ✗ @${width}px: ${e?.message?.slice(0, 120)}`);
    }
    await tab.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
