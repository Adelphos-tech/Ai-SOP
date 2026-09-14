const fs = require("fs");
const path = require("path");
const { DVIVID_STANDARD_APPLICATION_V1 } = require("./src/lib/render/render-profile");
const { generateComponentHtml, generateCombinedHtml } = require("./src/lib/render/html-generator");
const { validatePhysicalPageConstraints } = require("./src/lib/render/page-validator");

const compA = fs.readFileSync("/tmp/mit-comp-a.txt", "utf-8");
const compB = fs.readFileSync("/tmp/mit-comp-b.txt", "utf-8");
const profile = DVIVID_STANDARD_APPLICATION_V1;

async function renderHtmlToPdf(html) {
  const puppeteer = require("puppeteer");
  const { PDFDocument } = require("pdf-lib");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfUint8 = await page.pdf({
      format: profile.pageSize === "LETTER" ? "Letter" : "A4",
      printBackground: false,
      margin: {
        top: `${profile.margins.topIn}in`,
        right: `${profile.margins.rightIn}in`,
        bottom: `${profile.margins.bottomIn}in`,
        left: `${profile.margins.leftIn}in`,
      },
    });
    const doc = await PDFDocument.load(pdfUint8);
    return { pdfBuffer: Buffer.from(pdfUint8), pageCount: doc.getPageCount() };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== RENDERING MIT FROZEN OUTPUT ===");
  console.log(`Profile: ${profile.renderProfileId} v${profile.version}`);
  console.log(`Source: ${profile.source}`);
  console.log(`Page size: ${profile.pageSize}`);
  console.log(`Margins: top=${profile.margins.topIn}in bottom=${profile.margins.bottomIn}in left=${profile.margins.leftIn}in right=${profile.margins.rightIn}in`);
  console.log(`Font: ${profile.fontFamily} ${profile.fontSizePt}pt`);
  console.log(`Line spacing: ${profile.lineSpacing}`);
  console.log("");

  const htmlA = generateComponentHtml("Experience", compA, profile);
  const resultA = await renderHtmlToPdf(htmlA);
  console.log(`Component A: ${resultA.pageCount} page(s)`);

  const htmlB = generateComponentHtml("Purpose", compB, profile);
  const resultB = await renderHtmlToPdf(htmlB);
  console.log(`Component B: ${resultB.pageCount} page(s)`);

  const combinedHtml = generateCombinedHtml("STATEMENT OF OBJECTIVES", [
    { componentId: "RC-MIT-CEE-A", label: "Experience", text: compA },
    { componentId: "RC-MIT-CEE-B", label: "Purpose", text: compB },
  ], profile);
  const resultCombined = await renderHtmlToPdf(combinedHtml);
  console.log(`Combined: ${resultCombined.pageCount} page(s)`);

  const renderDir = "logs/live-generations/mit-cee-meng-fall-2027-001/render";
  fs.mkdirSync(renderDir, { recursive: true });
  fs.writeFileSync(path.join(renderDir, "component-a.pdf"), resultA.pdfBuffer);
  fs.writeFileSync(path.join(renderDir, "component-b.pdf"), resultB.pdfBuffer);
  fs.writeFileSync(path.join(renderDir, "combined-statement-of-objectives.pdf"), resultCombined.pdfBuffer);

  const validation = validatePhysicalPageConstraints(
    [
      { componentId: "RC-MIT-CEE-A", label: "Experience", text: compA, maxPages: 1, renderedPageCount: resultA.pageCount },
      { componentId: "RC-MIT-CEE-B", label: "Purpose", text: compB, maxPages: 1, renderedPageCount: resultB.pageCount },
    ],
    resultCombined.pageCount, 2, profile
  );

  console.log("");
  console.log("=== VALIDATION ===");
  validation.components.forEach(c => console.log(`${c.label}: ${c.pageCount}/${c.maxPages} pages — ${c.status}`));
  console.log(`Combined: ${validation.combinedPageCount}/${validation.combinedMaxPages} — ${validation.status}`);

  fs.writeFileSync(path.join(renderDir, "component-page-validation.json"), JSON.stringify(validation, null, 2));
  fs.writeFileSync(path.join(renderDir, "render-profile.json"), JSON.stringify(profile, null, 2));
  fs.writeFileSync(path.join(renderDir, "combined-page-validation.json"), JSON.stringify({
    combinedPageCount: resultCombined.pageCount, combinedMaxPages: 2,
    status: validation.status, renderProfile: validation.renderProfile,
  }, null, 2));
  fs.writeFileSync(path.join(renderDir, "render-validation.json"), JSON.stringify({
    ...validation,
    factSafetyStatus: "REVIEW_REQUIRED",
    submissionStatus: "REVIEW_REQUIRED",
    message: "Physical page validation complete. Final submission status remains REVIEW_REQUIRED due to 1 corrected INVENTED_FACT.",
  }, null, 2));

  console.log("Saved to", renderDir);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
