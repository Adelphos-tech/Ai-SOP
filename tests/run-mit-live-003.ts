/**
 * PHASE SOP-AI-13 — MIT Golden Regression #003
 *
 * Evidence-locked + checkpointed live generation through the deployed
 * generic production pipeline.
 *
 * This is a LIVE generation with PAID OpenAI calls.
 * Exactly ONE content generation attempt. No loops. No #004.
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
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
import { checkGenerationGate } from "../src/lib/requirements/generation-gate";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { generateComponentHtml, generateCombinedHtml } from "../src/lib/render/html-generator";

const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");
const OUTPUT_BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-003");

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
  console.log("=== PHASE SOP-AI-13: MIT GOLDEN REGRESSION #003 ===\n");
  const startTime = Date.now();

  // ===== STEP 1: Load persisted artifacts =====
  console.log("Step 1: Loading persisted artifacts...");
  const brief = await loadJson(path.join(ARTIFACT_BASE, "verified-application-brief.json"));
  const aiPolicy = await loadJson(path.join(ARTIFACT_BASE, "ai-usage-policy.json"));
  const rcData = await loadJson(path.join(ARTIFACT_BASE, "response-components.json"));
  const proposalsData = await loadJson(path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json"));

  const responseComponents: ResponseComponent[] = rcData.responseComponents;
  const pageLimit: PageLimitConstraint = rcData.totalPageLimit;

  console.log(("  Brief: " + (brief.applicationIdentity?.university || "unknown")));
  console.log(("  AI Policy: " + (aiPolicy.status) + " (generationAllowed: " + (aiPolicy.generationAllowed) + ")"));
  console.log(("  Response components: " + (responseComponents.length)));
  console.log(("  Page limit: " + (pageLimit.maxPages) + " pages (" + (pageLimit.type) + ")"));

  // ===== STEP 2: Verify faculty approvals =====
  console.log("\nStep 2: Verifying faculty approvals...");
  const approvedAlignments = proposalsData.proposals.filter((p: any) => p.status === "STUDENT_APPROVED");
  const facultyAlignment: FacultyAlignment[] = approvedAlignments.map((p: any) => ({
    facultyName: p.facultyName,
    verifiedProgramFactSource: p.verifiedFacultyEvidence[0],
    studentInterestEvidence: p.studentInterestEvidence,
    alignmentReason: p.alignmentReason,
    status: "STUDENT_APPROVED" as const,
  }));

  const buyukozturk = facultyAlignment.find(f => f.facultyName.includes("Buyukozturk"));
  const carstensen = facultyAlignment.find(f => f.facultyName.includes("Carstensen"));

  console.log(("  Buyukozturk: " + (buyukozturk?.status || "NOT FOUND")));
  console.log(("  Carstensen: " + (carstensen?.status || "NOT FOUND")));

  if (!buyukozturk || !carstensen) {
    console.error("BLOCKED: Faculty approvals not valid");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), {
      reason: "FACULTY_APPROVAL_INVALID",
      buyukozturk: buyukozturk?.status || "NOT_FOUND",
      carstensen: carstensen?.status || "NOT_FOUND",
    });
    process.exit(1);
  }

  // ===== STEP 3: Rebuild student profile from contract =====
  console.log("\nStep 3: Rebuilding student profile from contract...");
  const contractData = await loadJson(path.join(ARTIFACT_BASE, "generation-contract-approved.json"));
  const profile = contractData.contract.studentFacts;

  console.log(("  Student: " + (profile.personalDetails?.firstName) + " " + (profile.personalDetails?.lastName)));
  console.log(("  Fact sheet approved: " + (profile.factSheetApproval?.approved)));
  console.log(("  Requirements confirmed: " + (profile.factSheetApproval?.requirementsConfirmed)));

  // ===== STEP 4: Re-run generation gate =====
  console.log("\nStep 4: Re-running generation gate...");
  const gate = checkGenerationGate(profile, brief, aiPolicy);

  console.log(("  Gate allowed: " + (gate.allowed)));
  console.log(("  Blocking issues: " + (gate.blockingIssues.length)));
  if (gate.blockingIssues.length > 0) {
    gate.blockingIssues.forEach(i => console.log(("    - " + (i.field) + ": " + (i.issue))));
  }

  if (!gate.allowed) {
    console.error("BLOCKED: Generation gate failed");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), {
      reason: "GENERATION_GATE_FAILED",
      blockingIssues: gate.blockingIssues,
    });
    process.exit(1);
  }

  // ===== STEP 5: Rebuild generation contract =====
  console.log("\nStep 5: Rebuilding generation contract...");
  const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents,
    pageLimit,
    facultyAlignment,
    programContext: null,
  });

  console.log(("  Contract status: " + (contractResult.status)));
  if (contractResult.blockingReasons.length > 0) {
    contractResult.blockingReasons.forEach(r => console.log(("    - " + (r))));
  }

  if (contractResult.status !== "CLEARED" || !contractResult.contract) {
    console.error("BLOCKED: Contract not cleared");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), {
      reason: "CONTRACT_NOT_CLEARED",
      status: contractResult.status,
      blockingReasons: contractResult.blockingReasons,
    });
    process.exit(1);
  }

  const validation = validateContractForWriting(contractResult.contract);
  console.log(("  Contract validation: " + (validation.valid ? "PASS" : "FAIL")));
  if (!validation.valid) {
    console.error(("BLOCKED: " + (validation.reason)));
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), {
      reason: "CONTRACT_VALIDATION_FAILED",
      validation,
    });
    process.exit(1);
  }

  // ===== STEP 6: Confirm AI policy =====
  console.log("\nStep 6: Confirming AI policy...");
  if (aiPolicy.status !== "AI_GENERATION_ALLOWED" || !aiPolicy.generationAllowed) {
    console.error("BLOCKED: AI policy does not allow generation");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), {
      reason: "AI_POLICY_BLOCK",
      status: aiPolicy.status,
    });
    process.exit(1);
  }
  console.log(("  AI Policy: " + (aiPolicy.status) + " \u2014 PASS"));

  // ===== STEP 7: Save pre-generation artifacts =====
  console.log("\nStep 7: Saving pre-generation artifacts...");
  await saveJson(path.join(OUTPUT_BASE, "generation-contract.json"), contractResult.contract);
  await saveJson(path.join(OUTPUT_BASE, "gate-result.json"), {
    gate: { allowed: gate.allowed, blockingIssues: gate.blockingIssues },
    contract: { status: contractResult.status, clearedForWriting: contractResult.contract.clearedForWriting },
    validation,
    aiPolicy: { status: aiPolicy.status, generationAllowed: aiPolicy.generationAllowed },
    facultyApprovals: {
      buyukozturk: buyukozturk.status,
      carstensen: carstensen.status,
    },
  });

  // ===== STEP 8: Check OpenAI API key =====
  console.log("\nStep 8: Checking OpenAI API key...");
  if (!isApiKeyConfigured()) {
    console.error("BLOCKED: OpenAI API key not configured");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "OPENAI_API_KEY_REQUIRED" });
    process.exit(1);
  }
  console.log("  API key: CONFIGURED");

  // ===== STEP 9: Run the 6-stage pipeline (Phase 12B architecture) =====
  console.log("\nStep 9: Running 6-stage pipeline (PAID CALLS)...");
  console.log("  Model: gpt-5.6-sol");
  console.log("  Architecture: Evidence-locked + checkpointed");
  console.log("");

  const generationId = randomUUID();
  const documentTypeLabel = brief.documents[0]?.documentTypeLabel || "STATEMENT OF OBJECTIVES";

  const pipelineInput: ApplicationPipelineInput = {
    profile,
    generationContract: contractResult.contract,
    requirementsBrief: brief,
    aiPolicy,
    responseComponents: contractResult.contract.responseComponents,
    facultyAlignment: contractResult.contract.facultyAlignment,
    pageLimit: contractResult.contract.pageLimit,
    programContextText: contractResult.contract.programContext
      ? JSON.stringify(contractResult.contract.programContext)
      : "",
    documentTypeLabel,
    execution: {
      generationId,
      mode: "CONTENT_REGENERATION" as const,
    },
  };

  const result = await runApplicationPipeline(pipelineInput);

  console.log(("\\n  Pipeline status: " + (result.status)));
  console.log(("  Generation ID: " + (result.generationId || generationId)));
  console.log(("  Stages: " + (result.metrics.stages)));
  console.log(("  Duration: " + ((result.metrics.duration / 1000).toFixed(1)) + "s"));
  console.log(("  Word count: " + (result.metrics.wordCount)));

  if (result.status === "error") {
    console.error(("PIPELINE ERROR: " + (result.error)));
    await saveJson(path.join(OUTPUT_BASE, "pipeline-error.json"), {
      error: result.error,
      generationId: result.generationId || generationId,
      stages: result.metrics.stages,
      duration: result.metrics.duration,
      cost: result.metrics.cost,
      accounting: result.accounting,
    });
    process.exit(1);
  }

  // ===== STEP 10: Save all artifacts =====
  console.log("\nStep 10: Saving artifacts...");

  await saveJson(path.join(OUTPUT_BASE, "planner.json"), result.planner);
  await saveJson(path.join(OUTPUT_BASE, "writer.json"), result.writerOutput);
  await saveJson(path.join(OUTPUT_BASE, "quality-review.json"), result.qualityReview);
  await saveJson(path.join(OUTPUT_BASE, "final-fact-review.json"), result.factReview);
  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), result.compliance);

  // Save evidence ledger
  if (result.evidenceLedger) {
    await saveJson(path.join(OUTPUT_BASE, "evidence-ledger.json"), result.evidenceLedger);
  }

  // Save component action plan
  if (result.actionPlan) {
    await saveJson(path.join(OUTPUT_BASE, "component-action-plan.json"), result.actionPlan);
  }

  // Save bounded finalizer output and guard
  if (result.finalizedOutput) {
    await saveJson(path.join(OUTPUT_BASE, "bounded-finalizer.json"), result.finalizedOutput);
  }
  if (result.finalizerGuard) {
    await saveJson(path.join(OUTPUT_BASE, "finalizer-guard.json"), result.finalizerGuard);
  }

  // Save final response
  const finalResponse = {
    status: result.status,
    generationId: result.generationId || generationId,
    documentType: documentTypeLabel,
    responseComponentCount: result.responses.length,
    responses: result.responses,
    finalText: result.finalText,
    wordCount: result.metrics.wordCount,
    model: result.metrics.model,
    stages: result.metrics.stages,
    duration: result.metrics.duration,
    renderLifecycle: result.renderLifecycle,
    preFinalRenderFeedback: result.preFinalRenderFeedback,
    finalRenderFeedback: result.finalRenderFeedback,
  };
  await saveJson(path.join(OUTPUT_BASE, "final-response.json"), finalResponse);

  // Save final statement text
  await fs.writeFile(path.join(OUTPUT_BASE, "final-statement-of-objectives.txt"), result.finalText);

  // Save submission status
  await saveJson(path.join(OUTPUT_BASE, "submission-status.json"), {
    submissionStatus: result.compliance?.submissionStatus,
    physicalPageBlocker: result.compliance?.physicalPageBlocker,
    factSafety: result.compliance?.factSafety,
    pageLimit: result.compliance?.pageLimit,
  });

  // Save cost
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
  }

  // Save attempt accounting
  if (result.accounting) {
    await saveJson(path.join(OUTPUT_BASE, "attempt-accounting.json"), result.accounting);
  } else {
    await saveJson(path.join(OUTPUT_BASE, "attempt-accounting.json"), {
      pipelineRuns: 1,
      contentGenerationAttempts: 1,
      technicalStageRetries: 0,
      successfulPipelineRuns: result.status === "success" ? 1 : 0,
      failedPipelineRuns: result.status === "success" ? 0 : 1,
      paidApiCalls: result.metrics.stages,
      successfulRunCostUsd: result.metrics.cost?.estimatedApiCostUSD || 0,
      technicalRetryCostUsd: 0,
      allAttemptCostUsd: result.metrics.cost?.estimatedApiCostUSD || 0,
    });
  }

  // Save render lifecycle
  if (result.renderLifecycle) {
    await saveJson(path.join(OUTPUT_BASE, "render-lifecycle.json"), result.renderLifecycle);
  }
  if (result.preFinalRenderFeedback) {
    await saveJson(path.join(OUTPUT_BASE, "pre-final-render.json"), result.preFinalRenderFeedback);
  }
  if (result.finalRenderFeedback) {
    await saveJson(path.join(OUTPUT_BASE, "final-render.json"), result.finalRenderFeedback);
  }

  // Save language calibration
  if (result.writerOutput) {
    await saveJson(path.join(OUTPUT_BASE, "language-calibration.json"), {
      writerOutput: result.writerOutput,
    });
  }

  // ===== STEP 11: Render final PDFs =====
  console.log("\nStep 11: Rendering final PDFs...");
  const renderDir = path.join(OUTPUT_BASE, "render");
  await fs.mkdir(renderDir, { recursive: true });

  for (const resp of result.responses) {
    const rc = responseComponents.find(r => r.componentId === resp.componentId);
    const label = rc?.label || resp.title;
    const html = generateComponentHtml(label, resp.text, DVIVID_STANDARD_APPLICATION_V1);
    const renderResult = await renderHtmlToPdfPages(html);
    const safeName = resp.componentId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    await fs.writeFile(path.join(renderDir, safeName + ".pdf"), renderResult.pdfBuffer);
    console.log("  " + label + ": " + renderResult.pageCount + " page(s)");
  }

  // Combined PDF
  const combinedHtml = generateCombinedHtml(
    documentTypeLabel,
    result.responses.map(r => ({
      componentId: r.componentId,
      label: responseComponents.find(rc => rc.componentId === r.componentId)?.label || r.title,
      text: r.text,
    })),
    DVIVID_STANDARD_APPLICATION_V1
  );
  const combinedRender = await renderHtmlToPdfPages(combinedHtml);
  await fs.writeFile(path.join(renderDir, "combined-statement-of-objectives.pdf"), combinedRender.pdfBuffer);
  console.log(("  Combined: " + (combinedRender.pageCount) + " page(s)"));

  // ===== STEP 12: Summary =====
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== GENERATION #003 SUMMARY ===");
  console.log(("Status: " + (result.status)));
  console.log(("Generation ID: " + (result.generationId || generationId)));
  console.log(("Stages: " + (result.metrics.stages)));
  console.log(("Duration: " + (elapsed) + "s"));
  console.log(("Word count: " + (result.metrics.wordCount)));
  console.log(("Cost USD: $" + (result.metrics.cost?.estimatedApiCostUSD.toFixed(4) || "N/A")));
  console.log(("Cost INR: \u20b9" + (result.metrics.cost?.estimatedApiCostINR.toFixed(2) || "N/A")));

  if (result.compliance) {
    console.log(("\\nSubmission status: " + (result.compliance.submissionStatus)));
    console.log(("Fact safety: " + (result.compliance.factSafety.status)));
    console.log(("  Invented: " + (result.compliance.factSafety.inventedFacts)));
    console.log(("  Altered: " + (result.compliance.factSafety.alteredFacts)));
    console.log(("  Interpretive: " + (result.compliance.factSafety.interpretiveElaborations)));
    if (result.compliance.physicalPageBlocker) {
      console.log(("Physical page blocker: " + (result.compliance.physicalPageBlocker)));
    }
  }

  if (result.actionPlan) {
    console.log("\\nComponent Action Plan:");
    for (const plan of result.actionPlan.plans || []) {
      console.log(("  " + (plan.componentId) + ": " + (plan.action) + " \u2014 " + (plan.reason || "")));
    }
    if (result.actionPlan.blocked) {
      console.log(("  BLOCKED: " + (result.actionPlan.blockingIssues?.map(i => i.code).join(", "))));
    }
  }

  if (result.finalizerGuard) {
    console.log(("\\nFinalizer Guard: " + (result.finalizerGuard.valid ? "PASS" : "FAIL")));
    if (!result.finalizerGuard.valid) {
      console.log(("  Violations: " + (result.finalizerGuard.violations?.map(v => v).join(", "))));
    }
  }

  if (result.renderLifecycle) {
    console.log("\\nRender lifecycle:");
    console.log(("  Pre-final overflow: " + (result.renderLifecycle.hasOverflowPreFinal)));
    console.log(("  Final overflow: " + (result.renderLifecycle.hasOverflowFinal)));
    console.log(("  Compression attempted: " + (result.renderLifecycle.anyCompressionAttempted)));
    for (const comp of result.renderLifecycle.componentComparison) {
      console.log(("  " + (comp.label) + ": pre=" + (comp.preFinalPages) + "p/" + (comp.preFinalWords) + "w \u2192 final=" + (comp.finalPages) + "p/" + (comp.finalWords) + "w (max " + (comp.maxPages) + "p) \u2014 " + (comp.finalStatus)));
    }
  }

  if (result.accounting) {
    console.log("\\nAttempt Accounting:");
    console.log(("  Pipeline runs: " + (result.accounting.pipelineRuns)));
    console.log(("  Content generation attempts: " + (result.accounting.contentGenerationAttempts)));
    console.log(("  Technical stage retries: " + (result.accounting.technicalStageRetries)));
    console.log(("  Paid API calls: " + (result.accounting.paidApiCalls)));
    console.log(("  Successful run cost: $" + (result.accounting.successfulRunCostUsd?.toFixed(4) || "N/A")));
    console.log(("  All attempt cost: $" + (result.accounting.allAttemptCostUsd?.toFixed(4) || "N/A")));
  }

  for (const resp of result.responses) {
    const words = resp.text.split(/\s+/).filter(Boolean).length;
    console.log(("\\n" + (resp.componentId) + " (" + (resp.title) + "): " + (words) + " words"));
  }

  console.log(("\\nAll artifacts saved to: " + (OUTPUT_BASE)));
  console.log("\\nPHASE SOP-AI-13: Generation #003 complete.");
}

main().catch(e => {
  console.error("FATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
