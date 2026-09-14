import { promises as fs } from "fs";
import path from "path";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { generateComponentHtml, generateCombinedHtml } from "../src/lib/render/html-generator";
import { validatePhysicalPageConstraints } from "../src/lib/render/page-validator";

async function renderHtmlToPdf(html: string) {
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
    return { pdfBuffer: Buffer.from(pdfBytes), pageCount: doc.getPageCount() };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== RENDERING MIT FROZEN OUTPUT ===");
  const profile = DVIVID_STANDARD_APPLICATION_V1;
  console.log(`Profile: ${profile.renderProfileId} v${profile.version}`);
  console.log(`Source: ${profile.source}`);
  console.log(`Page: ${profile.pageSize}, Margins: 1in, Font: Times New Roman 12pt, Line: ${profile.lineSpacing}`);
  console.log("");

  const baseDir = path.join(__dirname, "..", "logs", "live-generations", "mit-cee-meng-fall-2027-001");
  const renderDir = path.join(baseDir, "render");
  await fs.mkdir(renderDir, { recursive: true });

  // Parse frozen text
  const fullText = await fs.readFile(path.join(baseDir, "final-statement-of-objectives.txt"), "utf-8");
  const aMatch = fullText.match(/A\. EXPERIENCE\n\n([\s\S]*?)\n\nB\. PURPOSE/);
  const bMatch = fullText.match(/B\. PURPOSE\n\n([\s\S]*)/);
  const compA = aMatch ? aMatch[1].trim() : "";
  const compB = bMatch ? bMatch[1].trim() : "";

  const wordsA = compA.split(/\s+/).filter(Boolean).length;
  const wordsB = compB.split(/\s+/).filter(Boolean).length;
  console.log(`Component A: ${wordsA} words`);
  console.log(`Component B: ${wordsB} words`);
  console.log("");

  // Render each independently
  console.log("Rendering Component A...");
  const htmlA = generateComponentHtml("Experience", compA, profile);
  const resA = await renderHtmlToPdf(htmlA);
  console.log(`  Pages: ${resA.pageCount}`);

  console.log("Rendering Component B...");
  const htmlB = generateComponentHtml("Purpose", compB, profile);
  const resB = await renderHtmlToPdf(htmlB);
  console.log(`  Pages: ${resB.pageCount}`);

  console.log("Rendering combined document...");
  const htmlCombined = generateCombinedHtml("STATEMENT OF OBJECTIVES", [
    { componentId: "RC-MIT-CEE-A", label: "Experience", text: compA },
    { componentId: "RC-MIT-CEE-B", label: "Purpose", text: compB },
  ], profile);
  const resCombined = await renderHtmlToPdf(htmlCombined);
  console.log(`  Pages: ${resCombined.pageCount}`);

  // Save PDFs
  await fs.writeFile(path.join(renderDir, "component-a.pdf"), resA.pdfBuffer);
  await fs.writeFile(path.join(renderDir, "component-b.pdf"), resB.pdfBuffer);
  await fs.writeFile(path.join(renderDir, "combined-statement-of-objectives.pdf"), resCombined.pdfBuffer);

  // Validate
  const validation = validatePhysicalPageConstraints(
    [
      { componentId: "RC-MIT-CEE-A", label: "Experience", text: compA, maxPages: 1, renderedPageCount: resA.pageCount },
      { componentId: "RC-MIT-CEE-B", label: "Purpose", text: compB, maxPages: 1, renderedPageCount: resB.pageCount },
    ],
    resCombined.pageCount, 2, profile
  );

  console.log("\n=== VALIDATION ===");
  validation.components.forEach(c => console.log(`  ${c.label}: ${c.pageCount}/${c.maxPages} — ${c.status}`));
  console.log(`  Combined: ${validation.combinedPageCount}/${validation.combinedMaxPages} — ${validation.status}`);

  // Save validation artifacts
  await fs.writeFile(path.join(renderDir, "component-page-validation.json"), JSON.stringify(validation, null, 2));
  await fs.writeFile(path.join(renderDir, "render-profile.json"), JSON.stringify(profile, null, 2));
  await fs.writeFile(path.join(renderDir, "combined-page-validation.json"), JSON.stringify({
    combinedPageCount: resCombined.pageCount, combinedMaxPages: 2,
    status: validation.status, renderProfile: validation.renderProfile,
  }, null, 2));
  await fs.writeFile(path.join(renderDir, "render-validation.json"), JSON.stringify({
    ...validation,
    factSafetyStatus: "REVIEW_REQUIRED",
    submissionStatus: "REVIEW_REQUIRED",
    message: "Physical page validation complete. Final submission status remains REVIEW_REQUIRED due to 1 corrected INVENTED_FACT from the factual audit. Render success does NOT override factual failure.",
  }, null, 2));

  console.log("\nArtifacts saved to render/");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
