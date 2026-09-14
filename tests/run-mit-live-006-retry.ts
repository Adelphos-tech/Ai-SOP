/**
 * PHASE SOP-AI-20 — #006 Technical Stage-5 Retry
 *
 * Resumes from Stage 5 (Finalizer) using existing checkpoints for stages 1-4.
 * No code changes. No stages 1-4 rerun.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  runApplicationPipeline,
  ApplicationPipelineInput,
} from "../src/lib/ai/pipeline/run-application-pipeline";
import { isApiKeyConfigured } from "../src/lib/ai/openai-client";
import {
  buildGenerationContract,
  validateContractForWriting,
} from "../src/lib/requirements/generation-contract";
import {
  ResponseComponent,
  FacultyAlignment,
  PageLimitConstraint,
} from "../src/lib/requirements/generation-contract-types";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { generateComponentHtml, generateCombinedHtml } from "../src/lib/render/html-generator";
import { runSpecificityGuard } from "../src/lib/ai/specificity-guard";
import { verifyGenerationBuildManifest } from "../src/lib/ai/generation-build-manifest";

const GENERATION_NUMBER = "006";
const GENERATION_ID = "3dc28fa9-611f-4f42-86b6-da6a721aee58";
const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");
const OUTPUT_BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-" + GENERATION_NUMBER);

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
  console.log("=== PHASE SOP-AI-20: #006 TECHNICAL STAGE-5 RETRY ===\n");
  const startTime = Date.now();

  // Load manifest to verify immutability
  const manifest = await loadJson(path.join(OUTPUT_BASE, "generation-build-manifest.json"));
  console.log("Generation ID: " + GENERATION_ID);
  console.log("Manifest generation number: " + manifest.generationNumber);

  // Verify golden run integrity (no code changes)
  const integrityCheck = await verifyGenerationBuildManifest(manifest, process.cwd());
  console.log("Golden integrity: " + (integrityCheck.valid ? "PASS" : "FAIL"));
  if (!integrityCheck.valid) {
    console.error("BLOCKED: Code changed since manifest creation — cannot retry");
    process.exit(1);
  }

  // Load artifacts (same as original run)
  const brief = await loadJson(path.join(ARTIFACT_BASE, "verified-application-brief.json"));
  const aiPolicy = await loadJson(path.join(ARTIFACT_BASE, "ai-usage-policy.json"));
  const rcData = await loadJson(path.join(ARTIFACT_BASE, "response-components.json"));
  const proposalsData = await loadJson(path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json"));
  const contractData = await loadJson(path.join(ARTIFACT_BASE, "generation-contract-approved.json"));
  const profile = contractData.contract.studentFacts;

  const responseComponents: ResponseComponent[] = rcData.responseComponents;
  const pageLimit: PageLimitConstraint = rcData.totalPageLimit;
  const facultyAlignment: FacultyAlignment[] = proposalsData.proposals
    .filter((p: any) => p.status === "STUDENT_APPROVED")
    .map((p: any) => ({
      facultyName: p.facultyName,
      verifiedProgramFactSource: p.verifiedFacultyEvidence[0],
      studentInterestEvidence: p.studentInterestEvidence,
      alignmentReason: p.alignmentReason,
      status: "STUDENT_APPROVED" as const,
    }));

  // Rebuild contract (must be identical)
  const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents, pageLimit, facultyAlignment, programContext: null,
  });
  if (contractResult.status !== "CLEARED" || !contractResult.contract) {
    console.error("BLOCKED: Contract not cleared on retry");
    process.exit(1);
  }
  const contract = contractResult.contract;
  const documentTypeLabel = contract.writingRequirement.documentTypeLabel;
  const programContextText = contract.programContext ? JSON.stringify(contract.programContext) : "";

  // Check API key
  if (!isApiKeyConfigured()) {
    console.error("BLOCKED: OPENAI_API_KEY not configured");
    process.exit(1);
  }
  console.log("API key: CONFIGURED");

  // Run pipeline with TECHNICAL_STAGE_RETRY
  console.log("\nRunning pipeline with TECHNICAL_STAGE_RETRY (Stage 5 only)...\n");

  const pipelineInput: ApplicationPipelineInput = {
    profile,
    generationContract: contract,
    requirementsBrief: brief,
    aiPolicy,
    responseComponents: contract.responseComponents,
    facultyAlignment: contract.facultyAlignment,
    pageLimit: contract.pageLimit,
    programContextText,
    documentTypeLabel,
    execution: {
      generationId: GENERATION_ID,
      mode: "TECHNICAL_STAGE_RETRY",
    },
  };

  const result = await runApplicationPipeline(pipelineInput);

  console.log("\n  Pipeline status: " + result.status);
  console.log("  Stages: " + result.metrics.stages);
  console.log("  Duration: " + ((Date.now() - startTime) / 1000).toFixed(1) + "s");
  console.log("  Word count: " + result.metrics.wordCount);

  if (result.status === "error") {
    console.error("\nPIPELINE ERROR: " + result.error);
    await saveJson(path.join(OUTPUT_BASE, "pipeline-error.json"), {
      error: result.error,
      generationId: result.generationId,
      stages: result.metrics.stages,
      partialCost: result.metrics.cost,
      retryAttempt: true,
    });
  }

  // Save all artifacts (same as original runner)
  console.log("\nSaving artifacts...");
  await saveJson(path.join(OUTPUT_BASE, "planner.json"), result.planner);
  await saveJson(path.join(OUTPUT_BASE, "writer.json"), result.writerOutput);
  await saveJson(path.join(OUTPUT_BASE, "quality-review.json"), result.qualityReview);
  await saveJson(path.join(OUTPUT_BASE, "language-calibration.json"), result.calibratedOutput);
  await saveJson(path.join(OUTPUT_BASE, "bounded-finalizer.json"), result.finalizedOutput);
  await saveJson(path.join(OUTPUT_BASE, "final-fact-review.json"), result.factReview);
  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), result.compliance);

  if (result.evidencePackets) await saveJson(path.join(OUTPUT_BASE, "component-evidence-packets.json"), result.evidencePackets);
  if (result.writerEvidenceValidation) await saveJson(path.join(OUTPUT_BASE, "writer-evidence-validation.json"), result.writerEvidenceValidation);
  if (result.writerClaims) await saveJson(path.join(OUTPUT_BASE, "writer-claims.json"), result.writerClaims);
  if (result.calibratedClaims) await saveJson(path.join(OUTPUT_BASE, "language-claim-map.json"), result.calibratedClaims);
  if (result.evidenceLedger) await saveJson(path.join(OUTPUT_BASE, "evidence-ledger.json"), result.evidenceLedger);
  if (result.actionPlan) await saveJson(path.join(OUTPUT_BASE, "component-action-plan.json"), result.actionPlan);
  if (result.finalizerGuard) await saveJson(path.join(OUTPUT_BASE, "finalizer-guard.json"), result.finalizerGuard);
  if (result.claimProvenanceValidation) await saveJson(path.join(OUTPUT_BASE, "claim-provenance-validation.json"), result.claimProvenanceValidation);
  if (result.finalizedOutput) await saveJson(path.join(OUTPUT_BASE, "finalizer-claim-map.json"), result.finalizedOutput);

  // Writer specificity validation
  if (result.writerClaims && result.evidenceLedger) {
    const spec = runSpecificityGuard({
      writerClaims: result.writerClaims.map((c: any) => ({
        claimId: c.claimId, componentId: c.componentId,
        claim: c.text || c.claim || c.rewrittenText || "",
        evidenceIds: c.evidenceIds || [],
      })),
      evidenceEntries: result.evidenceLedger.allEntries,
    });
    await saveJson(path.join(OUTPUT_BASE, "writer-specificity-validation.json"), {
      valid: spec.length === 0, violations: spec,
    });
  }

  // Final response
  await saveJson(path.join(OUTPUT_BASE, "final-response.json"), {
    status: result.status, generationId: result.generationId || GENERATION_ID,
    generationNumber: GENERATION_NUMBER, documentType: documentTypeLabel,
    responseComponentCount: result.responses.length, responses: result.responses,
    finalText: result.finalText, wordCount: result.metrics.wordCount,
    model: result.metrics.model, stages: result.metrics.stages, duration: result.metrics.duration,
    renderLifecycle: result.renderLifecycle,
    preFinalRenderFeedback: result.preFinalRenderFeedback,
    finalRenderFeedback: result.finalRenderFeedback,
  });

  await fs.writeFile(path.join(OUTPUT_BASE, "final-statement-of-objectives.txt"), result.finalText);

  await saveJson(path.join(OUTPUT_BASE, "submission-status.json"), {
    submissionStatus: result.compliance?.submissionStatus,
    physicalPageBlocker: result.compliance?.physicalPageBlocker,
    factSafety: result.compliance?.factSafety,
    pageLimit: result.compliance?.pageLimit,
  });

  if (result.metrics.cost) {
    await saveJson(path.join(OUTPUT_BASE, "cost.json"), {
      usage: {
        inputTokens: result.metrics.cost.totalInputTokens,
        cachedInputTokens: result.metrics.cost.totalCachedInputTokens,
        outputTokens: result.metrics.cost.totalOutputTokens,
        totalTokens: result.metrics.cost.totalTokens,
      },
      estimatedUsd: result.metrics.cost.estimatedApiCostUSD,
      estimatedInr: result.metrics.cost.estimatedApiCostINR,
      exchangeRate: result.metrics.cost.exchangeRate,
      stages: result.metrics.cost.stages,
    });
    await saveJson(path.join(OUTPUT_BASE, "usage.json"), {
      stages: result.metrics.cost.stages,
      totalInputTokens: result.metrics.cost.totalInputTokens,
      totalCachedInputTokens: result.metrics.cost.totalCachedInputTokens,
      totalOutputTokens: result.metrics.cost.totalOutputTokens,
      totalTokens: result.metrics.cost.totalTokens,
      estimatedApiCostUSD: result.metrics.cost.estimatedApiCostUSD,
      estimatedApiCostINR: result.metrics.cost.estimatedApiCostINR,
      exchangeRate: result.metrics.cost.exchangeRate,
    });
  }

  if (result.accounting) {
    await saveJson(path.join(OUTPUT_BASE, "attempt-accounting.json"), result.accounting);
  }
  if (result.renderLifecycle) await saveJson(path.join(OUTPUT_BASE, "render-lifecycle.json"), result.renderLifecycle);
  if (result.preFinalRenderFeedback) await saveJson(path.join(OUTPUT_BASE, "pre-final-render.json"), result.preFinalRenderFeedback);
  if (result.finalRenderFeedback) await saveJson(path.join(OUTPUT_BASE, "final-render.json"), result.finalRenderFeedback);

  // Render PDFs
  if (result.status === "success") {
    console.log("\nRendering final PDFs...");
    const renderDir = path.join(OUTPUT_BASE, "render");
    await fs.mkdir(renderDir, { recursive: true });
    const renderPages: { componentId: string; label: string; pages: number }[] = [];

    for (const resp of result.responses) {
      const rc = responseComponents.find(r => r.componentId === resp.componentId);
      const label = rc?.label || resp.title;
      const html = generateComponentHtml(label, resp.text, DVIVID_STANDARD_APPLICATION_V1);
      const rr = await renderHtmlToPdfPages(html);
      const safeName = resp.componentId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
      await fs.writeFile(path.join(renderDir, safeName + ".pdf"), rr.pdfBuffer);
      console.log("  " + label + ": " + rr.pageCount + " page(s)");
      renderPages.push({ componentId: resp.componentId, label, pages: rr.pageCount });
    }

    const combinedHtml = generateCombinedHtml(documentTypeLabel,
      result.responses.map(r => ({
        componentId: r.componentId,
        label: responseComponents.find(rc => rc.componentId === r.componentId)?.label || r.title,
        text: r.text,
      })), DVIVID_STANDARD_APPLICATION_V1);
    const combinedRender = await renderHtmlToPdfPages(combinedHtml);
    await fs.writeFile(path.join(renderDir, "combined-statement-of-objectives.pdf"), combinedRender.pdfBuffer);
    console.log("  Combined: " + combinedRender.pageCount + " page(s)");
  }

  // Golden integrity post-check
  const postCheck = await verifyGenerationBuildManifest(manifest, process.cwd());
  await saveJson(path.join(OUTPUT_BASE, "golden-integrity-check.json"), {
    valid: postCheck.valid, changedFiles: postCheck.changedFiles,
    checkedAt: new Date().toISOString(), retryAttempt: true,
  });
  console.log("\nGolden integrity: " + (postCheck.valid ? "PASS" : "FAIL"));

  // Comparison
  const comparison: any = {};
  for (const genId of ["001", "002", "003", "004", "005", "006"]) {
    const genPath = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-" + genId);
    try {
      const genResp = await loadJson(path.join(genPath, "final-response.json"));
      const genCompliance = await loadJson(path.join(genPath, "final-compliance.json")).catch(() => null);
      const genCost = await loadJson(path.join(genPath, "cost.json")).catch(() => null);
      comparison[genId] = {
        status: genResp.status, stages: genResp.stages, duration: genResp.duration,
        wordCount: genResp.wordCount,
        inventedFacts: genCompliance?.factSafety?.inventedFacts ?? null,
        alteredFacts: genCompliance?.factSafety?.alteredFacts ?? null,
        interpretiveElaborations: genCompliance?.factSafety?.interpretiveElaborations ?? null,
        submissionStatus: genCompliance?.submissionStatus ?? null,
        pageLimit: genCompliance?.pageLimit ?? null,
        costUsd: genCost?.estimatedUsd ?? null, costInr: genCost?.estimatedInr ?? null,
      };
    } catch (e) { comparison[genId] = { error: "Not found" }; }
  }
  await saveJson(path.join(OUTPUT_BASE, "comparison-001-through-006.json"), comparison);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== #006 RETRY SUMMARY ===");
  console.log("Status: " + result.status);
  console.log("Stages: " + result.metrics.stages);
  console.log("Duration: " + elapsed + "s");
  console.log("Word count: " + result.metrics.wordCount);
  if (result.metrics.cost) {
    console.log("Cost USD: $" + result.metrics.cost.estimatedApiCostUSD.toFixed(6));
    console.log("Cost INR: \u20b9" + result.metrics.cost.estimatedApiCostINR.toFixed(2));
  }
  if (result.compliance) {
    console.log("\nSubmission status: " + result.compliance.submissionStatus);
    console.log("Fact safety: " + result.compliance.factSafety?.status);
    console.log("  Invented: " + result.compliance.factSafety?.inventedFacts);
    console.log("  Altered: " + result.compliance.factSafety?.alteredFacts);
    console.log("  Interpretive: " + result.compliance.factSafety?.interpretiveElaborations);
  }
  if (result.finalizerGuard) {
    console.log("\nFinalizer Guard: valid=" + result.finalizerGuard.valid);
  }
  if (result.accounting) {
    console.log("\nAttempt Accounting:");
    console.log("  Pipeline runs: " + result.accounting.pipelineRuns);
    console.log("  Technical stage retries: " + result.accounting.technicalStageRetries);
    console.log("  Paid API calls: " + result.accounting.paidApiCalls);
    console.log("  All attempt cost: $" + (result.accounting.allAttemptCostUsd?.toFixed(6) || "N/A"));
  }
  console.log("\nPHASE SOP-AI-20: #006 retry complete.");
}

main().catch(e => {
  console.error("FATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
