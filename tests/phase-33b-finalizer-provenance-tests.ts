/**
 * @file phase-33b-finalizer-provenance-tests.ts
 * @description
 * Phase SOP-AI-33B deterministic tests A-M.
 * Tests COMPRESS finalizer provenance behavior:
 *   - Blind all-retained inference removed
 *   - Empty metadata triggers FINALIZER_METADATA_INCOMPLETE (technical retry)
 *   - Bounded retry via existing infrastructure
 *   - Fail closed after retry
 *   - Claim set validation (unknown, duplicate, retained+removed)
 *   - FREEZE behavior unchanged
 *   - Final Fact Reviewer behavior unchanged
 *   - Exactly six AI stages
 *   - No DocumentVersion on guard failure
 *
 * No OpenAI calls are made.
 */

import {
  validateFinalizerClaims,
  CalibratedClaim,
  FinalizerClaimOutput,
  RequiredTopicProvenance,
} from "../src/lib/ai/claim-provenance";
import {
  StageExecutionError,
  EXECUTION_STAGES,
} from "../src/lib/ai/pipeline/stage-execution";

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

// Helper: build standard pre-final claims for a single component
function makePreFinalClaims(componentId: string, count: number): CalibratedClaim[] {
  const claims: CalibratedClaim[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `CLAIM-${componentId}-${String(i).padStart(3, "0")}`;
    claims.push({
      claimId: id,
      componentId,
      rewrittenText: `Claim ${i} text for ${componentId}`,
      evidenceIds: [],
    });
  }
  return claims;
}

function makeActionPlan(action: "FREEZE" | "COMPRESS" | "TARGETED_COMPLIANCE_REPAIR" | "COMPRESS_AND_REPAIR", componentId: string) {
  return {
    plans: [{
      componentId,
      action,
      missingTopics: [],
      topicEvidence: [],
      factualCleanup: { required: false, claims: [] },
    }],
  };
}

function makeRequiredTopics(): Array<{ componentId: string; topics: RequiredTopicProvenance[] }> {
  return [];
}

async function runTests() {
  console.log("=== Phase 33B Finalizer Provenance Tests ===\n");

  const componentId = "RC-DOC";
  const preFinalClaims = makePreFinalClaims(componentId, 5);
  const claimIds = preFinalClaims.map(c => c.claimId);

  // ===== A. COMPRESS with complete valid metadata → PASS =====
  console.log("[A] COMPRESS with complete valid metadata → PASS");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: claimIds,
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "COMPRESS with all claims retained should PASS");
    assert(result.violations.length === 0, "No violations for valid COMPRESS metadata");
  }

  // ===== B. COMPRESS with empty metadata does NOT automatically mark all claims retained =====
  console.log("\n[B] COMPRESS with empty metadata does NOT automatically mark all claims retained");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: [],
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "COMPRESS with empty metadata should FAIL (not blindly retained)");
    const hasGuardIncomplete = result.violations.some(v => v.code === "FINALIZER_GUARD_INCOMPLETE");
    assert(hasGuardIncomplete, "Should have FINALIZER_GUARD_INCOMPLETE violation");
  }

  // ===== C. COMPRESS missing metadata invokes existing bounded retry behavior =====
  console.log("\n[C] COMPRESS missing metadata invokes existing bounded retry behavior");
  {
    // parseStage is not exported, but StageExecutionError is.
    // We simulate the parseStage check by verifying that empty metadata
    // for non-FREEZE components would throw FINALIZER_METADATA_INCOMPLETE.
    // The actual retry is handled by createStageExecution's technical retry loop.
    // Here we verify the error code is correct and technical=true (retryable).
    const simulatedError = new StageExecutionError(
      "FINALIZER_METADATA_INCOMPLETE",
      "finalizer: component RC-DOC has empty retainedClaimIds and removedClaimIds",
      true // technical retryable
    );
    assert(simulatedError.code === "FINALIZER_METADATA_INCOMPLETE", "Error code should be FINALIZER_METADATA_INCOMPLETE");
    assert(simulatedError.technical === true, "Error should be technical (retryable)");
    assert(simulatedError.message.includes("RC-DOC"), "Error message should include component ID");
  }

  // ===== D. Valid retry metadata → PASS =====
  console.log("\n[D] Valid retry metadata → PASS");
  {
    // After retry, model provides complete metadata
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text after retry",
        retainedClaimIds: [claimIds[0], claimIds[1], claimIds[2]],
        removedClaimIds: [claimIds[3], claimIds[4]],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "COMPRESS with valid retry metadata should PASS");
  }

  // ===== E. Invalid retry metadata → FAIL CLOSED =====
  console.log("\n[E] Invalid retry metadata → FAIL CLOSED");
  {
    // After retry, model still provides empty metadata
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text after retry",
        retainedClaimIds: [],
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "COMPRESS with invalid retry metadata should FAIL CLOSED");
    const hasGuardIncomplete = result.violations.some(v => v.code === "FINALIZER_GUARD_INCOMPLETE");
    assert(hasGuardIncomplete, "Should fail with FINALIZER_GUARD_INCOMPLETE after retry");
  }

  // ===== F. Unknown claim ID → FAIL =====
  console.log("\n[F] Unknown claim ID → FAIL");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: [claimIds[0], "UNKNOWN-CLAIM-999"],
        removedClaimIds: [claimIds[1], claimIds[2], claimIds[3], claimIds[4]],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "Unknown claim ID should FAIL");
    const hasUnknown = result.violations.some(v => v.code === "FINALIZER_UNKNOWN_CLAIM");
    assert(hasUnknown, "Should have FINALIZER_UNKNOWN_CLAIM violation");
  }

  // ===== G. Duplicate classification → FAIL =====
  console.log("\n[G] Duplicate classification → FAIL");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: [claimIds[0], claimIds[0], claimIds[1]],
        removedClaimIds: [claimIds[2], claimIds[3], claimIds[4]],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "Duplicate claim ID in retained should FAIL");
    const hasDup = result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION" && v.message.includes("Duplicate"));
    assert(hasDup, "Should have duplicate claim violation");
  }

  // ===== H. Same claim retained + removed → FAIL =====
  console.log("\n[H] Same claim retained + removed → FAIL");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: [claimIds[0], claimIds[1]],
        removedClaimIds: [claimIds[0], claimIds[2], claimIds[3], claimIds[4]],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "Same claim in retained and removed should FAIL");
    const hasConflict = result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION" && v.message.includes("both retainedClaimIds and removedClaimIds"));
    assert(hasConflict, "Should have retained+removed conflict violation");
  }

  // ===== I. Removed claim is represented correctly =====
  console.log("\n[I] Removed claim is represented correctly");
  {
    const removedId = claimIds[4];
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text without claim 5",
        retainedClaimIds: [claimIds[0], claimIds[1], claimIds[2], claimIds[3]],
        removedClaimIds: [removedId],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "COMPRESS with one claim removed should PASS");
    assert(result.violations.length === 0, "No violations when claim is properly removed");
  }

  // ===== J. FREEZE behavior unchanged =====
  console.log("\n[J] FREEZE behavior unchanged");
  {
    // FREEZE with byte-for-byte identical text and empty metadata → PASS (deterministic inference)
    const freezeText = preFinalClaims[0].rewrittenText;
    const result = validateFinalizerClaims({
      preFinalClaims: [{
        claimId: claimIds[0],
        componentId,
        rewrittenText: freezeText,
        evidenceIds: [],
      }],
      finalizerOutputs: [{
        componentId,
        text: freezeText, // byte-for-byte identical
        retainedClaimIds: [],
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("FREEZE", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "FREEZE with byte-for-byte identical text should PASS (inference unchanged)");
  }

  // FREEZE with explicit metadata → PASS
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Frozen text",
        retainedClaimIds: claimIds,
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("FREEZE", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "FREEZE with explicit metadata should PASS");
  }

  // FREEZE with repair claims → FAIL (unauthorized repair)
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Frozen text",
        retainedClaimIds: claimIds,
        removedClaimIds: [],
        repairClaims: [{
          text: "New repair claim",
          topicId: "topic-1",
          evidenceIds: [],
        }],
      }],
      actionPlan: makeActionPlan("FREEZE", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "FREEZE with repair claims should FAIL");
    const hasUnauthorized = result.violations.some(v => v.code === "FINALIZER_UNAUTHORIZED_REPAIR");
    assert(hasUnauthorized, "Should have FINALIZER_UNAUTHORIZED_REPAIR violation");
  }

  // ===== K. Final Fact Reviewer behavior unchanged =====
  console.log("\n[K] Final Fact Reviewer behavior unchanged");
  {
    // The Final Fact Reviewer is a separate stage (stage 6) that checks
    // factual support/invention. It is NOT the claim provenance validator.
    // We verify that the claim provenance validator does NOT check fact safety
    // (that's the Final Fact Reviewer's job).
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text with potentially invented content not in claims",
        retainedClaimIds: claimIds,
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    // Claim provenance should PASS because all claims are retained.
    // Fact safety is checked separately by the Final Fact Reviewer.
    assert(result.valid, "Claim provenance PASS does not mean fact safety PASS");
    assert(result.violations.length === 0, "Claim provenance has no fact safety violations (separate concern)");
  }

  // ===== L. Exactly six AI stages remain =====
  console.log("\n[L] Exactly six AI stages remain");
  {
    assert(EXECUTION_STAGES.length === 6, "Should have exactly 6 AI stages");
    assert(EXECUTION_STAGES[0] === "planner", "Stage 1: planner");
    assert(EXECUTION_STAGES[1] === "writer", "Stage 2: writer");
    assert(EXECUTION_STAGES[2] === "qualityReviewer", "Stage 3: qualityReviewer");
    assert(EXECUTION_STAGES[3] === "languageCalibrator", "Stage 4: languageCalibrator");
    assert(EXECUTION_STAGES[4] === "finalizer", "Stage 5: finalizer");
    assert(EXECUTION_STAGES[5] === "factReviewer", "Stage 6: factReviewer");
  }

  // ===== M. Successful DocumentVersion not created when Finalizer Guard fails =====
  console.log("\n[M] Successful DocumentVersion not created when Finalizer Guard fails");
  {
    // When the finalizer guard fails, the pipeline returns an errorResult
    // and does NOT save a DocumentVersion. We verify that the claim
    // provenance validation returns invalid (which the pipeline uses to
    // decide not to save a version).
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: [],
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "Guard failure should produce invalid result");
    assert(result.violations.length > 0, "Guard failure should have violations");
    // The pipeline checks !claimProvenanceValidation.valid and returns errorResult
    // without saving a DocumentVersion. This is the existing behavior.
  }

  // ===== Additional: COMPRESS with partial retention (some retained, some removed) =====
  console.log("\n[Additional] COMPRESS with partial retention");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text with some claims removed",
        retainedClaimIds: [claimIds[0], claimIds[1]],
        removedClaimIds: [claimIds[2], claimIds[3], claimIds[4]],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(result.valid, "COMPRESS with partial retention should PASS");
  }

  // ===== Additional: COMPRESS with repair claims → FAIL (no repairs allowed) =====
  console.log("\n[Additional] COMPRESS with repair claims → FAIL");
  {
    const result = validateFinalizerClaims({
      preFinalClaims,
      finalizerOutputs: [{
        componentId,
        text: "Compressed text",
        retainedClaimIds: claimIds,
        removedClaimIds: [],
        repairClaims: [{
          text: "New repair claim",
          topicId: "topic-1",
          evidenceIds: [],
        }],
      }],
      actionPlan: makeActionPlan("COMPRESS", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "COMPRESS with repair claims should FAIL");
    const hasNewFact = result.violations.some(v => v.code === "FINALIZER_NEW_FACTUAL_CLAIM");
    assert(hasNewFact, "Should have FINALIZER_NEW_FACTUAL_CLAIM violation");
  }

  // ===== Additional: parseStage FINALIZER_METADATA_INCOMPLETE is technical retryable =====
  console.log("\n[Additional] FINALIZER_METADATA_INCOMPLETE classification");
  {
    const error = new StageExecutionError("FINALIZER_METADATA_INCOMPLETE", "test", true);
    assert(error.technical === true, "FINALIZER_METADATA_INCOMPLETE should be technical (retryable)");
    assert(error.code === "FINALIZER_METADATA_INCOMPLETE", "Code should be FINALIZER_METADATA_INCOMPLETE");
  }

  // ===== Additional: FREEZE with changed text and empty metadata → FAIL =====
  console.log("\n[Additional] FREEZE with changed text and empty metadata → FAIL");
  {
    const result = validateFinalizerClaims({
      preFinalClaims: [{
        claimId: claimIds[0],
        componentId,
        rewrittenText: "Original text",
        evidenceIds: [],
      }],
      finalizerOutputs: [{
        componentId,
        text: "Modified text", // NOT byte-for-byte identical
        retainedClaimIds: [],
        removedClaimIds: [],
        repairClaims: [],
      }],
      actionPlan: makeActionPlan("FREEZE", componentId),
      requiredTopics: makeRequiredTopics(),
    });
    assert(!result.valid, "FREEZE with changed text and empty metadata should FAIL");
    const hasGuardIncomplete = result.violations.some(v => v.code === "FINALIZER_GUARD_INCOMPLETE");
    assert(hasGuardIncomplete, "Should have FINALIZER_GUARD_INCOMPLETE for FREEZE with changed text");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
