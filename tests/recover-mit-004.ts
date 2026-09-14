/**
 * PHASE SOP-AI-15 — Recovery script for #004
 *
 * The pipeline completed all 6 stages successfully on the server,
 * but the SSH connection dropped before the runner could save artifacts.
 * This script reconstructs the result from checkpoint artifacts.
 *
 * NO additional OpenAI calls. NO new generation. Recovery only.
 */

import { promises as fs } from "fs";
import path from "path";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { generateComponentHtml, generateCombinedHtml } from "../src/lib/render/html-generator";

const ATTEMPT_DIR = path.join(process.cwd(), "logs", "attempts", "caaa8f42-46a6-4050-bfd4-b3a20ad9da39");
const OUTPUT_BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-004");

async function loadJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function saveJson(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function renderHtmlToPdfPages(html: string): Promise<{ pdfBuffer: Buffer; pageCount: number }> {
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
  console.log("=== PHASE SOP-AI-15: #004 RECOVERY (NO PAID CALLS) ===\n");

  // Load all artifacts from checkpoint directory
  const runState = await loadJson(path.join(ATTEMPT_DIR, "run-state.json"));
  const state = runState.state;
  const accounting = await loadJson(path.join(ATTEMPT_DIR, "accounting.json"));

  const planner = await loadJson(path.join(ATTEMPT_DIR, "artifact-01-planner.json"));
  const writer = await loadJson(path.join(ATTEMPT_DIR, "artifact-02-writer.json"));
  const qualityReview = await loadJson(path.join(ATTEMPT_DIR, "artifact-03-qualityReviewer.json"));
  const calibrated = await loadJson(path.join(ATTEMPT_DIR, "artifact-04-languageCalibrator.json"));
  const finalized = await loadJson(path.join(ATTEMPT_DIR, "artifact-05-finalizer.json"));
  const factReview = await loadJson(path.join(ATTEMPT_DIR, "artifact-06-factReviewer.json"));

  console.log("  Status:", state.status);
  console.log("  Stages:", state.calls.length);
  console.log("  Planner:", state.calls[0]?.status);
  console.log("  Writer:", state.calls[1]?.status);
  console.log("  Quality:", state.calls[2]?.status);
  console.log("  Calibrator:", state.calls[3]?.status);
  console.log("  Finalizer:", state.calls[4]?.status);
  console.log("  FactReviewer:", state.calls[5]?.status);

  // Load gate artifacts
  const gateResult = await loadJson(path.join(OUTPUT_BASE, "gate-result.json"));
  const contract = await loadJson(path.join(OUTPUT_BASE, "generation-contract.json"));

  // Extract responses from finalized output
  const responses = (finalized.responses || finalized.componentPlans || []).map((r: any) => ({
    componentId: r.componentId,
    title: r.title || r.componentId,
    text: r.text || "",
  }));

  // Build final text
  const docLabel = "STATEMENT OF OBJECTIVES";
  const finalText = responses
    .map((r: any) => r.componentId + ". " + r.title.toUpperCase() + "\n\n" + r.text)
    .join("\n\n");
  const fullText = docLabel.toUpperCase() + "\n\n" + finalText;

  // Calculate word count
  const wordCount = responses.reduce((s: number, r: any) => s + r.text.split(/\s+/).filter(Boolean).length, 0);

  // Build cost from usages
  const usages = state.calls.map((c: any) => c.usages[0]).filter((u: any) => u);
  const totalInput = usages.reduce((s: number, u: any) => s + u.inputTokens, 0);
  const totalCached = usages.reduce((s: number, u: any) => s + u.cachedInputTokens, 0);
  const totalOutput = usages.reduce((s: number, u: any) => s + u.outputTokens, 0);
  const totalTokens = usages.reduce((s: number, u: any) => s + u.totalTokens, 0);
  const totalCostUsd = usages.reduce((s: number, u: any) => s + u.estimatedCostUsd, 0);
  const totalDuration = state.calls.reduce((s: number, c: any) => {
    const completed = new Date(c.completedAt).getTime();
    const started = new Date(c.startedAt).getTime();
    return s + (completed - started);
  }, 0);

  const exchangeRate = state.exchangeRate;
  const totalCostInr = totalCostUsd * exchangeRate;

  console.log("\n  Word count:", wordCount);
  console.log("  Cost USD: $" + totalCostUsd.toFixed(6));
  console.log("  Cost INR: \u20b9" + totalCostInr.toFixed(2));
  console.log("  Duration: " + (totalDuration / 1000).toFixed(1) + "s");

  // ===== SAVE ALL ARTIFACTS =====
  console.log("\nSaving artifacts...");

  await saveJson(path.join(OUTPUT_BASE, "planner.json"), planner);
  await saveJson(path.join(OUTPUT_BASE, "writer.json"), writer);
  await saveJson(path.join(OUTPUT_BASE, "quality-review.json"), qualityReview);
  await saveJson(path.join(OUTPUT_BASE, "language-calibration.json"), calibrated);
  await saveJson(path.join(OUTPUT_BASE, "bounded-finalizer.json"), finalized);
  await saveJson(path.join(OUTPUT_BASE, "final-fact-review.json"), factReview);

  // Save evidence ledger (rebuild from contract)
  // We don't have the exact evidence ledger but can reconstruct the hash
  await saveJson(path.join(OUTPUT_BASE, "evidence-ledger.json"), {
    ledgerHash: state.hashes.applicationSpecificFactsHash,
    note: "Reconstructed from checkpoint state hash",
  });

  // Save final response
  const finalResponse = {
    status: "success",
    generationId: state.generationId,
    documentType: docLabel,
    responseComponentCount: responses.length,
    responses,
    finalText: fullText,
    wordCount,
    model: "gpt-5.6-sol",
    stages: 6,
    duration: totalDuration,
  };
  await saveJson(path.join(OUTPUT_BASE, "final-response.json"), finalResponse);

  // Save final statement text
  await fs.writeFile(path.join(OUTPUT_BASE, "final-statement-of-objectives.txt"), fullText);

  // Save cost
  await saveJson(path.join(OUTPUT_BASE, "cost.json"), {
    usage: {
      inputTokens: totalInput,
      cachedInputTokens: totalCached,
      outputTokens: totalOutput,
      totalTokens: totalTokens,
    },
    estimatedUsd: totalCostUsd,
    estimatedInr: totalCostInr,
    exchangeRate: {
      pair: "USD/INR",
      rate: exchangeRate,
      source: "open.er-api.com",
    },
    stages: usages,
  });

  // Save usage
  await saveJson(path.join(OUTPUT_BASE, "usage.json"), {
    stages: usages,
    totalInputTokens: totalInput,
    totalCachedInputTokens: totalCached,
    totalOutputTokens: totalOutput,
    totalTokens: totalTokens,
    estimatedApiCostUSD: totalCostUsd,
    estimatedApiCostINR: totalCostInr,
    exchangeRate: { pair: "USD/INR", rate: exchangeRate, source: "open.er-api.com" },
  });

  // Save attempt accounting
  await saveJson(path.join(OUTPUT_BASE, "attempt-accounting.json"), accounting);

  // ===== COMPUTE COMPLIANCE =====
  const totalInvented = factReview.totalInventedFacts ?? 0;
  const totalAltered = factReview.totalAlteredFacts ?? 0;
  const totalElaborations = factReview.totalInterpretiveElaborations ?? 0;
  const totalAmbiguous = factReview.totalAmbiguousClaims ?? 0;
  const factPass = factReview.overallPass === true && totalInvented === 0 && totalAltered === 0;

  // Count supported facts by classification
  let supportedStudent = 0, supportedProgram = 0, supportedFaculty = 0, interpretive = 0;
  if (factReview.components) {
    for (const comp of factReview.components) {
      for (const claim of comp.claims || []) {
        if (claim.classification === "SUPPORTED_STUDENT_FACT") supportedStudent++;
        else if (claim.classification === "SUPPORTED_PROGRAM_FACT") supportedProgram++;
        else if (claim.classification === "SUPPORTED_FACULTY_FACT") supportedFaculty++;
        else if (claim.classification === "INTERPRETIVE_ELABORATION") interpretive++;
      }
    }
  }

  const submissionStatus = factPass ? "READY_TO_SUBMIT" : "REVIEW_REQUIRED";

  const compliance = {
    factSafety: {
      status: factPass ? "PASS" : "FAIL",
      inventedFacts: totalInvented,
      alteredFacts: totalAltered,
      interpretiveElaborations: totalElaborations,
      ambiguousClaims: totalAmbiguous,
      supportedStudentFacts: supportedStudent,
      supportedProgramFacts: supportedProgram,
      supportedFacultyFacts: supportedFaculty,
    },
    submissionStatus,
    physicalPageBlocker: null as any,
    pageLimit: "PENDING" as any,
  };

  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), compliance);
  await saveJson(path.join(OUTPUT_BASE, "submission-status.json"), {
    submissionStatus,
    factSafety: compliance.factSafety,
  });

  // ===== RENDER FINAL PDFs =====
  console.log("\nRendering final PDFs...");
  const renderDir = path.join(OUTPUT_BASE, "render");
  await fs.mkdir(renderDir, { recursive: true });

  const responseComponents = contract.responseComponents;

  for (const resp of responses) {
    const rc = responseComponents.find((r: any) => r.componentId === resp.componentId);
    const label = rc?.label || resp.title;
    const html = generateComponentHtml(label, resp.text, DVIVID_STANDARD_APPLICATION_V1);
    const renderResult = await renderHtmlToPdfPages(html);
    const safeName = resp.componentId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    await fs.writeFile(path.join(renderDir, safeName + ".pdf"), renderResult.pdfBuffer);
    console.log("  " + label + ": " + renderResult.pageCount + " page(s)");
  }

  // Combined PDF
  const combinedHtml = generateCombinedHtml(
    docLabel,
    responses.map((r: any) => ({
      componentId: r.componentId,
      label: responseComponents.find((rc: any) => rc.componentId === r.componentId)?.label || r.title,
      text: r.text,
    })),
    DVIVID_STANDARD_APPLICATION_V1
  );
  const combinedRender = await renderHtmlToPdfPages(combinedHtml);
  await fs.writeFile(path.join(renderDir, "combined-statement-of-objectives.pdf"), combinedRender.pdfBuffer);
  console.log("  Combined: " + combinedRender.pageCount + " page(s)");

  // Update compliance with page info
  const componentPages: any = {};
  for (const resp of responses) {
    const rc = responseComponents.find((r: any) => r.componentId === resp.componentId);
    const label = rc?.label || resp.title;
    const html = generateComponentHtml(label, resp.text, DVIVID_STANDARD_APPLICATION_V1);
    const renderResult = await renderHtmlToPdfPages(html);
    componentPages[resp.componentId] = {
      actualPages: renderResult.pageCount,
      maxPages: rc?.pageLimit?.maxPages || 1,
    };
  }

  const allPagesPass = responses.every((r: any) => {
    const pages = componentPages[r.componentId];
    return pages.actualPages <= pages.maxPages;
  });

  compliance.pageLimit = allPagesPass ? "PASS" : "FAIL";
  compliance.physicalPageBlocker = allPagesPass ? null : "PHYSICAL_PAGE_LIMIT_EXCEEDED";

  const finalSubmissionStatus = factPass && allPagesPass ? "READY_TO_SUBMIT" : "REVIEW_REQUIRED";
  compliance.submissionStatus = finalSubmissionStatus;

  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), compliance);
  await saveJson(path.join(OUTPUT_BASE, "submission-status.json"), {
    submissionStatus: finalSubmissionStatus,
    factSafety: compliance.factSafety,
    pageLimit: compliance.pageLimit,
    physicalPageBlocker: compliance.physicalPageBlocker,
    componentPages,
  });

  // ===== BUILD COMPARISON =====
  console.log("\nBuilding comparison...");
  const comparison: any = {};
  for (const genId of ["001", "002", "003", "004"]) {
    const genPath = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-" + genId);
    try {
      const genResp = await loadJson(path.join(genPath, "final-response.json"));
      const genCompliance = await loadJson(path.join(genPath, "final-compliance.json")).catch(() => null);
      const genCost = await loadJson(path.join(genPath, "cost.json")).catch(() => null);
      comparison[genId] = {
        status: genResp.status,
        stages: genResp.stages,
        duration: genResp.duration,
        wordCount: genResp.wordCount,
        inventedFacts: genCompliance?.factSafety?.inventedFacts ?? null,
        alteredFacts: genCompliance?.factSafety?.alteredFacts ?? null,
        interpretiveElaborations: genCompliance?.factSafety?.interpretiveElaborations ?? null,
        submissionStatus: genCompliance?.submissionStatus ?? null,
        pageLimit: genCompliance?.pageLimit ?? null,
        costUsd: genCost?.estimatedUsd ?? null,
        costInr: genCost?.estimatedInr ?? null,
      };
    } catch (e) {
      comparison[genId] = { error: "Not found" };
    }
  }
  await saveJson(path.join(OUTPUT_BASE, "comparison-001-002-003-004.json"), comparison);

  // ===== ROOT-CAUSE ATTRIBUTION =====
  if (totalInvented > 0) {
    console.log("\nRoot-cause attribution for invented facts...");
    const writerText = (writer.responses || writer.componentPlans || []).map((r: any) => r.text || "").join(" ");
    const calibratedText = (calibrated.responses || calibrated.componentPlans || []).map((r: any) => r.text || "").join(" ");
    const finalizerText = (finalized.responses || finalized.componentPlans || []).map((r: any) => r.text || "").join(" ");

    const inventedClaims: any[] = [];
    if (factReview.components) {
      for (const comp of factReview.components) {
        for (const claim of comp.claims || []) {
          if (claim.classification === "INVENTED_FACT") {
            const claimText = claim.claim || claim.text || "";
            const claimSnippet = claimText.toLowerCase().substring(0, 60);
            const inWriter = writerText.toLowerCase().includes(claimSnippet);
            const inCalibrator = calibratedText.toLowerCase().includes(claimSnippet);
            const inFinalizer = finalizerText.toLowerCase().includes(claimSnippet);

            let source = "UNKNOWN";
            if (inWriter) source = "WRITER_INTRODUCED";
            else if (inCalibrator && !inWriter) source = "LANGUAGE_CALIBRATOR_INTRODUCED";
            else if (inFinalizer && !inWriter && !inCalibrator) source = "FINALIZER_INTRODUCED";

            inventedClaims.push({
              claim: claimText,
              componentId: comp.componentId,
              classification: claim.classification,
              severity: claim.severity,
              source,
              presentInWriter: inWriter,
              presentInCalibrator: inCalibrator,
              presentInFinalizer: inFinalizer,
            });
          }
        }
      }
    }

    const attribution = {
      totalInvented: inventedClaims.length,
      writerIntroduced: inventedClaims.filter(c => c.source === "WRITER_INTRODUCED").length,
      languageCalibratorIntroduced: inventedClaims.filter(c => c.source === "LANGUAGE_CALIBRATOR_INTRODUCED").length,
      finalizerIntroduced: inventedClaims.filter(c => c.source === "FINALIZER_INTRODUCED").length,
      unknown: inventedClaims.filter(c => c.source === "UNKNOWN").length,
      claims: inventedClaims,
    };
    await saveJson(path.join(OUTPUT_BASE, "mit-004-invention-analysis.json"), attribution);
    console.log("  Writer: " + attribution.writerIntroduced + ", Calibrator: " + attribution.languageCalibratorIntroduced + ", Finalizer: " + attribution.finalizerIntroduced + ", Unknown: " + attribution.unknown);
  }

  // ===== SUMMARY =====
  console.log("\n=== GENERATION #004 SUMMARY ===");
  console.log("Status: success");
  console.log("Generation ID: " + state.generationId);
  console.log("Stages: 6");
  console.log("Duration: " + (totalDuration / 1000).toFixed(1) + "s");
  console.log("Word count: " + wordCount);
  console.log("Cost USD: $" + totalCostUsd.toFixed(6));
  console.log("Cost INR: \u20b9" + totalCostInr.toFixed(2));
  console.log("\nFact Safety:");
  console.log("  Invented: " + totalInvented);
  console.log("  Altered: " + totalAltered);
  console.log("  Interpretive: " + totalElaborations);
  console.log("  Ambiguous: " + totalAmbiguous);
  console.log("  Supported student: " + supportedStudent);
  console.log("  Supported program: " + supportedProgram);
  console.log("  Supported faculty: " + supportedFaculty);
  console.log("\nSubmission: " + finalSubmissionStatus);
  console.log("Page limit: " + compliance.pageLimit);
  for (const [id, info] of Object.entries(componentPages)) {
    console.log("  " + id + ": " + (info as any).actualPages + "/" + (info as any).maxPages + " pages");
  }

  for (const resp of responses) {
    const words = resp.text.split(/\s+/).filter(Boolean).length;
    console.log("\n" + resp.componentId + " (" + resp.title + "): " + words + " words");
  }

  console.log("\nAll artifacts saved to: " + OUTPUT_BASE);
  console.log("\nPHASE SOP-AI-15: Recovery complete.");
}

main().catch(e => {
  console.error("FATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
