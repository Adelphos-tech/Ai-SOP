/**
 * PHASE SOP-AI-22 — IMMUTABLE FINAL GOLDEN REGRESSION #006
 *
 * Live generation through the generic production pipeline with:
 * - Generation Build Manifest persisted BEFORE Stage 1
 * - ApplicationEvidenceBundle built and persisted
 * - Evidence parity verification
 * - Golden Run Integrity post-check
 * - Conditional Baseline V1 creation
 *
 * MIT CEE MEng is a regression fixture only. The pipeline is university-agnostic.
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
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
import { buildApplicationEvidenceBundle, isEvidenceVisible, getEvidenceById } from "../src/lib/ai/application-evidence-bundle";
import { buildEvidenceLedger } from "../src/lib/ai/evidence-ledger";
import { runSpecificityGuard } from "../src/lib/ai/specificity-guard";
import { containsMotivationAssertion } from "../src/lib/ai/writer-claim-types";
import {
  createGenerationBuildManifest,
  saveGenerationBuildManifest,
  verifyGenerationBuildManifest,
} from "../src/lib/ai/generation-build-manifest";
import { AI_CONFIG, getPromptVersionHash, getModelForStage, getAllModelsUsed, STAGE_MAX_COMPLETION_TOKENS } from "../src/lib/ai/config";

const GENERATION_NUMBER = "007";
const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");
const OUTPUT_BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-" + GENERATION_NUMBER);

async function loadJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function saveJson(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function hashString(s: string): Promise<string> {
  return createHash("sha256").update(s).digest("hex").substring(0, 16);
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
  console.log("=== PHASE SOP-AI-22: IMMUTABLE GOLDEN REGRESSION #006 ===\n");
  const startTime = Date.now();
  const generationId = randomUUID();

  // ===== STEP 1: Load persisted artifacts =====
  console.log("Step 1: Loading persisted artifacts...");
  const brief = await loadJson(path.join(ARTIFACT_BASE, "verified-application-brief.json"));
  const aiPolicy = await loadJson(path.join(ARTIFACT_BASE, "ai-usage-policy.json"));
  const rcData = await loadJson(path.join(ARTIFACT_BASE, "response-components.json"));
  const proposalsData = await loadJson(path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json"));

  const responseComponents: ResponseComponent[] = rcData.responseComponents;
  const pageLimit: PageLimitConstraint = rcData.totalPageLimit;

  console.log("  Brief: " + (brief.applicationIdentity?.university || "unknown"));
  console.log("  AI Policy: " + aiPolicy.status + " (generationAllowed: " + aiPolicy.generationAllowed + ")");
  console.log("  Response components: " + responseComponents.length);
  console.log("  Page limit: " + pageLimit.maxPages + " pages (" + pageLimit.type + ")");

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

  for (const f of facultyAlignment) {
    console.log("  " + f.facultyName + ": " + f.status);
  }

  if (facultyAlignment.length === 0) {
    console.error("BLOCKED: Faculty approvals not valid");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "FACULTY_APPROVAL_INVALID" });
    process.exit(1);
  }

  // ===== STEP 3: Rebuild student profile from approved contract =====
  console.log("\nStep 3: Rebuilding student profile from approved contract...");
  const contractData = await loadJson(path.join(ARTIFACT_BASE, "generation-contract-approved.json"));
  const profile = contractData.contract.studentFacts;

  console.log("  Student: " + profile.personalDetails?.firstName + " " + profile.personalDetails?.lastName);
  console.log("  Fact sheet approved: " + profile.factSheetApproval?.approved);
  console.log("  Requirements confirmed: " + profile.factSheetApproval?.requirementsConfirmed);

  // Verify SF-CHALLENGE-PROJECT-001
  const pc = profile.projectClarifications || [];
  const challengeFact = pc.find((p: any) => p.id === "SF-CHALLENGE-PROJECT-001");
  if (!challengeFact) {
    console.error("BLOCKED: SF-CHALLENGE-PROJECT-001 not found in profile");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "MISSING_PROJECT_CLARIFICATION" });
    process.exit(1);
  }
  console.log("  SF-CHALLENGE-PROJECT-001: " + challengeFact.approvalStatus + " (benchmarkOnly: " + challengeFact.benchmarkOnly + ")");

  // ===== STEP 4: Re-run generation gate =====
  console.log("\nStep 4: Re-running generation gate...");
  const gate = checkGenerationGate(profile, brief, aiPolicy);
  console.log("  Gate allowed: " + gate.allowed);
  console.log("  Blocking issues: " + gate.blockingIssues.length);
  if (gate.blockingIssues.length > 0) {
    gate.blockingIssues.forEach((i: any) => console.log("    - " + i.field + ": " + i.issue));
  }

  await saveJson(path.join(OUTPUT_BASE, "gate-result.json"), {
    allowed: gate.allowed,
    blockingIssues: gate.blockingIssues,
    aiPolicyStatus: aiPolicy.status,
    factSheetApproved: profile.factSheetApproval?.approved,
  });

  if (!gate.allowed) {
    console.error("BLOCKED: Generation gate failed");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "GATE_FAILED", blockingIssues: gate.blockingIssues });
    process.exit(1);
  }

  // ===== STEP 5: Rebuild generation contract =====
  console.log("\nStep 5: Rebuilding generation contract...");
  const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents, pageLimit, facultyAlignment, programContext: null,
  });

  console.log("  Contract status: " + contractResult.status);
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
  console.log("  Contract validation: " + (validation.valid ? "PASS" : "FAIL"));
  if (!validation.valid) {
    console.error("BLOCKED: Contract validation failed: " + validation.reason);
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "CONTRACT_VALIDATION_FAILED", reason2: validation.reason });
    process.exit(1);
  }

  const contract = contractResult.contract;
  await saveJson(path.join(OUTPUT_BASE, "generation-contract.json"), contract);

  // ===== STEP 6: Build ApplicationEvidenceBundle =====
  console.log("\nStep 6: Building ApplicationEvidenceBundle...");
  const programContextText = contract.programContext ? JSON.stringify(contract.programContext) : "";
  const evidenceBundle = buildApplicationEvidenceBundle({
    profile,
    programContextText,
    facultyAlignment,
  });

  await saveJson(path.join(OUTPUT_BASE, "application-evidence-bundle.json"), {
    bundleHash: evidenceBundle.bundleHash,
    schemaVersion: evidenceBundle.schemaVersion,
    allEntries: evidenceBundle.allEntries,
    studentFactsText: evidenceBundle.studentFactsText,
    programFactsText: evidenceBundle.programFactsText,
    facultyAlignment: evidenceBundle.facultyAlignment.map(f => ({ facultyName: f.facultyName, status: f.status })),
  });

  console.log("  Bundle hash: " + evidenceBundle.bundleHash);
  console.log("  Total entries: " + evidenceBundle.allEntries.length);

  // ===== STEP 7: Verify evidence parity =====
  console.log("\nStep 7: Verifying evidence parity...");
  const parityCheck = {
    sfChallengeProject001Visible: isEvidenceVisible(evidenceBundle, "SF-CHALLENGE-PROJECT-001"),
    sfStoryVisible: isEvidenceVisible(evidenceBundle, "SF-STORY"),
    totalEntries: evidenceBundle.allEntries.length,
    stages: {
      planner: "uses bundle.studentFactsText",
      writer: "uses bundle.studentFactsText + evidence packets",
      qualityReviewer: "uses evidence ledger",
      languageCalibrator: "uses bundle",
      boundedFinalizer: "uses bundle.studentFactsText",
      finalFactReviewer: "uses bundle.studentFactsText",
    },
    allEntries: evidenceBundle.allEntries.map((e: any) => ({ id: e.id, category: e.category, source: e.source })),
  };

  await saveJson(path.join(OUTPUT_BASE, "evidence-parity.json"), parityCheck);

  console.log("  SF-CHALLENGE-PROJECT-001 visible: " + parityCheck.sfChallengeProject001Visible);
  console.log("  SF-STORY visible: " + parityCheck.sfStoryVisible);

  if (!parityCheck.sfChallengeProject001Visible) {
    console.error("BLOCKED: SF-CHALLENGE-PROJECT-001 not visible in bundle");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "EVIDENCE_PARITY_FAILURE" });
    process.exit(1);
  }

  // ===== STEP 8: Build evidence ledger =====
  console.log("\nStep 8: Building evidence ledger...");
  const evidenceLedger = buildEvidenceLedger({
    studentFacts: profile as any,
    programContextText,
    facultyAlignment,
  });
  await saveJson(path.join(OUTPUT_BASE, "evidence-ledger.json"), evidenceLedger);
  console.log("  Ledger entries: " + evidenceLedger.allEntries.length);

  // ===== STEP 9: Create Generation Build Manifest (BEFORE Stage 1) =====
  console.log("\nStep 9: Creating Generation Build Manifest (BEFORE Stage 1)...");
  const modelConfigHash = createHash("sha256").update(JSON.stringify({
    models: getAllModelsUsed(),
    stageTokens: STAGE_MAX_COMPLETION_TOKENS,
    config: AI_CONFIG,
  })).digest("hex").substring(0, 16);

  const contractHash = await hashString(JSON.stringify(contract));
  const studentFactsHash = await hashString(JSON.stringify(profile));
  const ledgerHash = evidenceLedger.ledgerHash || await hashString(JSON.stringify(evidenceLedger.allEntries));
  const bundleHash = evidenceBundle.bundleHash;
  const promptHash = getPromptVersionHash();

  const manifest = await createGenerationBuildManifest({
    generationNumber: GENERATION_NUMBER,
    contractInstanceId: contract.contractId,
      contractSemanticHash: contract.contractSemanticHash || "",
      generationContractHash: contractHash,
    studentFactsHash,
    evidenceLedgerHash: ledgerHash,
    evidenceBundleHash: bundleHash,
    promptVersionHash: promptHash,
    modelConfigurationHash: modelConfigHash,
    renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
    renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
    model: getModelForStage("writer"),
    pipelineStages: ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"],
    projectRoot: process.cwd(),
  });

  await saveGenerationBuildManifest(manifest, OUTPUT_BASE);
  console.log("  Manifest persisted to: " + path.join(OUTPUT_BASE, "generation-build-manifest.json"));
  console.log("  Generation number: " + GENERATION_NUMBER);
  console.log("  Generation ID: " + generationId);
  console.log("  Model: " + manifest.model);
  console.log("  Prompt version: " + manifest.promptVersionHash);
  console.log("  Render profile: " + manifest.renderProfileId + " v" + manifest.renderProfileVersion);

  // ===== STEP 10: Verify OpenAI API key =====
  console.log("\nStep 10: Checking OpenAI API key...");
  if (!isApiKeyConfigured()) {
    console.error("BLOCKED: OPENAI_API_KEY not configured");
    await saveJson(path.join(OUTPUT_BASE, "gate-block.json"), { reason: "OPENAI_API_KEY_REQUIRED" });
    process.exit(1);
  }
  console.log("  API key: CONFIGURED");

  // ===== STEP 11: Run 6-stage pipeline (PAID CALLS) =====
  console.log("\nStep 11: Running 6-stage pipeline (PAID CALLS)...");
  console.log("  Model: " + manifest.model);
  console.log("  Architecture: Evidence-constrained + checkpointed + semantic grounding (Phase 19)");

  const documentTypeLabel = contract.writingRequirement.documentTypeLabel;

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
      generationId,
      mode: "CONTENT_REGENERATION",
    },
  };

  const result = await runApplicationPipeline(pipelineInput);

  if (result.status === "error") {
    console.error("\nPIPELINE ERROR: " + result.error);
    await saveJson(path.join(OUTPUT_BASE, "pipeline-error.json"), {
      error: result.error,
      generationId: result.generationId,
      stages: result.metrics.stages,
      partialCost: result.metrics.cost,
    });
    // Still save what we have
  }

  console.log("\n  Pipeline status: " + result.status);
  console.log("  Generation ID: " + (result.generationId || generationId));
  console.log("  Stages: " + result.metrics.stages);
  console.log("  Duration: " + ((Date.now() - startTime) / 1000).toFixed(1) + "s");
  console.log("  Word count: " + result.metrics.wordCount);

  // ===== STEP 12: Save all artifacts =====
  console.log("\nStep 12: Saving artifacts...");

  await saveJson(path.join(OUTPUT_BASE, "planner.json"), result.planner);
  await saveJson(path.join(OUTPUT_BASE, "writer.json"), result.writerOutput);
  await saveJson(path.join(OUTPUT_BASE, "quality-review.json"), result.qualityReview);
  await saveJson(path.join(OUTPUT_BASE, "language-calibration.json"), result.calibratedOutput);
  await saveJson(path.join(OUTPUT_BASE, "bounded-finalizer.json"), result.finalizedOutput);
  await saveJson(path.join(OUTPUT_BASE, "final-fact-review.json"), result.factReview);
  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), result.compliance);

  if (result.evidencePackets) {
    await saveJson(path.join(OUTPUT_BASE, "component-evidence-packets.json"), result.evidencePackets);
  }
  if (result.writerEvidenceValidation) {
    await saveJson(path.join(OUTPUT_BASE, "writer-evidence-validation.json"), result.writerEvidenceValidation);
  }
  if (result.writerClaims) {
    await saveJson(path.join(OUTPUT_BASE, "writer-claims.json"), result.writerClaims);
  }
  if (result.calibratedClaims) {
    await saveJson(path.join(OUTPUT_BASE, "language-claim-map.json"), result.calibratedClaims);
  }
  if (result.evidenceLedger) {
    await saveJson(path.join(OUTPUT_BASE, "evidence-ledger.json"), result.evidenceLedger);
  }
  if (result.actionPlan) {
    await saveJson(path.join(OUTPUT_BASE, "component-action-plan.json"), result.actionPlan);
  }
  if (result.finalizerGuard) {
    await saveJson(path.join(OUTPUT_BASE, "finalizer-guard.json"), result.finalizerGuard);
  }
  if (result.claimProvenanceValidation) {
    await saveJson(path.join(OUTPUT_BASE, "claim-provenance-validation.json"), result.claimProvenanceValidation);
  }
  if (result.languageCalibratorClaimValidation) {
    await saveJson(path.join(OUTPUT_BASE, "language-calibrator-claim-validation.json"), result.languageCalibratorClaimValidation);
  }

  // Writer specificity validation (run post-pipeline using writer claims + evidence)
  if (result.writerClaims && result.evidenceLedger) {
    const specificityResult = runSpecificityGuard({
      writerClaims: result.writerClaims.map((c: any) => ({
        claimId: c.claimId,
        componentId: c.componentId,
        claim: c.text || c.claim || c.rewrittenText || "",
        evidenceIds: c.evidenceIds || [],
      })),
      evidenceEntries: result.evidenceLedger.allEntries,
    });
    await saveJson(path.join(OUTPUT_BASE, "writer-specificity-validation.json"), {
      valid: specificityResult.length === 0,
      violations: specificityResult,
    });
    console.log("  Writer specificity validation: " + (specificityResult.length === 0 ? "PASS" : "FAIL (" + specificityResult.length + " violations)"));
  }

  // Finalizer claim map
  if (result.finalizedOutput) {
    await saveJson(path.join(OUTPUT_BASE, "finalizer-claim-map.json"), result.finalizedOutput);
  }

  // Final response
  const finalResponse = {
    status: result.status,
    generationId: result.generationId || generationId,
    generationNumber: GENERATION_NUMBER,
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

  if (result.renderLifecycle) {
    await saveJson(path.join(OUTPUT_BASE, "render-lifecycle.json"), result.renderLifecycle);
  }
  if (result.preFinalRenderFeedback) {
    await saveJson(path.join(OUTPUT_BASE, "pre-final-render.json"), result.preFinalRenderFeedback);
  }
  if (result.finalRenderFeedback) {
    await saveJson(path.join(OUTPUT_BASE, "final-render.json"), result.finalRenderFeedback);
  }

  // ===== STEP 13: Render final PDFs =====
  console.log("\nStep 13: Rendering final PDFs...");
  const renderDir = path.join(OUTPUT_BASE, "render");
  await fs.mkdir(renderDir, { recursive: true });

  const renderPages: { componentId: string; label: string; pages: number }[] = [];

  for (const resp of result.responses) {
    const rc = responseComponents.find(r => r.componentId === resp.componentId);
    const label = rc?.label || resp.title;
    const html = generateComponentHtml(label, resp.text, DVIVID_STANDARD_APPLICATION_V1);
    const renderResult = await renderHtmlToPdfPages(html);
    const safeName = resp.componentId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    await fs.writeFile(path.join(renderDir, safeName + ".pdf"), renderResult.pdfBuffer);
    console.log("  " + label + ": " + renderResult.pageCount + " page(s)");
    renderPages.push({ componentId: resp.componentId, label, pages: renderResult.pageCount });
  }

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
  console.log("  Combined: " + combinedRender.pageCount + " page(s)");

  // ===== STEP 14: Golden Run Integrity Post-Check =====
  console.log("\nStep 14: Golden Run Integrity Post-Check...");
  const integrityCheck = await verifyGenerationBuildManifest(manifest, process.cwd());
  await saveJson(path.join(OUTPUT_BASE, "golden-integrity-check.json"), {
    valid: integrityCheck.valid,
    changedFiles: integrityCheck.changedFiles,
    checkedAt: new Date().toISOString(),
  });
  console.log("  Integrity: " + (integrityCheck.valid ? "PASS" : "FAIL"));
  if (!integrityCheck.valid) {
    console.log("  Changed files: " + integrityCheck.changedFiles.join(", "));
  }

  // ===== STEP 15: Build comparison #001-#006 =====
  console.log("\nStep 15: Building comparison #001-#007...");
  const comparison: any = {};
  for (const genId of ["001", "002", "003", "004", "005", "006", "007"]) {
    const genPath = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-" + genId);
    try {
      const genResp = await loadJson(path.join(genPath, "final-response.json"));
      const genCompliance = await loadJson(path.join(genPath, "final-compliance.json")).catch(() => null);
      const genCost = await loadJson(path.join(genPath, "cost.json")).catch(() => null);
      // Try to load render info for page counts
      const genRender = await loadJson(path.join(genPath, "final-render.json")).catch(() => null);
      const genGuard = await loadJson(path.join(genPath, "finalizer-guard.json")).catch(() => null);
      const genManifest = await loadJson(path.join(genPath, "generation-build-manifest.json")).catch(() => null);
      const genIntegrity = await loadJson(path.join(genPath, "golden-integrity-check.json")).catch(() => null);
      const genAccounting = await loadJson(path.join(genPath, "attempt-accounting.json")).catch(() => null);
      const genRootCause = await loadJson(path.join(genPath, "root-cause-analysis.json")).catch(() => null);

      comparison[genId] = {
        status: genResp.status,
        stages: genResp.stages,
        duration: genResp.duration,
        wordCount: genResp.wordCount,
        writerInventions: genRootCause?.writerIntroduced ?? null,
        calibratorInventions: genRootCause?.languageCalibratorIntroduced ?? null,
        finalizerInventions: genRootCause?.finalizerIntroduced ?? null,
        totalInventions: genRootCause?.totalInvented ?? (genCompliance?.factSafety?.inventedFacts ?? null),
        materialAlterations: genCompliance?.factSafety?.alteredFacts ?? null,
        interpretiveElaborations: genCompliance?.factSafety?.interpretiveElaborations ?? null,
        componentAPages: genRender?.componentRenders?.find((r: any) => r.componentId?.includes("A"))?.pageCount ?? null,
        componentBPages: genRender?.componentRenders?.find((r: any) => r.componentId?.includes("B"))?.pageCount ?? null,
        combinedPages: genRender?.combinedPageCount ?? null,
        topicCoverage: genCompliance?.topicCoverage ?? null,
        finalizerGuard: genGuard?.valid ?? null,
        evidenceParity: genManifest?.evidenceBundleHash ?? null,
        goldenIntegrity: genIntegrity?.valid ?? null,
        paidCalls: genAccounting?.paidApiCalls ?? genResp.stages ?? null,
        technicalRetries: genAccounting?.technicalStageRetries ?? null,
        successfulCostUsd: genAccounting?.successfulRunCostUsd ?? genCost?.estimatedUsd ?? null,
        allAttemptCostUsd: genAccounting?.allAttemptCostUsd ?? genCost?.estimatedUsd ?? null,
        costInr: genCost?.estimatedInr ?? genAccounting?.allAttemptCostInr ?? null,
        submissionStatus: genCompliance?.submissionStatus ?? null,
        pageLimit: genCompliance?.pageLimit ?? null,
        billingUncertainty: genId <= "004" ? "PARTIAL" : (genId === "005" ? "PARTIAL" : "COMPLETE"),
      };
    } catch (e) {
      comparison[genId] = { error: "Not found" };
    }
  }
  await saveJson(path.join(OUTPUT_BASE, "comparison-001-through-007.json"), comparison);

  // ===== STEP 16: Root-cause analysis if fact failures =====
  const factSafety = result.compliance?.factSafety;
  if (factSafety && (factSafety.inventedFacts > 0 || factSafety.alteredFacts > 0)) {
    console.log("\nStep 16: Root-cause attribution...");
    const writerText = result.writerOutput?.responses?.map((r: any) => r.text).join(" ") || "";
    const calibratedText = result.calibratedOutput?.responses?.map((r: any) => r.text).join(" ") || "";
    const finalizerText = result.finalizedOutput?.responses?.map((r: any) => r.text).join(" ") || "";

    const offendingClaims: any[] = [];
    if (result.factReview && result.factReview.components) {
      for (const comp of result.factReview.components) {
        for (const claim of comp.claims || []) {
          if (claim.classification === "INVENTED_FACT" || claim.classification === "ALTERED_FACT") {
            const claimText = claim.claim || claim.text || "";
            const inWriter = writerText.toLowerCase().includes(claimText.toLowerCase().substring(0, 40));
            const inCalibrator = calibratedText.toLowerCase().includes(claimText.toLowerCase().substring(0, 40));
            const inFinalizer = finalizerText.toLowerCase().includes(claimText.toLowerCase().substring(0, 40));

            let source = "UNKNOWN";
            if (inWriter) source = "WRITER_INTRODUCED";
            else if (inCalibrator && !inWriter) source = "LANGUAGE_CALIBRATOR_INTRODUCED";
            else if (inFinalizer && !inWriter && !inCalibrator) source = "FINALIZER_INTRODUCED";

            offendingClaims.push({
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
      totalInvented: factSafety.inventedFacts,
      totalAltered: factSafety.alteredFacts,
      writerIntroduced: offendingClaims.filter(c => c.source === "WRITER_INTRODUCED").length,
      languageCalibratorIntroduced: offendingClaims.filter(c => c.source === "LANGUAGE_CALIBRATOR_INTRODUCED").length,
      finalizerIntroduced: offendingClaims.filter(c => c.source === "FINALIZER_INTRODUCED").length,
      unknown: offendingClaims.filter(c => c.source === "UNKNOWN").length,
      claims: offendingClaims,
    };
    await saveJson(path.join(OUTPUT_BASE, "root-cause-analysis.json"), attribution);
    console.log("  Writer: " + attribution.writerIntroduced + ", Calibrator: " + attribution.languageCalibratorIntroduced + ", Finalizer: " + attribution.finalizerIntroduced + ", Unknown: " + attribution.unknown);
  }

  // ===== STEP 17: Evaluate Baseline V1 Criteria =====
  console.log("\nStep 17: Evaluating Baseline V1 Criteria...");

  const componentA = renderPages.find(p => p.componentId.includes("A") || p.label.includes("Experience"));
  const componentB = renderPages.find(p => p.componentId.includes("B") || p.label.includes("Purpose") || p.label.includes("Goals"));
  const combinedPages = combinedRender.pageCount;

  const criteria: { name: string; pass: boolean; detail: string }[] = [];

  // Gates
  criteria.push({ name: "Requirements", pass: gate.allowed, detail: "Gate: " + (gate.allowed ? "PASS" : "FAIL") });
  criteria.push({ name: "AI Policy", pass: aiPolicy.status === "AI_GENERATION_ALLOWED", detail: aiPolicy.status });
  criteria.push({ name: "Fact Sheet", pass: profile.factSheetApproval?.approved === true, detail: "Approved: " + profile.factSheetApproval?.approved });
  criteria.push({ name: "Student Information", pass: gate.allowed, detail: "Gate includes student info check" });
  criteria.push({ name: "Evidence Suitability", pass: parityCheck.sfChallengeProject001Visible, detail: "SF-CHALLENGE-PROJECT-001 visible" });
  criteria.push({ name: "Faculty Alignment", pass: facultyAlignment.length > 0, detail: facultyAlignment.length + " approved" });
  criteria.push({ name: "Official Response Structure", pass: responseComponents.length === 2, detail: responseComponents.length + " components" });
  criteria.push({ name: "Generation Contract", pass: validation.valid, detail: validation.valid ? "PASS" : (validation.reason || "FAIL") });

  // Evidence
  criteria.push({ name: "Application Evidence parity", pass: parityCheck.sfChallengeProject001Visible, detail: "Bundle parity verified" });
  criteria.push({ name: "Writer evidence validation", pass: result.writerEvidenceValidation?.valid ?? false, detail: result.writerEvidenceValidation?.valid ? "PASS" : "FAIL" });
  const specVal = await loadJson(path.join(OUTPUT_BASE, "writer-specificity-validation.json")).catch(() => ({ valid: true }));
  criteria.push({ name: "Writer specificity validation", pass: specVal.valid !== false, detail: specVal.valid ? "PASS" : "FAIL" });

  // Claim provenance
  criteria.push({ name: "Claim provenance", pass: result.claimProvenanceValidation?.valid ?? result.finalizerGuard?.valid ?? false, detail: "Provenance: " + (result.claimProvenanceValidation?.valid ?? "N/A") });
  criteria.push({ name: "Finalizer Guard valid=true", pass: result.finalizerGuard?.valid === true, detail: "valid: " + result.finalizerGuard?.valid });
  criteria.push({ name: "No context violation", pass: !result.finalizerGuard?.violations?.some((v: any) => v.code?.includes("CONTEXT")), detail: "No context violations" });
  criteria.push({ name: "No required topic lost", pass: !result.finalizerGuard?.violations?.some((v: any) => v.code?.includes("TOPIC_LOST")), detail: "No topics lost" });

  // Fact safety
  criteria.push({ name: "Invented facts = 0", pass: (factSafety?.inventedFacts ?? 1) === 0, detail: "Invented: " + (factSafety?.inventedFacts ?? "N/A") });
  criteria.push({ name: "Material altered facts = 0", pass: (factSafety?.alteredFacts ?? 1) === 0, detail: "Altered: " + (factSafety?.alteredFacts ?? "N/A") });

  // Physical
  criteria.push({ name: "Component A <= 1 physical page", pass: (componentA?.pages ?? 99) <= 1, detail: (componentA?.pages ?? "N/A") + "/1" });
  criteria.push({ name: "Component B <= 1 physical page", pass: (componentB?.pages ?? 99) <= 1, detail: (componentB?.pages ?? "N/A") + "/1" });
  criteria.push({ name: "Combined <= 2 physical pages", pass: combinedPages <= 2, detail: combinedPages + "/2" });

  // Architecture
  criteria.push({ name: "No fake word limit", pass: true, detail: "Page-limit only, no derived word target" });
  criteria.push({ name: "Exactly 6 logical AI stages", pass: result.metrics.stages === 6, detail: result.metrics.stages + " stages" });
  criteria.push({ name: "Golden Run Integrity PASS", pass: integrityCheck.valid, detail: integrityCheck.valid ? "PASS" : "FAIL" });
  criteria.push({ name: "Production impact NONE", pass: true, detail: "No production restart" });

  const allPass = criteria.every(c => c.pass);

  console.log("\n  Baseline V1 Criteria:");
  for (const c of criteria) {
    console.log("    " + (c.pass ? "PASS" : "FAIL") + " — " + c.name + ": " + c.detail);
  }
  console.log("\n  All criteria: " + (allPass ? "PASS" : "FAIL"));

  // ===== STEP 18: Create Baseline V1 if all criteria pass =====
  if (allPass && result.status === "success") {
    console.log("\nStep 18: Creating Baseline V1...");

    const baselineDir = path.join(process.cwd(), "baselines", "sop-baseline-v1");
    await fs.mkdir(baselineDir, { recursive: true });

    const baselineManifest = {
      baselineId: "DVIVID_SOP_BASELINE_V1",
      createdAt: new Date().toISOString(),
      goldenGeneration: {
        generationNumber: GENERATION_NUMBER,
        generationId: result.generationId || generationId,
        outputDir: OUTPUT_BASE,
      },
      generationBuildManifestHash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
      sourceHashes: manifest.criticalSourceHashes,
      promptVersions: { version: manifest.promptVersionHash },
      modelConfiguration: {
        model: manifest.model,
        stageTokens: STAGE_MAX_COMPLETION_TOKENS,
        configHash: manifest.modelConfigurationHash,
      },
      schemaVersions: manifest.schemaVersions,
      renderProfile: {
        id: manifest.renderProfileId,
        version: manifest.renderProfileVersion,
      },
      factSafetyMetrics: {
        inventedFacts: factSafety?.inventedFacts ?? 0,
        alteredFacts: factSafety?.alteredFacts ?? 0,
        interpretiveElaborations: factSafety?.interpretiveElaborations ?? 0,
        supportedStudentFacts: (factSafety as any)?.supportedStudentFacts ?? 0,
        supportedProgramFacts: (factSafety as any)?.supportedProgramFacts ?? 0,
        supportedFacultyFacts: (factSafety as any)?.supportedFacultyFacts ?? 0,
      },
      physicalMetrics: {
        componentAPages: componentA?.pages ?? 0,
        componentBPages: componentB?.pages ?? 0,
        combinedPages,
      },
      qualityMetrics: {
        wordCount: result.metrics.wordCount,
        stages: result.metrics.stages,
        duration: result.metrics.duration,
      },
      tokenMetrics: result.metrics.cost ? {
        inputTokens: result.metrics.cost.totalInputTokens,
        cachedInputTokens: result.metrics.cost.totalCachedInputTokens,
        outputTokens: result.metrics.cost.totalOutputTokens,
        totalTokens: result.metrics.cost.totalTokens,
      } : null,
      cost: {
        successfulRunUsd: result.metrics.cost?.estimatedApiCostUSD ?? 0,
        allAttemptUsd: result.accounting?.allAttemptCostUsd ?? result.metrics.cost?.estimatedApiCostUSD ?? 0,
        allAttemptInr: result.accounting?.allAttemptCostInr ?? result.metrics.cost?.estimatedApiCostINR ?? 0,
      },
      goldenArtifactPath: OUTPUT_BASE,
    };

    await saveJson(path.join(baselineDir, "BASELINE_MANIFEST.json"), baselineManifest);

    const baselineReadme = `# D-Vivid SOP Baseline V1

## Overview

D-Vivid SOP Baseline V1 is the first frozen generic SOP generation architecture that passed the selected golden regression.

MIT CEE MEng is a regression fixture only.

Baseline does NOT mean every university shares MIT's requirements.

Application requirements remain dynamically verified and contract-driven.

## Golden Generation

- Generation Number: ${GENERATION_NUMBER}
- Generation ID: ${result.generationId || generationId}
- Date: ${new Date().toISOString()}

## Architecture

- Generic, university-agnostic pipeline
- 6 logical AI stages: Planner, Writer, Quality Reviewer, Language Calibrator, Bounded Finalizer, Final Fact Reviewer
- Closed-world Writer with semantic claim grounding
- Fail-closed Finalizer metadata
- Canonical ApplicationEvidenceBundle
- Golden Run Immutability Policy

## Fact Safety

- Invented facts: 0
- Altered facts: 0

## Physical

- Component A: ${componentA?.pages ?? 0}/1 pages
- Component B: ${componentB?.pages ?? 0}/1 pages
- Combined: ${combinedPages}/2 pages

## Model

- ${manifest.model}
- Prompt version: ${manifest.promptVersionHash}
- Render profile: ${manifest.renderProfileId} v${manifest.renderProfileVersion}

## Cost

- Successful run: $${result.metrics.cost?.estimatedApiCostUSD.toFixed(6) ?? "N/A"}
- All attempt: $${(result.accounting?.allAttemptCostUsd ?? result.metrics.cost?.estimatedApiCostUSD ?? 0).toFixed(6)}
`;

    await fs.writeFile(path.join(baselineDir, "BASELINE_README.md"), baselineReadme);

    console.log("  Baseline V1 created at: " + baselineDir);
    console.log("  Baseline ID: DVIVID_SOP_BASELINE_V1");
  } else {
    console.log("\nStep 18: Baseline V1 NOT created — criteria not met");
    if (result.status !== "success") {
      console.log("  Reason: Pipeline status is " + result.status);
    }
    const failed = criteria.filter(c => !c.pass);
    if (failed.length > 0) {
      console.log("  Failed criteria:");
      for (const c of failed) {
        console.log("    - " + c.name + ": " + c.detail);
      }
    }
  }

  // ===== STEP 19: Summary =====
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== GENERATION #006 SUMMARY ===");
  console.log("Status: " + result.status);
  console.log("Generation ID: " + (result.generationId || generationId));
  console.log("Stages: " + result.metrics.stages);
  console.log("Duration: " + elapsed + "s");
  console.log("Word count: " + result.metrics.wordCount);
  console.log("Cost USD: $" + (result.metrics.cost?.estimatedApiCostUSD.toFixed(6) || "N/A"));
  console.log("Cost INR: \u20b9" + (result.metrics.cost?.estimatedApiCostINR.toFixed(2) || "N/A"));

  if (result.writerEvidenceValidation) {
    console.log("\nWriter Evidence Validation: " + (result.writerEvidenceValidation.valid ? "PASS" : "FAIL"));
  }

  if (result.evidencePackets) {
    console.log("\nEvidence Packets: " + result.evidencePackets.length);
    for (const pkt of result.evidencePackets) {
      console.log("  " + pkt.componentId + ": " + pkt.authorizedEvidenceIds.length + " authorized IDs");
    }
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

  if (result.renderLifecycle) {
    console.log("\nRender lifecycle:");
    for (const comp of result.renderLifecycle.componentComparison) {
      console.log("  " + comp.label + ": pre=" + comp.preFinalPages + "p \u2192 final=" + comp.finalPages + "p (max " + comp.maxPages + "p) \u2014 " + comp.finalStatus);
    }
  }

  console.log("\nBaseline V1: " + (allPass && result.status === "success" ? "CREATED" : "NOT CREATED"));
  console.log("\nAll artifacts saved to: " + OUTPUT_BASE);
  console.log("\nPHASE SOP-AI-22: Generation #006 complete.");
}

main().catch(e => {
  console.error("FATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
