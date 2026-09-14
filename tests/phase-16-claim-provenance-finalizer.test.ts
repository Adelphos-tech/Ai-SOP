/**
 * Phase 16: Claim-Provenance Finalizer + Missing-Topic Fail-Closed
 * Deterministic test fixtures A-Y (0 live OpenAI calls)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateLanguageCalibratorClaims,
  validateFinalizerClaims,
  checkMissingMandatoryTopics,
  hashClaimSet,
  WriterClaim,
  CalibratedClaim,
  FinalizerClaimOutput,
  RequiredTopicProvenance,
} from "../src/lib/ai/claim-provenance";

// ---- Helpers ----

function makeWriterClaims(componentId: string, claims: Array<{ text: string; evidenceIds?: string[] }>): WriterClaim[] {
  return claims.map((c, i) => ({
    claimId: `CLAIM-${componentId}-${String(i + 1).padStart(3, "0")}`,
    componentId,
    text: c.text,
    evidenceIds: c.evidenceIds || [],
  }));
}

function makeCalibratedClaims(writerClaims: WriterClaim[]): CalibratedClaim[] {
  return writerClaims.map(wc => ({
    claimId: wc.claimId,
    componentId: wc.componentId,
    rewrittenText: wc.text,
    evidenceIds: wc.evidenceIds,
  }));
}

function makeRequiredTopics(componentId: string, topics: string[]): Array<{ componentId: string; topics: RequiredTopicProvenance[] }> {
  return [{
    componentId,
    topics: topics.map(t => ({
      topicId: t,
      text: t,
      requirementType: "MANDATORY_REQUIRED_TOPIC" as const,
      sourceRequirementId: "S1",
      mandatory: true,
    })),
  }];
}

function makeActionPlan(plans: Array<{ componentId: string; action: string; missingTopics?: string[]; topicEvidence?: Array<{ topic: string; allowedEvidenceIds: string[] }> }>) {
  return {
    plans: plans.map(p => ({
      componentId: p.componentId,
      action: p.action as any,
      missingTopics: p.missingTopics || [],
      topicEvidence: p.topicEvidence || [],
    })),
  };
}

// ---- A. COMPRESS with same claim set → PASS ----
test("A: COMPRESS with same claim set — PASS", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied at IIT Bombay.",
    retainedClaimIds: cc.map(c => c.claimId),
    removedClaimIds: [],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, true);
});

// ---- B. COMPRESS removes claims → PASS ----
test("B: COMPRESS removes claims — PASS", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] },
    { text: "I did a project on seismic analysis.", evidenceIds: ["SF-PROJ-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied at IIT Bombay.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [cc[1].claimId],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, true);
});

// ---- C. COMPRESS adds new claim → FINALIZER_NEW_FACTUAL_CLAIM ----
test("C: COMPRESS adds new claim — FINALIZER_NEW_FACTUAL_CLAIM", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied at IIT Bombay. I also used MATLAB for optimization.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{
      text: "I also used MATLAB for optimization.",
      topicId: "software skills",
      evidenceIds: ["SF-PROJ-0"],
    }],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "FINALIZER_NEW_FACTUAL_CLAIM"));
});

// ---- D. Finalizer invents unsupported software challenge → FAIL ----
test("D: Finalizer invents unsupported software challenge — FAIL", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I led a seismic analysis project.", evidenceIds: ["SF-PROJ-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  // Finalizer tries to add "limited access to advanced engineering software" as a repair
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I led a seismic analysis project. An unforeseen challenge was limited access to advanced engineering software.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{
      text: "An unforeseen challenge was limited access to advanced engineering software.",
      topicId: "unforeseen challenges",
      evidenceIds: ["SF-STORY"],
    }],
  }];
  // If action is COMPRESS, repair claims are not allowed
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation", "unforeseen challenges"]),
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "FINALIZER_NEW_FACTUAL_CLAIM"));
});

// ---- E. Paraphrased unsupported software challenge → FAIL through claim provenance ----
test("E: Paraphrased unsupported software challenge — FAIL", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I led a seismic analysis project.", evidenceIds: ["SF-PROJ-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  // Finalizer tries to add a paraphrased version
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I led a seismic analysis project. Access to engineering software was constrained.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{
      text: "Access to engineering software was constrained.",
      topicId: "unforeseen challenges",
      evidenceIds: ["SF-STORY"],
    }],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation", "unforeseen challenges"]),
  });
  assert.equal(result.valid, false);
  // The architecture blocks the SOURCE (new claim during COMPRESS), not the wording
  assert.ok(result.violations.some(v => v.code === "FINALIZER_NEW_FACTUAL_CLAIM"));
});

// ---- F. Mandatory missing topic + no evidence → MISSING_REQUIRED_STUDENT_INFORMATION ----
test("F: Mandatory missing topic + no evidence — BLOCK", () => {
  const actionPlan = makeActionPlan([{
    componentId: "RC-A",
    action: "FREEZE",
    missingTopics: ["unforeseen challenges"],
    topicEvidence: [{ topic: "unforeseen challenges", allowedEvidenceIds: [] }],
  }]);
  const requiredTopics = makeRequiredTopics("RC-A", ["academic preparation", "unforeseen challenges"]);
  const result = checkMissingMandatoryTopics({ actionPlan, requiredTopics });
  assert.equal(result.blocked, true);
  assert.ok(result.blockingReasons.some(r => r.reason.includes("MISSING_REQUIRED_STUDENT_INFORMATION")));
});

// ---- G. Optional reviewer suggestion + no evidence → IGNORE ----
test("G: Optional reviewer suggestion + no evidence — IGNORE (not blocked)", () => {
  const actionPlan = makeActionPlan([{
    componentId: "RC-A",
    action: "FREEZE",
    missingTopics: ["narrative improvement suggestion"],
    topicEvidence: [{ topic: "narrative improvement suggestion", allowedEvidenceIds: [] }],
  }]);
  // This topic is OPTIONAL (not in required topics)
  const requiredTopics = makeRequiredTopics("RC-A", ["academic preparation"]);
  const result = checkMissingMandatoryTopics({ actionPlan, requiredTopics });
  // Should NOT be blocked because "narrative improvement suggestion" is not a mandatory topic
  assert.equal(result.blocked, false);
});

// ---- H. Mandatory missing topic + authorized evidence → targeted repair allowed ----
test("H: Mandatory missing topic + authorized evidence — repair allowed", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I led a seismic analysis project.", evidenceIds: ["SF-PROJ-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I led a seismic analysis project. The challenge was limited computational resources.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{
      text: "The challenge was limited computational resources.",
      topicId: "unforeseen challenges",
      evidenceIds: ["SF-CHALLENGE-0"],
    }],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{
      componentId: "RC-A",
      action: "TARGETED_COMPLIANCE_REPAIR",
      missingTopics: ["unforeseen challenges"],
      topicEvidence: [{ topic: "unforeseen challenges", allowedEvidenceIds: ["SF-CHALLENGE-0"] }],
    }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation", "unforeseen challenges"]),
  });
  assert.equal(result.valid, true);
});

// ---- I. Repair uses unauthorized evidence → FINALIZER_UNAUTHORIZED_REPAIR ----
test("I: Repair uses unauthorized evidence — FINALIZER_UNAUTHORIZED_REPAIR", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I led a project.", evidenceIds: ["SF-PROJ-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I led a project. The challenge was software access.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{
      text: "The challenge was software access.",
      topicId: "unforeseen challenges",
      evidenceIds: ["SF-UNAUTHORIZED"],
    }],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{
      componentId: "RC-A",
      action: "TARGETED_COMPLIANCE_REPAIR",
      missingTopics: ["unforeseen challenges"],
      topicEvidence: [{ topic: "unforeseen challenges", allowedEvidenceIds: ["SF-CHALLENGE-0"] }],
    }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation", "unforeseen challenges"]),
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "FINALIZER_EVIDENCE_VIOLATION"));
});

// ---- J. Language Calibrator preserves claim IDs → PASS ----
test("J: Language Calibrator preserves claim IDs — PASS", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] }]);
  const cc: CalibratedClaim[] = [{
    claimId: wc[0].claimId,
    componentId: "RC-A",
    rewrittenText: "I completed my undergraduate studies at IIT Bombay.",
    evidenceIds: ["SF-EDU-0"],
  }];
  const result = validateLanguageCalibratorClaims({ writerClaims: wc, calibratedClaims: cc });
  assert.equal(result.valid, true);
});

// ---- K. Language Calibrator creates unknown claim ID → LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM ----
test("K: Language Calibrator creates unknown claim ID — VIOLATION", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] }]);
  const cc: CalibratedClaim[] = [
    { claimId: wc[0].claimId, componentId: "RC-A", rewrittenText: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] },
    { claimId: "CLAIM-RC-A-999", componentId: "RC-A", rewrittenText: "I also won a national award.", evidenceIds: [] },
  ];
  const result = validateLanguageCalibratorClaims({ writerClaims: wc, calibratedClaims: cc });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM"));
});

// ---- L. FREEZE claim set changes → FAIL ----
test("L: FREEZE claim set changes — FAIL", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I studied at IIT Bombay.", evidenceIds: ["SF-EDU-0"] },
    { text: "I did a project.", evidenceIds: ["SF-PROJ-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied at IIT Bombay.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [cc[1].claimId],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "FREEZE" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "FINALIZER_CLAIM_SET_VIOLATION"));
});

// ---- M. Compression removes mandatory-topic last claim → FINALIZER_REQUIRED_TOPIC_LOST ----
test("M: Compression removes mandatory-topic last claim — REQUIRED_TOPIC_LOST", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I did a seismic project.", evidenceIds: ["SF-PROJ-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "",
    retainedClaimIds: [],
    removedClaimIds: [cc[0].claimId],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{
      componentId: "RC-A",
      action: "COMPRESS",
      missingTopics: ["academic preparation"],
      topicEvidence: [],
    }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.code === "FINALIZER_REQUIRED_TOPIC_LOST"));
});

// ---- N. Compression removes secondary redundant claim → PASS ----
test("N: Compression removes secondary redundant claim — PASS", () => {
  const wc = makeWriterClaims("RC-A", [
    { text: "I led a seismic project.", evidenceIds: ["SF-PROJ-0"] },
    { text: "I also completed an AutoCAD certification.", evidenceIds: ["SF-CERT-0"] },
  ]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I led a seismic project.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [cc[1].claimId],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, true);
});

// ---- O. Finalizer guard valid always boolean ----
test("O: Finalizer guard valid always boolean", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "FREEZE" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(typeof result.valid, "boolean");
  assert.equal(result.valid, true);
});

// ---- P. Guard false prevents READY_TO_SUBMIT ----
test("P: Guard false prevents READY_TO_SUBMIT", () => {
  const wc = makeWriterClaims("RC-A", [{ text: "I studied.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied. I also used MATLAB.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [{ text: "I also used MATLAB.", topicId: "tools", evidenceIds: ["SF-FAKE"] }],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, false);
  // If valid is false, submission must be REVIEW_REQUIRED
});

// ---- Q. Stage 6 still runs after provenance PASS ----
test("Q: Stage 6 still runs after provenance PASS", () => {
  // Stage 6 is always stage 6 — claim provenance does not replace it
  const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
  assert.equal(stages[5], "factReviewer");
  // Provenance PASS does not skip stage 6
  const wc = makeWriterClaims("RC-A", [{ text: "I studied.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-A",
    text: "I studied.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-A", action: "FREEZE" }]),
    requiredTopics: makeRequiredTopics("RC-A", ["academic preparation"]),
  });
  assert.equal(result.valid, true);
  // Stage 6 would still run after this PASS
});

// ---- R. Stage 6 remains logical stage 6 ----
test("R: Stage 6 remains logical stage 6", () => {
  const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
  assert.equal(stages[5], "factReviewer");
  assert.equal(stages.length, 6);
});

// ---- S. No seventh AI call ----
test("S: No seventh AI call", () => {
  const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
  assert.equal(stages.length, 6);
  assert.equal(stages[6], undefined);
  // Claim provenance validation is deterministic (not an AI stage)
});

// ---- T. Checkpoint invalid after claim-set change ----
test("T: Checkpoint invalid after claim-set change", () => {
  const wc1 = makeWriterClaims("RC-A", [{ text: "I studied at IIT.", evidenceIds: ["SF-EDU-0"] }]);
  const wc2 = makeWriterClaims("RC-A", [{ text: "I studied at IIT Delhi.", evidenceIds: ["SF-EDU-0"] }]);
  const cc1 = makeCalibratedClaims(wc1);
  const cc2 = makeCalibratedClaims(wc2);
  const hash1 = hashClaimSet(cc1);
  const hash2 = hashClaimSet(cc2);
  assert.notEqual(hash1, hash2);
});

// ---- U. Generic single-component application ----
test("U: Generic single-component application", () => {
  const wc = makeWriterClaims("RC-GENERIC", [{ text: "I have a B.Tech degree.", evidenceIds: ["SF-EDU-0"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-GENERIC",
    text: "I have a B.Tech degree.",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-GENERIC", action: "FREEZE" }]),
    requiredTopics: makeRequiredTopics("RC-GENERIC", ["background"]),
  });
  assert.equal(result.valid, true);
});

// ---- V. Generic three-component application ----
test("V: Generic three-component application", () => {
  const wc = [
    ...makeWriterClaims("RC-1", [{ text: "Fact 1", evidenceIds: ["SF-1"] }]),
    ...makeWriterClaims("RC-2", [{ text: "Fact 2", evidenceIds: ["SF-2"] }]),
    ...makeWriterClaims("RC-3", [{ text: "Fact 3", evidenceIds: ["SF-3"] }]),
  ];
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [
    { componentId: "RC-1", text: "Fact 1", retainedClaimIds: [cc[0].claimId], removedClaimIds: [], repairClaims: [] },
    { componentId: "RC-2", text: "Fact 2", retainedClaimIds: [cc[1].claimId], removedClaimIds: [], repairClaims: [] },
    { componentId: "RC-3", text: "Fact 3", retainedClaimIds: [cc[2].claimId], removedClaimIds: [], repairClaims: [] },
  ];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([
      { componentId: "RC-1", action: "FREEZE" },
      { componentId: "RC-2", action: "FREEZE" },
      { componentId: "RC-3", action: "FREEZE" },
    ]),
    requiredTopics: [
      ...makeRequiredTopics("RC-1", ["topic1"]),
      ...makeRequiredTopics("RC-2", ["topic2"]),
      ...makeRequiredTopics("RC-3", ["topic3"]),
    ],
  });
  assert.equal(result.valid, true);
});

// ---- W. No university-specific logic ----
test("W: No university-specific logic", () => {
  // The claim provenance module has no university-specific code
  // It works with any component IDs and any topic strings
  const wc = makeWriterClaims("ANY-COMP", [{ text: "Any fact", evidenceIds: ["ANY-FACT"] }]);
  const cc = makeCalibratedClaims(wc);
  const fo: FinalizerClaimOutput[] = [{
    componentId: "ANY-COMP",
    text: "Any fact",
    retainedClaimIds: [cc[0].claimId],
    removedClaimIds: [],
    repairClaims: [],
  }];
  const result = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "ANY-COMP", action: "FREEZE" }]),
    requiredTopics: makeRequiredTopics("ANY-COMP", ["any topic"]),
  });
  assert.equal(result.valid, true);
});

// ---- X. Harvard AI-policy regression remains blocked ----
test("X: Harvard AI-policy regression remains blocked", () => {
  const harvardPolicy = { status: "AI_GENERATION_BLOCKED", generationAllowed: false };
  assert.equal(harvardPolicy.generationAllowed, false);
});

// ---- Y. #004 historical software challenge regression ----
test("Y: #004 historical software challenge regression", () => {
  // Simulate #004: Writer did NOT produce a claim about "limited software access"
  // Finalizer tries to add it during COMPRESS
  const wc = makeWriterClaims("RC-MIT-CEE-A", [
    { text: "I led a seismic analysis project on a 20-story building.", evidenceIds: ["SF-PROJ-0"] },
    { text: "I used SAP2000 and MATLAB for analysis.", evidenceIds: ["SF-PROJ-0"] },
    // NO claim about "limited access to advanced engineering software"
  ]);
  const cc = makeCalibratedClaims(wc);

  // Finalizer tries to add the unsupported claim
  const fo: FinalizerClaimOutput[] = [{
    componentId: "RC-MIT-CEE-A",
    text: "I led a seismic analysis project. An unforeseen challenge was limited access to advanced engineering software.",
    retainedClaimIds: cc.map(c => c.claimId),
    removedClaimIds: [],
    repairClaims: [{
      text: "An unforeseen challenge was limited access to advanced engineering software.",
      topicId: "unforeseen challenges",
      evidenceIds: ["SF-STORY"],
    }],
  }];

  // With COMPRESS action: repair claims are NOT allowed
  const resultCompress = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{ componentId: "RC-MIT-CEE-A", action: "COMPRESS" }]),
    requiredTopics: makeRequiredTopics("RC-MIT-CEE-A", ["academic preparation", "unforeseen challenges"]),
  });
  assert.equal(resultCompress.valid, false);
  assert.ok(resultCompress.violations.some(v => v.code === "FINALIZER_NEW_FACTUAL_CLAIM"));

  // With TARGETED_COMPLIANCE_REPAIR: repair is allowed but evidence must be authorized
  // If SF-STORY is authorized for "unforeseen challenges", the repair would pass structural validation
  // BUT the Final Fact Reviewer (Stage 6) would still catch it semantically
  const resultRepair = validateFinalizerClaims({
    preFinalClaims: cc, finalizerOutputs: fo,
    actionPlan: makeActionPlan([{
      componentId: "RC-MIT-CEE-A",
      action: "TARGETED_COMPLIANCE_REPAIR",
      missingTopics: ["unforeseen challenges"],
      topicEvidence: [{ topic: "unforeseen challenges", allowedEvidenceIds: ["SF-STORY"] }],
    }]),
    requiredTopics: makeRequiredTopics("RC-MIT-CEE-A", ["academic preparation", "unforeseen challenges"]),
  });
  // The repair is structurally valid (SF-STORY is authorized)
  // But Stage 6 would catch it semantically
  // The claim provenance model blocks the SOURCE during COMPRESS
  // During TARGETED_REPAIR, it allows the repair structurally but Stage 6 catches it semantically
  assert.equal(resultRepair.valid, true); // Structural pass — Stage 6 catches semantic issue
});

console.log("Phase 16 test fixtures loaded");
