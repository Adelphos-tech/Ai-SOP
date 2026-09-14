import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { generateComponentHtml, generateCombinedHtml } from "../src/lib/render/html-generator";

async function renderHtmlToPdf(html: string): Promise<{ pdfBuffer: Buffer; pageCount: number; hash: string }> {
  const puppeteer = await import("puppeteer");
  const pdfLib = await import("pdf-lib");
  const profile = DVIVID_STANDARD_APPLICATION_V1;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBytes = await page.pdf({
      format: profile.pageSize === "LETTER" ? "Letter" : "A4",
      printBackground: false,
    });
    const doc = await pdfLib.PDFDocument.load(pdfBytes);
    const hash = crypto.createHash("sha256").update(pdfBytes).digest("hex");
    return { pdfBuffer: Buffer.from(pdfBytes), pageCount: doc.getPageCount(), hash };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== REPRODUCIBILITY TEST (3 RENDERS) ===\n");
  const profile = DVIVID_STANDARD_APPLICATION_V1;
  const baseDir = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-001");
  const fullText = await fs.readFile(path.join(baseDir, "final-statement-of-objectives.txt"), "utf-8");
  const aMatch = fullText.match(/A\. EXPERIENCE\n\n([\s\S]*?)\n\nB\. PURPOSE/);
  const bMatch = fullText.match(/B\. PURPOSE\n\n([\s\S]*)/);
  const compA = aMatch ? aMatch[1].trim() : "";
  const compB = bMatch ? bMatch[1].trim() : "";

  const results: Array<{ run: number; pagesA: number; pagesB: number; pagesCombined: number; hashA: string; hashB: string; hashCombined: string }> = [];

  for (let i = 1; i <= 3; i++) {
    console.log(`--- Run ${i} ---`);
    const htmlA = generateComponentHtml("Experience", compA, profile);
    const resA = await renderHtmlToPdf(htmlA);
    const htmlB = generateComponentHtml("Purpose", compB, profile);
    const resB = await renderHtmlToPdf(htmlB);
    const htmlCombined = generateCombinedHtml("STATEMENT OF OBJECTIVES", [
      { componentId: "RC-MIT-CEE-A", label: "Experience", text: compA },
      { componentId: "RC-MIT-CEE-B", label: "Purpose", text: compB },
    ], profile);
    const resCombined = await renderHtmlToPdf(htmlCombined);
    console.log(`  A: ${resA.pageCount}p (hash: ${resA.hash.substring(0, 16)}...)`);
    console.log(`  B: ${resB.pageCount}p (hash: ${resB.hash.substring(0, 16)}...)`);
    console.log(`  Combined: ${resCombined.pageCount}p (hash: ${resCombined.hash.substring(0, 16)}...)`);
    results.push({
      run: i, pagesA: resA.pageCount, pagesB: resB.pageCount, pagesCombined: resCombined.pageCount,
      hashA: resA.hash, hashB: resB.hash, hashCombined: resCombined.hash,
    });
  }

  const stablePages = results.every(r =>
    r.pagesA === results[0].pagesA &&
    r.pagesB === results[0].pagesB &&
    r.pagesCombined === results[0].pagesCombined
  );
  const stableHashes = results.every(r =>
    r.hashA === results[0].hashA &&
    r.hashB === results[0].hashB &&
    r.hashCombined === results[0].hashCombined
  );

  console.log("\n=== REPRODUCIBILITY RESULTS ===");
  console.log(`Repeat count: 3`);
  console.log(`Stable page count: ${stablePages ? "PASS" : "FAIL"}`);
  console.log(`Stable PDF hashes: ${stableHashes ? "PASS" : "FAIL"}`);
  console.log(`Page counts: A=${results[0].pagesA}, B=${results[0].pagesB}, Combined=${results[0].pagesCombined}`);

  const report = {
    repeatCount: 3,
    stablePageCount: stablePages ? "PASS" : "FAIL",
    stablePdfHashes: stableHashes ? "PASS" : "FAIL",
    pageCounts: { componentA: results[0].pagesA, componentB: results[0].pagesB, combined: results[0].pagesCombined },
    runs: results.map(r => ({
      run: r.run,
      pagesA: r.pagesA, pagesB: r.pagesB, pagesCombined: r.pagesCombined,
      hashA: r.hashA, hashB: r.hashB, hashCombined: r.hashCombined,
    })),
  };
  const renderDir = path.join(baseDir, "render");
  await fs.writeFile(path.join(renderDir, "reproducibility.json"), JSON.stringify(report, null, 2));
  console.log("\nSaved to render/reproducibility.json");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
