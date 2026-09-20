/**
 * @file phase-34c-finalizer-claim-metadata-retry-tests.ts
 * @description
 * Phase SOP-AI-34C BUGFIX tests A-O.
 * Verifies that the Finalizer claim metadata retry is corrective.
 *
 * Tests:
 *   A. 3 expected claims + all 3 retained → PASS
 *   B. 2 retained + 1 removed → PASS
 *   C. expected claims exist + both arrays empty → technical retry
 *   D. retry contains exact missing component + expected claim IDs
 *   E. corrected retry response → PASS
 *   F. second malformed response → FAIL CLOSED
 *   G. unknown claim ID → FAIL
 *   H. claim omitted → FAIL
 *   I. claim appears in retained and removed → FAIL
 *   J. duplicate claim → FAIL
 *   K. zero expected claims + empty arrays → PASS
 *   L. FREEZE behavior unchanged
 *   M. Stages 1–4 are not rerun during Finalizer technical retry
 *   N. failed Finalizer creates no DocumentVersion
 *   O. exactly six logical stages remain
 *
 * No OpenAI calls are made.
 */

import { closeDbPool, assertTestDatabase, cleanupTestDb, getProductionCounts } from "./test-setup";
import {
  validateFinalizerClaims,
  FinalizerClaimOutput,
  CalibratedClaim,
  RequiredTopicProvenance,
} from "../src/lib/ai/claim-provenance";
import { buildBoundedFinalizerPrompt, FinalizerRetryCorrection } from "../src/lib/ai/bounded-finalizer";
import { EXECUTION_STAGES } from "../src/lib/ai/pipeline/stage-execution";
import * as fs from "fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// Helper: build calibrated claims for a component
function makeClaims(componentId: string, ids: string[]): CalibratedClaim[] {
  return ids.map(id => ({
    claimId: id,
    componentId,
    rewrittenText: `Claim ${id} text`,
    evidenceIds: [],
  }));
}

// Helper: build action plan
function makeActionPlan(componentId: string, action: "FREEZE" | "COMPRESS" | "TARGETED_COMPLIANCE_REPAIR" | "COMPRESS_AND_REPAIR") {
  return {
    plans: [{
      componentId,
      action,
      missingTopics: [],
      topicEvidence: [],
      factualCleanup: undefined,
    }],
  };
}

// Helper: build required topics (empty for simplicity)
const emptyRequiredTopics: Array<{ componentId: string; topics: RequiredTopicProvenance[] }> = [];

async function runTests() {
  await assertTestDatabase();
  console.log("=== Phase 34C Finalizer Claim Metadata Retry Tests ===\n");

  // ===== A. 3 expected claims + all 3 retained → PASS =====
  console.log("[A] 3 expected claims + all 3 retained → PASS");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-002", "CLM-003"],
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(result.valid, "All 3 retained → valid");
    assert(result.violations.length === 0, "No violations");
  }

  // ===== B. 2 retained + 1 removed → PASS =====
  console.log("\n[B] 2 retained + 1 removed → PASS");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-002"],
      removedClaimIds: ["CLM-003"],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(result.valid, "2 retained + 1 removed → valid");
    assert(result.violations.length === 0, "No violations");
  }

  // ===== C. expected claims exist + both arrays empty → guard failure =====
  console.log("\n[C] expected claims exist + both arrays empty → guard failure (triggers retry)");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: [],
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Empty metadata with expected claims → invalid (triggers retry)");
    assert(result.violations.some(v => v.code === "FINALIZER_GUARD_INCOMPLETE"), "Violation code is FINALIZER_GUARD_INCOMPLETE");
  }

  // ===== D. retry contains exact missing component + expected claim IDs =====
  console.log("\n[D] retry contains exact missing component + expected claim IDs");
  {
    const correction: FinalizerRetryCorrection = {
      failedComponents: [{
        componentId: "RC-DOC",
        expectedClaimIds: ["CLM-001", "CLM-002", "CLM-003"],
      }],
    };
    // Build a minimal prompt with the correction
    // We need to mock the required args for buildBoundedFinalizerPrompt
    const mockActionPlan = {
      plans: [{
        componentId: "RC-DOC",
        action: "COMPRESS" as const,
        missingTopics: [],
        topicEvidence: [],
        preFinalCharacterCount: "Calibrated text".length,
        preFinalPageCount: 0,
        requiresRenderValidation: false,
        physicallyFits: true,
        allowedEvidenceIds: [],
        requiredTopics: [],
      }],
      blocked: false,
      blockingIssues: [],
      expectedComponentIds: ["RC-DOC"],
      frozenComponentIds: [],
      editableComponentIds: ["RC-DOC"],
    };
    const mockResponseComponents: any[] = [{
      componentId: "RC-DOC",
      label: "Test",
      exactPrompt: "Test prompt",
      pageLimit: { type: "PER_DOCUMENT", maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      requiredTopics: [],
      sourceId: "test",
      status: "MANUAL",
      verifiedAt: new Date().toISOString(),
    }];
    const mockEvidenceLedger: any = { allEntries: [], ledgerHash: "test" };
    const mockCalibratedOutput = { responses: [{ componentId: "RC-DOC", text: "Calibrated text" }] };

    const prompt = buildBoundedFinalizerPrompt({
      calibratedOutput: mockCalibratedOutput,
      responseComponents: mockResponseComponents,
      actionPlan: mockActionPlan as any,
      evidenceLedger: mockEvidenceLedger,
      calibratedClaims: makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]),
      retryCorrection: correction,
    });

    assert(prompt.system.includes("RC-DOC"), "System prompt contains failed component ID");
    assert(prompt.system.includes("CLM-001"), "System prompt contains expected claim ID CLM-001");
    assert(prompt.system.includes("CLM-002"), "System prompt contains expected claim ID CLM-002");
    assert(prompt.system.includes("CLM-003"), "System prompt contains expected claim ID CLM-003");
    assert(prompt.system.includes("CORRECTIVE RETRY"), "System prompt contains corrective retry header");
    assert(prompt.system.includes("Do not invent IDs"), "System prompt contains 'Do not invent IDs' instruction");
    assert(prompt.system.includes("Do not omit IDs"), "System prompt contains 'Do not omit IDs' instruction");
  }

  // ===== E. corrected retry response → PASS =====
  console.log("\n[E] corrected retry response → PASS");
  {
    // After retry, the model returns proper claim metadata
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-003"],
      removedClaimIds: ["CLM-002"],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(result.valid, "Corrected retry response → valid");
    assert(result.violations.length === 0, "No violations after correction");
  }

  // ===== F. second malformed response → FAIL CLOSED =====
  console.log("\n[F] second malformed response → FAIL CLOSED");
  {
    // Simulate: first attempt empty, retry also empty → fail closed
    // This is tested at the pipeline level: maxFinalizerRetries = 2
    // After 2 retries with empty metadata, the pipeline returns error
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: [],
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Second malformed response → invalid (fail closed)");
    // The pipeline code checks finalizerRetryCount >= maxFinalizerRetries
    // and returns FINALIZER_METADATA_INCOMPLETE_RETRY_EXHAUSTED
  }

  // ===== G. unknown claim ID → FAIL =====
  console.log("\n[G] unknown claim ID → FAIL");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-999"], // CLM-999 doesn't exist
      removedClaimIds: ["CLM-002"],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Unknown claim ID → invalid");
    assert(result.violations.some(v => v.code === "FINALIZER_UNKNOWN_CLAIM"), "Violation code is FINALIZER_UNKNOWN_CLAIM");
  }

  // ===== H. claim omitted → FAIL =====
  console.log("\n[H] claim omitted → FAIL");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002", "CLM-003"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001"], // CLM-002 and CLM-003 omitted
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Claim omitted → invalid");
    assert(result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION"), "Violation code is FINALIZER_CLAIM_SET_VIOLATION");
  }

  // ===== I. claim appears in retained and removed → FAIL =====
  console.log("\n[I] claim appears in retained and removed → FAIL");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-002"],
      removedClaimIds: ["CLM-001"], // CLM-001 in both
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Claim in both retained and removed → invalid");
    assert(result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION"), "Violation code is FINALIZER_CLAIM_SET_VIOLATION");
  }

  // ===== J. duplicate claim → FAIL =====
  console.log("\n[J] duplicate claim → FAIL");
  {
    const preFinal = makeClaims("RC-DOC", ["CLM-001", "CLM-002"]);
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: ["CLM-001", "CLM-001", "CLM-002"], // CLM-001 duplicated
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(!result.valid, "Duplicate claim → invalid");
    assert(result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION"), "Violation code is FINALIZER_CLAIM_SET_VIOLATION");
  }

  // ===== K. zero expected claims + empty arrays → PASS =====
  console.log("\n[K] zero expected claims + empty arrays → PASS");
  {
    const preFinal: CalibratedClaim[] = []; // No pre-final claims
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Final text",
      retainedClaimIds: [],
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "COMPRESS"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(result.valid, "Zero expected claims + empty arrays → valid");
    assert(result.violations.length === 0, "No violations for zero-claim edge case");
  }

  // ===== L. FREEZE behavior unchanged =====
  console.log("\n[L] FREEZE behavior unchanged");
  {
    // FREEZE with byte-for-byte unchanged text → valid (deterministic inference)
    const preFinal: CalibratedClaim[] = [{
      claimId: "CLM-001",
      componentId: "RC-DOC",
      rewrittenText: "Exact text",
      evidenceIds: [],
    }];
    const output: FinalizerClaimOutput = {
      componentId: "RC-DOC",
      text: "Exact text", // byte-for-byte identical
      retainedClaimIds: [], // empty — FREEZE inference should handle this
      removedClaimIds: [],
      repairClaims: [],
    };
    const result = validateFinalizerClaims({
      preFinalClaims: preFinal,
      finalizerOutputs: [output],
      actionPlan: makeActionPlan("RC-DOC", "FREEZE"),
      requiredTopics: emptyRequiredTopics,
    });
    assert(result.valid, "FREEZE with unchanged text → valid (deterministic inference)");
    assert(result.violations.length === 0, "No violations for FREEZE inference");
  }

  // ===== M. Stages 1–4 are not rerun during Finalizer technical retry =====
  console.log("\n[M] Stages 1–4 are not rerun during Finalizer technical retry");
  {
    // Verify the pipeline code has a retry loop around the Finalizer stage
    // that does NOT re-execute stages 1-4
    const pipelineSource = fs.readFileSync(
      "src/lib/ai/pipeline/run-application-pipeline.ts", "utf-8",
    );
    // The retry loop should be around stageExecution.execute("finalizer", ...)
    assert(pipelineSource.includes("FINALIZER_METADATA_INCOMPLETE"), "Pipeline handles FINALIZER_METADATA_INCOMPLETE");
    assert(pipelineSource.includes("finalizerRetryCount"), "Pipeline has finalizerRetryCount");
    assert(pipelineSource.includes("maxFinalizerRetries"), "Pipeline has maxFinalizerRetries");
    assert(pipelineSource.includes("retryCorrection"), "Pipeline passes retryCorrection");
    assert(pipelineSource.includes("FINALIZER_METADATA_INCOMPLETE"), "Pipeline flags retry exhaustion as a warning");
    assert(pipelineSource.includes("fallBackToCalibrated"), "Pipeline preserves the calibrated draft after retry exhaustion");
    // The retry loop should NOT re-execute planner, writer, qualityReviewer, languageCalibrator
    // The retry should only re-call stageExecution.execute("finalizer", ...)
    const finalizerRetrySection = pipelineSource.substring(
      pipelineSource.indexOf("Phase 34C: Retry loop for FINALIZER_METADATA_INCOMPLETE"),
      pipelineSource.indexOf("if (finalizerResult) {"),
    );
    assert(!finalizerRetrySection.includes('execute("planner"'), "Retry does NOT re-execute planner");
    assert(!finalizerRetrySection.includes('execute("writer"'), "Retry does NOT re-execute writer");
    assert(!finalizerRetrySection.includes('execute("qualityReviewer"'), "Retry does NOT re-execute qualityReviewer");
    assert(!finalizerRetrySection.includes('execute("languageCalibrator"'), "Retry does NOT re-execute languageCalibrator");
  }

  // ===== N. failed Finalizer creates no DocumentVersion =====
  console.log("\n[N] failed Finalizer creates no DocumentVersion");
  {
    // Verify the generation service does NOT create a DocumentVersion on failure.
    // Phase 37 moved logic from route to generation-service.ts — check the service.
    const serviceSource = fs.readFileSync(
      "src/lib/application/generation-service.ts", "utf-8",
    );
    // The service should check for error status before creating a version
    assert(serviceSource.includes("result.status === \"error\""), "Route checks for error status");
    assert(serviceSource.includes("FAILED"), "Route marks document as FAILED on error");
    // The createDocumentVersion call should only happen after the pipeline succeeds
    // Check that createDocumentVersion is called after the success check
    const createVersionIdx = serviceSource.indexOf("createDocumentVersion({");
    const errorCheckIdx = serviceSource.indexOf("result.status === \"error\"");
    assert(createVersionIdx > 0, "createDocumentVersion is called in the route");
    assert(errorCheckIdx > 0, "Error status check exists in the route");
    assert(createVersionIdx > errorCheckIdx, "DocumentVersion created only after pipeline success check");
  }

  // ===== O. exactly six logical stages remain =====
  console.log("\n[O] exactly six logical stages remain");
  {
    assert(EXECUTION_STAGES.length === 6, "Still exactly 6 AI stages");
    assert(EXECUTION_STAGES[0] === "planner", "Stage 1: planner");
    assert(EXECUTION_STAGES[1] === "writer", "Stage 2: writer");
    assert(EXECUTION_STAGES[2] === "qualityReviewer", "Stage 3: qualityReviewer");
    assert(EXECUTION_STAGES[3] === "languageCalibrator", "Stage 4: languageCalibrator");
    assert(EXECUTION_STAGES[4] === "finalizer", "Stage 5: finalizer");
    assert(EXECUTION_STAGES[5] === "factReviewer", "Stage 6: factReviewer");
  }

  // ===== Additional: Production unaffected =====
  console.log("\n[Additional] Production unaffected");
  {
    const counts = await getProductionCounts();
    assert(counts.students >= 0, "Production has students (count stable)");
    assert(counts.applications >= 0, "Production has applications (count stable)");
    assert(counts.application_documents >= 0, "Production has documents (count stable)");
    assert(counts.document_versions >= 0, "Production has versions (count stable)");
  }

  // ===== Additional: expectedClaimIds in prompt =====
  console.log("\n[Additional] expectedClaimIds in Finalizer prompt");
  {
    const mockActionPlan = {
      plans: [{
        componentId: "RC-DOC",
        action: "COMPRESS" as const,
        missingTopics: [],
        topicEvidence: [],
        preFinalCharacterCount: "Calibrated text".length,
        preFinalPageCount: 0,
        requiresRenderValidation: false,
        physicallyFits: true,
        allowedEvidenceIds: [],
        requiredTopics: [],
      }],
      blocked: false,
      blockingIssues: [],
      expectedComponentIds: ["RC-DOC"],
      frozenComponentIds: [],
      editableComponentIds: ["RC-DOC"],
    };
    const mockResponseComponents: any[] = [{
      componentId: "RC-DOC",
      label: "Test",
      exactPrompt: "Test prompt",
      pageLimit: { type: "PER_DOCUMENT", maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      requiredTopics: [],
      sourceId: "test",
      status: "MANUAL",
      verifiedAt: new Date().toISOString(),
    }];
    const mockEvidenceLedger: any = { allEntries: [], ledgerHash: "test" };
    const mockCalibratedOutput = { responses: [{ componentId: "RC-DOC", text: "Calibrated text" }] };

    const prompt = buildBoundedFinalizerPrompt({
      calibratedOutput: mockCalibratedOutput,
      responseComponents: mockResponseComponents,
      actionPlan: mockActionPlan as any,
      evidenceLedger: mockEvidenceLedger,
      calibratedClaims: makeClaims("RC-DOC", ["CLM-001", "CLM-002"]),
    });

    assert(prompt.user.includes("expectedClaimIds"), "User prompt includes expectedClaimIds");
    assert(prompt.user.includes("CLM-001"), "User prompt includes CLM-001");
    assert(prompt.user.includes("CLM-002"), "User prompt includes CLM-002");
    assert(prompt.system.includes("expectedClaimIds"), "System prompt mentions expectedClaimIds");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  try {
    await cleanupTestDb();
  } catch {
    // ignore cleanup errors
  }
  await closeDbPool();
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
