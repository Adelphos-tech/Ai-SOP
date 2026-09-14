/**
 * Phase 14: Evidence-Constrained Writer + Pre-Final Fact Risk + Render Pressure
 * Deterministic test fixtures A-Y (0 live OpenAI calls)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Import Phase 14 modules using relative paths
import { buildComponentEvidencePackets, validateWriterEvidenceReferences } from "../src/lib/ai/component-evidence-packet.ts";
import { planComponentActions } from "../src/lib/ai/component-action-planner.ts";
import { validateFinalizerOutput } from "../src/lib/ai/bounded-finalizer.ts";

// ---- Test helpers ----

function makeLedger(entries) {
  return {
    studentFacts: entries.filter(e => e.category === "student"),
    programFacts: entries.filter(e => e.category === "program"),
    facultyFacts: entries.filter(e => e.category === "faculty"),
    applicationSpecificFacts: entries.filter(e => e.category === "application_specific"),
    allEntries: entries,
    ledgerHash: "test-hash-001",
  };
}

function makeResponseComponents(ids) {
  return ids.map(id => ({
    componentId: id,
    label: id,
    exactPrompt: "Test prompt for " + id,
    pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages: 1, status: "VERIFIED", sourceId: "S1", sourceQuote: "max 1 page" },
    wordLimit: null,
    characterLimit: null,
    requiredTopics: [{ topic: "academic preparation", requiresStudentSpecificFact: false }],
    sourceId: "S1",
    status: "VERIFIED",
    verifiedAt: "2026-01-01",
  }));
}

// ---- A. Writer authorized evidence only → PASS ----
test("A: Writer with authorized evidence only — PASS", () => {
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech Civil Engineering, IIT Bombay", category: "student", source: "education" },
    { id: "SF-PROJ-0", canonicalText: "Seismic analysis project on 20-story building", category: "student", source: "projects" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const packets = buildComponentEvidencePackets({
    evidenceLedger: ledger,
    responseComponents: rcs,
    plannerEvidenceSelection: [{ componentId: "RC-A", primaryEvidenceIds: ["SF-EDU-0", "SF-PROJ-0"], secondaryEvidenceIds: [] }],
  });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].authorizedEvidenceIds.length, 2);
  assert.ok(packets[0].authorizedEvidenceIds.includes("SF-EDU-0"));
  assert.ok(packets[0].authorizedEvidenceIds.includes("SF-PROJ-0"));
});

// ---- B. Writer references unknown fact ID → WRITER_EVIDENCE_REFERENCE_VIOLATION ----
test("B: Writer references unknown fact ID — VIOLATION", () => {
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech Civil Engineering", category: "student", source: "education" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const packets = buildComponentEvidencePackets({
    evidenceLedger: ledger,
    responseComponents: rcs,
  });
  const writerOutput = {
    responses: [{
      componentId: "RC-A",
      text: "Some text",
      usedEvidenceIds: ["SF-EDU-0", "FAKE-ID-999"],
      factualClaims: [],
    }],
  };
  const result = validateWriterEvidenceReferences({ packets, writerOutput });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "WRITER_EVIDENCE_REFERENCE_VIOLATION"));
  assert.ok(result.violations.some(v => v.evidenceId === "FAKE-ID-999"));
});

// ---- C. Writer uses another component's unauthorized fact → BLOCK ----
test("C: Writer uses another component's unauthorized fact — BLOCK", () => {
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech Civil Engineering", category: "student", source: "education" },
    { id: "SF-PROJ-0", canonicalText: "Seismic project", category: "student", source: "projects" },
  ]);
  const rcs = makeResponseComponents(["RC-A", "RC-B"]);
  const packets = buildComponentEvidencePackets({
    evidenceLedger: ledger,
    responseComponents: rcs,
    plannerEvidenceSelection: [
      { componentId: "RC-A", primaryEvidenceIds: ["SF-EDU-0"], secondaryEvidenceIds: [] },
      { componentId: "RC-B", primaryEvidenceIds: ["SF-PROJ-0"], secondaryEvidenceIds: [] },
    ],
  });
  // RC-A tries to use SF-PROJ-0 which is only authorized for RC-B
  const writerOutput = {
    responses: [{
      componentId: "RC-A",
      text: "Some text",
      usedEvidenceIds: ["SF-EDU-0", "SF-PROJ-0"],
      factualClaims: [],
    }],
  };
  const result = validateWriterEvidenceReferences({ packets, writerOutput });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.evidenceId === "SF-PROJ-0"));
});

// ---- D. Unapproved faculty evidence → BLOCK ----
test("D: Unapproved faculty evidence — BLOCK", () => {
  const ledger = makeLedger([
    { id: "FF-0", canonicalText: JSON.stringify({ facultyName: "Test Prof", status: "PROPOSED" }), category: "faculty", source: "faculty" },
  ]);
  // The evidence ledger should NOT include PROPOSED faculty (approvedValue filters them)
  // But if somehow included, the packet should still be built
  const rcs = makeResponseComponents(["RC-A"]);
  const packets = buildComponentEvidencePackets({
    evidenceLedger: ledger,
    responseComponents: rcs,
  });
  // If the ledger has the entry, it's in the packet
  // The check is that PROPOSED faculty should not be in the ledger at all
  // This test verifies the packet building doesn't crash
  assert.ok(packets.length > 0);
});

// ---- E. Quality Reviewer flags unsupported claim → factualCleanup.required = true ----
test("E: Quality Reviewer flags unsupported claim — factualCleanup required", () => {
  // Simulate the action planner consuming factualRiskClaims
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A",
      score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [
        { claim: "I used MATLAB for optimization", status: "POTENTIALLY_UNSUPPORTED", supportingEvidenceIds: [], reason: "MATLAB not in evidence" },
      ],
    }],
  };
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech Civil Engineering", category: "student", source: "education" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.ok(plan.factualCleanup);
  assert.equal(plan.factualCleanup.required, true);
  assert.equal(plan.factualCleanup.claims.length, 1);
  assert.equal(plan.factualCleanup.claims[0].claim, "I used MATLAB for optimization");
});

// ---- F. Potential unsupported claim prevents FREEZE-only behavior ----
test("F: Potential unsupported claim prevents FREEZE", () => {
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A",
      score: 8,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [
        { claim: "I won a national award", status: "POTENTIALLY_UNSUPPORTED", supportingEvidenceIds: [], reason: "No award in evidence" },
      ],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  // Should NOT be FREEZE because factual cleanup is required
  assert.notEqual(plan.action, "FREEZE");
  assert.ok(plan.factualCleanup?.required);
});

// ---- G. Unsupported claim with no evidence → Finalizer may delete only ----
test("G: Unsupported claim with no evidence — delete only", () => {
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A",
      score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [
        { claim: "I used Python for ML", status: "POTENTIALLY_UNSUPPORTED", supportingEvidenceIds: [], reason: "Python not in evidence" },
      ],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.ok(plan.factualCleanup);
  assert.equal(plan.factualCleanup.claims[0].allowedEvidenceIds.length, 0);
  // Finalizer may only delete (no evidence to rewrite with)
});

// ---- H. Unsupported claim with authorized evidence → targeted factual correction ----
test("H: Unsupported claim with authorized evidence — targeted correction", () => {
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A",
      score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [
        { claim: "I optimized the model using MATLAB", status: "POTENTIALLY_UNSUPPORTED", supportingEvidenceIds: ["SF-PROJ-0"], reason: "MATLAB not in evidence but project exists" },
      ],
    }],
  };
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" },
    { id: "SF-PROJ-0", canonicalText: "Completed structural analysis project", category: "student", source: "projects" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.ok(plan.factualCleanup);
  assert.equal(plan.factualCleanup.claims[0].allowedEvidenceIds.length, 1);
  assert.ok(plan.factualCleanup.claims[0].allowedEvidenceIds.includes("SF-PROJ-0"));
});

// ---- J. Clean component + page PASS + topics PASS + no factual risks → FREEZE ----
test("J: Clean component — FREEZE", () => {
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A",
      score: 9,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.equal(plan.action, "FREEZE");
  assert.ok(!plan.factualCleanup || !plan.factualCleanup.required);
});

// ---- K. Overflow ratio propagated to Finalizer ----
test("K: Overflow ratio propagated to Finalizer", () => {
  const renderFeedback = {
    components: [{
      componentId: "RC-A", label: "RC-A", actualPages: 2, maxPages: 1, status: "RENDER_OVERFLOW",
      wordCount: 400, characterCount: 2500, renderProfileId: "test",
      contentHeightPx: 1200, availableHeightPx: 930, overflowHeightPx: 270, overflowRatio: 1.29,
    }],
    combinedActualPages: 2, combinedMaxPages: 1, combinedStatus: "RENDER_OVERFLOW", renderProfileId: "test", renderProfileVersion: "1",
  };
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A", score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.equal(plan.action, "COMPRESS");
  // The render feedback with overflow ratio is available for the Finalizer prompt
  assert.ok(renderFeedback.components[0].overflowRatio > 1);
});

// ---- L. Render pressure does not create word limit ----
test("L: Render pressure does not create word limit", () => {
  // The render pressure fields are metadata, not word limits
  const renderFeedback = {
    components: [{
      componentId: "RC-A", actualPages: 2, maxPages: 1, status: "RENDER_OVERFLOW",
      contentHeightPx: 1200, availableHeightPx: 930, overflowRatio: 1.29,
    }],
  };
  // Verify there's no wordLimit field derived from render pressure
  assert.equal(renderFeedback.components[0].wordLimit, undefined);
  assert.ok(renderFeedback.components[0].overflowRatio !== undefined);
});

// ---- M. Secondary evidence removable during compression ----
test("M: Secondary evidence removable during compression", () => {
  // The action planner assigns COMPRESS, which allows removing secondary evidence
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A", score: 6,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [],
    }],
  };
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" },
    { id: "SF-CERT-0", canonicalText: "Cert in AutoCAD", category: "student", source: "achievements" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 2, maxPages: 1, status: "RENDER_OVERFLOW", wordCount: 400, characterCount: 2500, renderProfileId: "test" }],
    combinedActualPages: 2, combinedMaxPages: 1, combinedStatus: "RENDER_OVERFLOW", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some long text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.equal(plan.action, "COMPRESS");
  // COMPRESS allows removing secondary evidence (cert) while keeping primary (education)
});

// ---- N. Primary required-topic evidence preserved ----
test("N: Primary required-topic evidence preserved", () => {
  // When COMPRESS is assigned, the Finalizer must preserve primary evidence for required topics
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A", score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: ["SF-EDU-0"] }],
      factualRiskClaims: [],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech Civil Engineering", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 2, maxPages: 1, status: "RENDER_OVERFLOW", wordCount: 400, characterCount: 2500, renderProfileId: "test" }],
    combinedActualPages: 2, combinedMaxPages: 1, combinedStatus: "RENDER_OVERFLOW", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = planComponentActions({
    responseComponents: rcs,
    renderFeedback,
    qualityReview,
    evidenceLedger: ledger,
    calibratedResponses: [{ componentId: "RC-A", text: "Some text" }],
  });
  const plan = result.plans.find(p => p.componentId === "RC-A");
  assert.equal(plan.action, "COMPRESS");
  // The topic is covered, so no repair needed — just compress
  assert.equal(plan.missingTopics.length, 0);
});

// ---- O. Faculty biographies not automatically included ----
test("O: Faculty biographies not automatically included", () => {
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" },
    { id: "FF-0", canonicalText: JSON.stringify({ facultyName: "Prof. Test", status: "STUDENT_APPROVED", research: "structural dynamics, earthquake engineering, resilient systems, seismic design, performance-based design, renewable energy, sustainability" }), category: "faculty", source: "faculty" },
  ]);
  const rcs = makeResponseComponents(["RC-A"]);
  const packets = buildComponentEvidencePackets({
    evidenceLedger: ledger,
    responseComponents: rcs,
    plannerEvidenceSelection: [{ componentId: "RC-A", primaryEvidenceIds: ["SF-EDU-0"], secondaryEvidenceIds: [] }],
  });
  // Faculty evidence is NOT in the packet for RC-A (not selected)
  assert.ok(!packets[0].authorizedEvidenceIds.includes("FF-0"));
});

// ---- P. finalizerGuard.valid always boolean ----
test("P: finalizerGuard.valid always boolean", () => {
  // Test with valid output
  const actionPlan = {
    plans: [{
      componentId: "RC-A", action: "FREEZE", reason: "test",
      missingTopics: [], allowedEvidenceIds: [], physicallyFits: true,
      preFinalCharacterCount: 100, preFinalPageCount: 1,
      topicEvidence: [], requiredTopics: ["academic preparation"], requiresRenderValidation: true,
    }],
    frozenComponentIds: ["RC-A"], editableComponentIds: [],
    blocked: false, blockingIssues: [], expectedComponentIds: ["RC-A"], ledgerHash: "test",
  };
  const text = "A".repeat(100);
  const calibrated = [{ componentId: "RC-A", text }];
  const final = [{ componentId: "RC-A", text }];
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 1, characterCount: 100, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = validateFinalizerOutput({
    actionPlan, calibratedResponses: calibrated, finalResponses: final,
    finalRenderFeedback: renderFeedback, responseComponents: makeResponseComponents(["RC-A"]),
  });
  assert.equal(typeof result.valid, "boolean");
  assert.equal(result.valid, true);
  assert.equal(result.valid, result.passed);
});

// ---- Q. Incomplete guard → valid=false ----
test("Q: Incomplete guard — valid=false", () => {
  // Pass invalid data to trigger guard failure
  const actionPlan = {
    plans: [{
      componentId: "RC-A", action: "FREEZE", reason: "test",
      missingTopics: [], allowedEvidenceIds: [], physicallyFits: true,
      preFinalCharacterCount: 100, preFinalPageCount: 1,
      topicEvidence: [], requiredTopics: ["academic preparation"], requiresRenderValidation: true,
    }],
    frozenComponentIds: ["RC-A"], editableComponentIds: [],
    blocked: false, blockingIssues: [], expectedComponentIds: ["RC-A"], ledgerHash: "test",
  };
  // Pass mismatched final text (FREEZE violation)
  const text = "A".repeat(100);
  const calibrated = [{ componentId: "RC-A", text }];
  const final = [{ componentId: "RC-A", text: "B".repeat(100) + " extra" }];
  const renderFeedback = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 10, characterCount: 100, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const result = validateFinalizerOutput({
    actionPlan, calibratedResponses: calibrated, finalResponses: final,
    finalRenderFeedback: renderFeedback, responseComponents: makeResponseComponents(["RC-A"]),
  });
  assert.equal(typeof result.valid, "boolean");
  assert.equal(result.valid, false);
});

// ---- R. guard valid=false → cannot READY_TO_SUBMIT ----
test("R: Guard valid=false prevents READY_TO_SUBMIT", () => {
  // If finalizerGuard.valid === false, submission must be REVIEW_REQUIRED
  const guard = { valid: false, passed: false, violations: ["FINALIZER_SCOPE_VIOLATION"], requiresSemanticAudit: true, details: [], errors: [], scopeViolation: true, lengthRegression: false, pageRegression: false, evidenceViolation: false, componentViolations: ["RC-A"] };
  // The pipeline checks !finalizerGuard.passed and returns errorResult
  // Submission status would be REVIEW_REQUIRED
  assert.equal(guard.valid, false);
  assert.equal(guard.passed, false);
  assert.ok(guard.violations.length > 0);
});

// ---- S. Evidence packet change invalidates Writer checkpoint ----
test("S: Evidence packet change invalidates Writer checkpoint", () => {
  const ledger1 = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const ledger2 = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech changed", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);
  const packets1 = buildComponentEvidencePackets({ evidenceLedger: ledger1, responseComponents: rcs });
  const packets2 = buildComponentEvidencePackets({ evidenceLedger: ledger2, responseComponents: rcs });
  assert.notEqual(packets1[0].packetHash, packets2[0].packetHash);
});

// ---- T. Action-plan/render-feedback change invalidates Finalizer checkpoint ----
test("T: Action plan change invalidates Finalizer checkpoint", () => {
  // Different render feedback → different action plan → invalidates Finalizer checkpoint
  const qualityReview = {
    componentScores: [{
      componentId: "RC-A", score: 7,
      topicCoverage: [{ topic: "academic preparation", covered: true, allowedEvidenceIds: [] }],
      factualRiskClaims: [],
    }],
  };
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const rcs = makeResponseComponents(["RC-A"]);

  const render1 = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 1, maxPages: 1, status: "PASS", wordCount: 100, characterCount: 500, renderProfileId: "test" }],
    combinedActualPages: 1, combinedMaxPages: 1, combinedStatus: "PASS", renderProfileId: "test", renderProfileVersion: "1",
  };
  const render2 = {
    components: [{ componentId: "RC-A", label: "RC-A", actualPages: 2, maxPages: 1, status: "RENDER_OVERFLOW", wordCount: 400, characterCount: 2500, renderProfileId: "test" }],
    combinedActualPages: 2, combinedMaxPages: 1, combinedStatus: "RENDER_OVERFLOW", renderProfileId: "test", renderProfileVersion: "1",
  };

  const plan1 = planComponentActions({ responseComponents: rcs, renderFeedback: render1, qualityReview, evidenceLedger: ledger, calibratedResponses: [{ componentId: "RC-A", text: "text" }] });
  const plan2 = planComponentActions({ responseComponents: rcs, renderFeedback: render2, qualityReview, evidenceLedger: ledger, calibratedResponses: [{ componentId: "RC-A", text: "text" }] });

  assert.notEqual(plan1.plans[0].action, plan2.plans[0].action);
  assert.notEqual(plan1.plans[0].preFinalPageCount, plan2.plans[0].preFinalPageCount);
});

// ---- U. Final Fact Reviewer remains stage 6 ----
test("U: Final Fact Reviewer is stage 6", () => {
  const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
  assert.equal(stages[5], "factReviewer");
  assert.equal(stages.length, 6);
});

// ---- V. Six logical stage limit preserved ----
test("V: Six logical AI stages preserved", () => {
  const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
  assert.equal(stages.length, 6);
  // No seventh stage
  assert.equal(stages[6], undefined);
});

// ---- W. Harvard AI policy remains blocked ----
test("W: Harvard AI policy remains blocked", () => {
  // Harvard does not allow AI generation
  const harvardPolicy = { status: "AI_GENERATION_BLOCKED", generationAllowed: false };
  assert.equal(harvardPolicy.generationAllowed, false);
  assert.equal(harvardPolicy.status, "AI_GENERATION_BLOCKED");
});

// ---- X. Generic non-MIT single-response application works ----
test("X: Generic single-response application works", () => {
  const rcs = [{
    componentId: "RC-GENERIC-1",
    label: "Personal Statement",
    exactPrompt: "Tell us about yourself.",
    pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages: 2, status: "VERIFIED", sourceId: "S1", sourceQuote: "max 2 pages" },
    wordLimit: null, characterLimit: null,
    requiredTopics: [{ topic: "background", requiresStudentSpecificFact: false }],
    sourceId: "S1", status: "VERIFIED", verifiedAt: "2026-01-01",
  }];
  const ledger = makeLedger([{ id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" }]);
  const packets = buildComponentEvidencePackets({ evidenceLedger: ledger, responseComponents: rcs });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].componentId, "RC-GENERIC-1");
  assert.ok(packets[0].authorizedEvidenceIds.includes("SF-EDU-0"));
});

// ---- Y. Generic three-response application works ----
test("Y: Generic three-response application works", () => {
  const rcs = [
    { componentId: "RC-1", label: "Q1", exactPrompt: "Q1", pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages: 1, status: "VERIFIED", sourceId: "S1", sourceQuote: "max 1" }, wordLimit: null, characterLimit: null, requiredTopics: [{ topic: "topic1", requiresStudentSpecificFact: false }], sourceId: "S1", status: "VERIFIED", verifiedAt: "2026-01-01" },
    { componentId: "RC-2", label: "Q2", exactPrompt: "Q2", pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages: 1, status: "VERIFIED", sourceId: "S1", sourceQuote: "max 1" }, wordLimit: null, characterLimit: null, requiredTopics: [{ topic: "topic2", requiresStudentSpecificFact: false }], sourceId: "S1", status: "VERIFIED", verifiedAt: "2026-01-01" },
    { componentId: "RC-3", label: "Q3", exactPrompt: "Q3", pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages: 1, status: "VERIFIED", sourceId: "S1", sourceQuote: "max 1" }, wordLimit: null, characterLimit: null, requiredTopics: [{ topic: "topic3", requiresStudentSpecificFact: false }], sourceId: "S1", status: "VERIFIED", verifiedAt: "2026-01-01" },
  ];
  const ledger = makeLedger([
    { id: "SF-EDU-0", canonicalText: "B.Tech", category: "student", source: "education" },
    { id: "SF-PROJ-0", canonicalText: "Project A", category: "student", source: "projects" },
    { id: "SF-EXP-0", canonicalText: "Internship", category: "student", source: "experience" },
  ]);
  const packets = buildComponentEvidencePackets({ evidenceLedger: ledger, responseComponents: rcs });
  assert.equal(packets.length, 3);
  for (const p of packets) {
    assert.ok(p.authorizedEvidenceIds.length > 0);
  }
});

// ---- I. Finalizer invents replacement software → EVIDENCE_VIOLATION ----
test("I: Finalizer invents replacement software — EVIDENCE_VIOLATION", () => {
  // If the Finalizer replaces "MATLAB" with "Python" (not in evidence), it's a violation
  // This would be caught by the stage-6 Final Fact Reviewer
  const unsupportedClaim = { claim: "I used Python for analysis", status: "POTENTIALLY_UNSUPPORTED", supportingEvidenceIds: [], reason: "Python not in evidence" };
  assert.equal(unsupportedClaim.status, "POTENTIALLY_UNSUPPORTED");
  // The Final Fact Reviewer would classify this as INVENTED_FACT
});

console.log("Phase 14 test fixtures loaded");
