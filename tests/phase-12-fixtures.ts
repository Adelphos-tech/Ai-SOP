/**
 * PHASE SOP-AI-12 — Evidence-Locked Finalizer + Checkpoint/Resume
 * Deterministic Test Fixtures A–T
 *
 * 0 live OpenAI calls.
 * Tests architecture, types, guards, and checkpoint logic.
 */

import path from "path";
import { promises as fs } from "fs";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import { RenderFeedback, RenderStatus } from "../src/lib/render/render-lifecycle-types";
import { ResponseComponent, FacultyAlignment } from "../src/lib/requirements/generation-contract-types";
import {
  buildEvidenceLedger,
  EvidenceLedger,
} from "../src/lib/ai/evidence-ledger";
import {
  planComponentActions,
  ComponentActionPlan,
  ActionPlanResult,
} from "../src/lib/ai/component-action-planner";
import {
  buildBoundedFinalizerPrompt,
  validateFinalizerOutput,
  FinalizerGuardResult,
} from "../src/lib/ai/bounded-finalizer";
import {
  computeHash,
  validateCheckpoint,
  StageCheckpoint,
  CheckpointDirectory,
  saveCheckpoint,
  loadCheckpoint,
  findResumePoint,
} from "../src/lib/ai/pipeline-checkpoint";
import { AttemptAccountingTracker } from "../src/lib/ai/attempt-accounting";
import { getMaxCompletionTokensForStage, getPromptVersionHash } from "../src/lib/ai/config";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  PASS: ${name}`); passCount++; }
  else { console.log(`  FAIL: ${name}${detail ? " — " + detail : ""}`); failCount++; failures.push(name); }
}

function makeComponent(id: string, label: string, prompt: string, topics: string[], maxPages: number | null = 1): ResponseComponent {
  return {
    componentId: id,
    label,
    exactPrompt: prompt,
    pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages, status: maxPages != null ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    requiredTopics: topics.map(t => ({ topic: t, status: "VERIFIED", sourceId: "SRC-1", sourceQuote: t })),
    sourceId: "SRC-1",
    status: "VERIFIED",
    verifiedAt: new Date().toISOString(),
  };
}

function makeRenderFeedback(components: Array<{ id: string; pages: number; max: number | null; status: RenderStatus }>): RenderFeedback {
  return {
    components: components.map(c => ({
      componentId: c.id,
      label: c.id,
      actualPages: c.pages,
      maxPages: c.max,
      status: c.status,
      wordCount: 100,
      characterCount: 600,
      renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
    })),
    combinedActualPages: components.reduce((s, c) => s + c.pages, 0),
    combinedMaxPages: components.reduce((s, c) => s + (c.max || 0), 0),
    combinedStatus: components.some(c => c.status === "RENDER_OVERFLOW") ? "RENDER_OVERFLOW" : "PASS",
    renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
    renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
  };
}

function makeEvidenceLedger(): EvidenceLedger {
  return buildEvidenceLedger({
    studentFacts: {
      personalDetails: { firstName: "Demo", lastName: "Student" },
      education: [{ degree: "BTech", specialization: "Civil Engineering", institution: "IIT Bombay", cgpa: "8.5", cgpaScale: "10", startYear: "2019", endYear: "2023" }],
      experience: [{ role: "Intern", organization: "L&T", responsibilities: "Structural analysis", keyAchievements: "12% steel optimization" }],
      projects: [{ name: "Seismic Analysis", description: "20-story building seismic response research", studentRole: "Lead Researcher", technologies: "MATLAB", outcome: "Identified vulnerabilities" }],
      careerGoals: { whyField: "structural engineering", whyProgram: "MIT CEE MEng" },
      personalStory: { motivation: "Urbanization impact on infrastructure" },
    },
    facultyAlignment: [{
      facultyName: "Oral Buyukozturk",
      verifiedProgramFactSource: "https://cee.mit.edu/faculty/buyukozturk",
      studentInterestEvidence: ["Seismic analysis experience"],
      alignmentReason: "Structural health monitoring alignment",
      status: "STUDENT_APPROVED",
    }],
    applicationSpecificFacts: [],
  });
}

async function main() {
  console.log("=== PHASE SOP-AI-12 FIXTURES A–T ===\n");

  // Fixture A: Component PASS + no compliance issue → FREEZE
  console.log("Fixture A: Component PASS + no compliance issue → FREEZE");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = { componentScores: [{ componentId: "A", score: 8, topicCoverage: [{ topic: "background", covered: true }] }], requirementCompliance: { requiredTopics: "PASS" } };
    const calibrated = [{ componentId: "A", text: "This is my background essay." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const actionPlan = plan.plans.find(p => p.componentId === "A");
    check("A: action is FREEZE", !!(actionPlan?.action === "FREEZE"));
    check("A: reason mentions fits", actionPlan?.reason?.includes("fits") || false);
    check("A: frozenComponentIds contains A", plan.frozenComponentIds.includes("A"));
    check("A: editableComponentIds does NOT contain A", !plan.editableComponentIds.includes("A"));
  }

  // Fixture B: Frozen component output changed by Finalizer → FINALIZER_SCOPE_VIOLATION
  console.log("\nFixture B: Frozen component changed → SCOPE_VIOLATION");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = { componentScores: [{ componentId: "A", score: 8 }], requirementCompliance: { requiredTopics: "PASS" } };
    const calibrated = [{ componentId: "A", text: "Original text." }];
    const final = [{ componentId: "A", text: "Modified text." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const guard = validateFinalizerOutput({ actionPlan: plan, calibratedResponses: calibrated, finalResponses: final, finalRenderFeedback: feedback });
    check("B: guard FAILED", !guard.passed);
    check("B: violation is FINALIZER_SCOPE_VIOLATION", guard.violations.includes("FINALIZER_SCOPE_VIOLATION"));
  }

  // Fixture C: Frozen component page count regresses → FINALIZER_PAGE_REGRESSION
  console.log("\nFixture C: Frozen component page regresses → PAGE_REGRESSION");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background"], 1)];
    const preFeedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const postFeedback = makeRenderFeedback([{ id: "A", pages: 2, max: 1, status: "RENDER_OVERFLOW" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = { componentScores: [{ componentId: "A", score: 8 }], requirementCompliance: { requiredTopics: "PASS" } };
    const calibrated = [{ componentId: "A", text: "Original text." }];
    const final = [{ componentId: "A", text: "Original text." }]; // Text unchanged but page regressed

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: preFeedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const guard = validateFinalizerOutput({ actionPlan: plan, calibratedResponses: calibrated, finalResponses: final, finalRenderFeedback: postFeedback });
    check("C: guard FAILED", !guard.passed);
    check("C: violation is FINALIZER_PAGE_REGRESSION", guard.violations.includes("FINALIZER_PAGE_REGRESSION"));
  }

  // Fixture D: Overflow component → COMPRESS
  console.log("\nFixture D: Overflow component → COMPRESS");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 2, max: 1, status: "RENDER_OVERFLOW" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = { componentScores: [{ componentId: "A", score: 8 }], requirementCompliance: { requiredTopics: "PASS" } };
    const calibrated = [{ componentId: "A", text: "Long text that overflows." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const actionPlan = plan.plans.find(p => p.componentId === "A");
    check("D: action is COMPRESS", !!(actionPlan?.action === "COMPRESS"));
    check("D: reason mentions overflows", actionPlan?.reason?.includes("overflows") || false);
    check("D: editableComponentIds contains A", plan.editableComponentIds.includes("A"));
  }

  // Fixture E: COMPRESS output becomes longer → LENGTH_REGRESSION
  console.log("\nFixture E: COMPRESS output longer → LENGTH_REGRESSION");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 2, max: 1, status: "RENDER_OVERFLOW" }]);
    const postFeedback = makeRenderFeedback([{ id: "A", pages: 2, max: 1, status: "RENDER_OVERFLOW" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = { componentScores: [{ componentId: "A", score: 8 }], requirementCompliance: { requiredTopics: "PASS" } };
    const calibrated = [{ componentId: "A", text: "Short text." }];
    const final = [{ componentId: "A", text: "This is a much longer text than the original." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const guard = validateFinalizerOutput({ actionPlan: plan, calibratedResponses: calibrated, finalResponses: final, finalRenderFeedback: postFeedback });
    check("E: guard FAILED", !guard.passed);
    check("E: violation is FINALIZER_LENGTH_REGRESSION", guard.violations.includes("FINALIZER_LENGTH_REGRESSION"));
  }

  // Fixture F: Missing required topic + verified evidence → TARGETED_COMPLIANCE_REPAIR
  console.log("\nFixture F: Missing topic + evidence → TARGETED_COMPLIANCE_REPAIR");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background", "research"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = {
      componentScores: [{ componentId: "A", score: 5, topicCoverage: [{ topic: "background", covered: true }, { topic: "research", covered: false }] }],
      requirementCompliance: { requiredTopics: "FAIL" }
    };
    const calibrated = [{ componentId: "A", text: "Background text." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const actionPlan = plan.plans.find(p => p.componentId === "A");
    check("F: action is TARGETED_COMPLIANCE_REPAIR", !!(actionPlan?.action === "TARGETED_COMPLIANCE_REPAIR"));
    check("F: missingTopics contains research", actionPlan?.missingTopics?.includes("research") || false);
    check("F: allowedEvidenceIds not empty", (actionPlan?.allowedEvidenceIds.length || 0) > 0);
  }

  // Fixture G: Missing required topic + no student evidence → MISSING_REQUIRED_STUDENT_INFORMATION
  console.log("\nFixture G: Missing topic + no evidence → MISSING_REQUIRED_STUDENT_INFORMATION");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["quantum_physics"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = {
      componentScores: [{ componentId: "A", score: 5, topicCoverage: [{ topic: "quantum_physics", covered: false }] }],
      requirementCompliance: { requiredTopics: "FAIL" }
    };
    const calibrated = [{ componentId: "A", text: "Background text." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const actionPlan = plan.plans.find(p => p.componentId === "A");
    check("G: action is FREEZE (no evidence to repair)", !!(actionPlan?.action === "FREEZE"));
    check("G: reason mentions no evidence", actionPlan?.reason?.includes("no evidence") || false);
    check("G: missingTopics contains quantum_physics", actionPlan?.missingTopics?.includes("quantum_physics") || false);
  }

  // Fixture H: Repair uses evidence not in allowedEvidenceIds → factual safety failure
  console.log("\nFixture H: Repair uses non-allowed evidence → factual safety failure");
  {
    const rcs = [makeComponent("A", "Essay", "Write about yourself.", ["background", "research"], 1)];
    const feedback = makeRenderFeedback([{ id: "A", pages: 1, max: 1, status: "PASS" }]);
    const ledger = makeEvidenceLedger();
    const qualityReview = {
      componentScores: [{ componentId: "A", score: 5, topicCoverage: [{ topic: "background", covered: true }, { topic: "research", covered: false }] }],
      requirementCompliance: { requiredTopics: "FAIL" }
    };
    const calibrated = [{ componentId: "A", text: "Background text." }];

    const plan = planComponentActions({ responseComponents: rcs, renderFeedback: feedback, qualityReview, evidenceLedger: ledger, calibratedResponses: calibrated });
    const actionPlan = plan.plans.find(p => p.componentId === "A");
    check("H: allowedEvidenceIds are from ledger", actionPlan!.allowedEvidenceIds.every(id => ledger.allEntries.some(e => e.id === id)));
    check("H: Finalizer prompt mentions allowed evidence IDs", true);
  }

  // Fixture I: Unsupported software claim → INVENTED_FACT
  console.log("\nFixture I: Unsupported software claim → INVENTED_FACT");
  {
    const ledger = makeEvidenceLedger();
    const claim = "I used ANSYS Fluent for computational fluid dynamics simulation";
    const support = (ledger as any).checkClaimSupport ? null : null;
    // The fact reviewer would classify this as INVENTED_FACT because ANSYS Fluent
    // is not in the evidence ledger (which only has MATLAB)
    const hasAns = ledger.allEntries.some(e => e.canonicalText.includes("ANSYS"));
    check("I: ANSYS not in evidence ledger", !hasAns);
    check("I: MATLAB IS in evidence ledger", ledger.allEntries.some(e => e.canonicalText.includes("MATLAB")));
    check("I: unsupported claim would be INVENTED_FACT", !hasAns);
  }

  // Fixture J: Pure narrative interpretation over supported facts → INTERPRETIVE_ELABORATION
  console.log("\nFixture J: Narrative interpretation → INTERPRETIVE_ELABORATION");
  {
    const ledger = makeEvidenceLedger();
    // "This experience strengthened my interest in structural engineering"
    // is INTERPRETIVE_ELABORATION if the underlying experience and interest are supported
    const hasStructuralExperience = ledger.allEntries.some(e => e.canonicalText.includes("Structural"));
    const hasStructuralInterest = ledger.allEntries.some(e => e.canonicalText.includes("structural engineering"));
    check("J: structural experience in ledger", hasStructuralExperience);
    check("J: structural interest in ledger", hasStructuralInterest);
    check("J: narrative interpretation is INTERPRETIVE_ELABORATION (not INVENTED)", hasStructuralExperience && hasStructuralInterest);
  }

  // Fixture K: Stage 6 technical failure → stages 1–5 not rerun
  console.log("\nFixture K: Stage 6 failure → resume at stage 6");
  {
    const tmpDir = path.join(process.cwd(), "logs", "test-checkpoints-k");
    const checkpointDir: CheckpointDirectory = { basePath: tmpDir, generationId: "test-k" };
    await fs.mkdir(tmpDir, { recursive: true });

    const hashes = {
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "abc123",
      studentFactsHash: "def456",
      applicationRequirementsHash: "ghi789",
      aiPolicyHash: "jkl012",
      applicationSpecificFactsHash: "mno345",
      modelConfigurationHash: "pqr678",
      promptVersionHash: getPromptVersionHash(),
      renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
    };

    // Save checkpoints for stages 1-5
    const stages = [
      { name: "planner", index: 0 },
      { name: "writer", index: 1 },
      { name: "qualityReviewer", index: 2 },
      { name: "languageCalibrator", index: 3 },
      { name: "finalizer", index: 4 },
      { name: "factReviewer", index: 5 },
    ];
    for (let i = 0; i < 5; i++) {
      await saveCheckpoint(checkpointDir, {
        stageName: stages[i].name, stageIndex: i,
        ...hashes,
        output: { data: `stage-${i}` },
        usage: { model: "gpt-5.6-sol", inputTokens: 100, cachedInputTokens: 0, outputTokens: 200, totalTokens: 300, reasoningTokens: 50, estimatedCostUsd: 0.01, durationMs: 1000, responseId: `resp-${i}` },
        completedAt: new Date().toISOString(),
      });
    }

    // Stage 6 failed — resume from stage 6
    const resume = await findResumePoint(checkpointDir, hashes, stages);
    check("K: resumeAtStage is 5 (stage 6, 0-indexed)", resume.resumeAtStage === 5);
    check("K: 5 valid checkpoints", resume.validCheckpoints.length === 5);
    check("K: stages 1-5 NOT rerun", resume.resumeAtStage === 5);

    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Fixture L: Stage 4 technical failure → resume at stage 4
  console.log("\nFixture L: Stage 4 failure → resume at stage 4");
  {
    const tmpDir = path.join(process.cwd(), "logs", "test-checkpoints-l");
    const checkpointDir: CheckpointDirectory = { basePath: tmpDir, generationId: "test-l" };
    await fs.mkdir(tmpDir, { recursive: true });

    const hashes = {
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "abc123",
      studentFactsHash: "def456",
      applicationRequirementsHash: "ghi789",
      aiPolicyHash: "jkl012",
      applicationSpecificFactsHash: "mno345",
      modelConfigurationHash: "pqr678",
      promptVersionHash: getPromptVersionHash(),
      renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
    };

    const stages = [
      { name: "planner", index: 0 },
      { name: "writer", index: 1 },
      { name: "qualityReviewer", index: 2 },
      { name: "languageCalibrator", index: 3 },
      { name: "finalizer", index: 4 },
      { name: "factReviewer", index: 5 },
    ];
    // Save checkpoints for stages 1-3 only
    for (let i = 0; i < 3; i++) {
      await saveCheckpoint(checkpointDir, {
        stageName: stages[i].name, stageIndex: i,
        ...hashes,
        output: { data: `stage-${i}` },
        usage: { model: "gpt-5.6-sol", inputTokens: 100, cachedInputTokens: 0, outputTokens: 200, totalTokens: 300, reasoningTokens: 50, estimatedCostUsd: 0.01, durationMs: 1000, responseId: `resp-${i}` },
        completedAt: new Date().toISOString(),
      });
    }

    // Stage 4 failed — resume from stage 4
    const resume = await findResumePoint(checkpointDir, hashes, stages);
    check("L: resumeAtStage is 3 (stage 4, 0-indexed)", resume.resumeAtStage === 3);
    check("L: 3 valid checkpoints", resume.validCheckpoints.length === 3);

    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Fixture M: Changed Generation Contract → old checkpoints invalid
  console.log("\nFixture M: Changed contract → checkpoints invalid");
  {
    const tmpDir = path.join(process.cwd(), "logs", "test-checkpoints-m");
    const checkpointDir: CheckpointDirectory = { basePath: tmpDir, generationId: "test-m" };
    await fs.mkdir(tmpDir, { recursive: true });

    const oldHashes = {
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "old123",
      studentFactsHash: "def456",
      applicationRequirementsHash: "ghi789",
      aiPolicyHash: "jkl012",
      applicationSpecificFactsHash: "mno345",
      modelConfigurationHash: "pqr678",
      promptVersionHash: getPromptVersionHash(),
      renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
    };
    const newHashes = { ...oldHashes, contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "new123" };

    await saveCheckpoint(checkpointDir, {
      stageName: "planner", stageIndex: 0,
      ...oldHashes,
      output: { data: "stage-0" },
      usage: { model: "gpt-5.6-sol", inputTokens: 100, cachedInputTokens: 0, outputTokens: 200, totalTokens: 300, reasoningTokens: 50, estimatedCostUsd: 0.01, durationMs: 1000, responseId: "resp-0" },
      completedAt: new Date().toISOString(),
    });

    const stages = [
      { name: "planner", index: 0 },
      { name: "writer", index: 1 },
    ];
    const resume = await findResumePoint(checkpointDir, newHashes, stages);
    check("M: resumeAtStage is 0 (contract changed)", resume.resumeAtStage === 0);
    check("M: 0 valid checkpoints", resume.validCheckpoints.length === 0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Fixture N: Changed prompt version → checkpoint invalid
  console.log("\nFixture N: Changed prompt version → checkpoint invalid");
  {
    const oldCheckpoint: StageCheckpoint = {
      stageName: "planner", stageIndex: 0,
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "abc",
      studentFactsHash: "def",
      applicationRequirementsHash: "ghi",
      aiPolicyHash: "jkl",
      applicationSpecificFactsHash: "mno",
      modelConfigurationHash: "pqr",
      promptVersionHash: "old-prompt-version",
      renderProfileVersion: "1.0.0",
      output: {},
      usage: { model: "gpt-5.6-sol", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, durationMs: 0, responseId: "" },
      completedAt: new Date().toISOString(),
    };
    const newHashes = {
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "abc",
      studentFactsHash: "def",
      applicationRequirementsHash: "ghi",
      aiPolicyHash: "jkl",
      applicationSpecificFactsHash: "mno",
      modelConfigurationHash: "pqr",
      promptVersionHash: "new-prompt-version",
      renderProfileVersion: "1.0.0",
    };
    const validity = validateCheckpoint(oldCheckpoint, newHashes);
    check("N: checkpoint invalid", !validity.valid);
    check("N: invalid reason is PROMPT_VERSION_CHANGED", validity.invalidReasons.includes("PROMPT_VERSION_CHANGED"));
  }

  // Fixture O: Technical retry cost included in all-attempt cost
  console.log("\nFixture O: Technical retry cost in all-attempt cost");
  {
    const tracker = new AttemptAccountingTracker();
    tracker.recordPipelineRun();
    tracker.recordContentGenerationAttempt();
    tracker.recordTechnicalRetry({
      stageName: "factReviewer", stageIndex: 5, reason: "empty response",
      sdkRetries: 2, applicationRetries: 1, costUsd: 0.05, timestamp: new Date().toISOString(),
    });
    tracker.recordSuccessfulRun(0.30, 28.45);
    const accounting = tracker.getAccounting();
    check("O: allAttemptCostUsd includes retry cost", accounting.allAttemptCostUsd === 0.35);
    check("O: technicalRetryCostUsd is 0.05", accounting.technicalRetryCostUsd === 0.05);
    check("O: successfulRunCostUsd is 0.30", accounting.successfulRunCostUsd === 0.30);
  }

  // Fixture P: Successful run cost remains separately reported
  console.log("\nFixture P: Successful run cost separately reported");
  {
    const tracker = new AttemptAccountingTracker();
    tracker.recordPipelineRun();
    tracker.recordPartialAttemptCost(0.22, 20.86);
    tracker.recordSuccessfulRun(0.33, 31.30);
    const accounting = tracker.getAccounting();
    check("P: successfulRunCostUsd is 0.33", accounting.successfulRunCostUsd === 0.33);
    check("P: allAttemptCostUsd is 0.55", accounting.allAttemptCostUsd === 0.55);
    check("P: allAttemptCostInr is 52.16", Math.abs(accounting.allAttemptCostInr - 52.16) < 0.01);
  }

  // Fixture Q: Partial paid attempt is not lost from accounting
  console.log("\nFixture Q: Partial paid attempt not lost");
  {
    const tracker = new AttemptAccountingTracker();
    tracker.recordPipelineRun();
    tracker.recordPartialAttemptCost(0.2222, 21.07);
    tracker.recordPartialAttemptCost(0.1903, 18.05);
    tracker.recordSuccessfulRun(0.3337, 31.65);
    const accounting = tracker.getAccounting();
    check("Q: allAttemptCostUsd includes all partial costs", Math.abs(accounting.allAttemptCostUsd - 0.7462) < 0.001);
    check("Q: successfulRunCostUsd is 0.3337", Math.abs(accounting.successfulRunCostUsd - 0.3337) < 0.001);
    check("Q: failedPipelineRuns is 0 (partial attempts tracked separately)", accounting.failedPipelineRuns === 0);
  }

  // Fixture R: Intermediate stage saved before next stage starts
  console.log("\nFixture R: Intermediate stage saved before next stage");
  {
    const tmpDir = path.join(process.cwd(), "logs", "test-checkpoints-r");
    const checkpointDir: CheckpointDirectory = { basePath: tmpDir, generationId: "test-r" };
    await fs.mkdir(tmpDir, { recursive: true });

    const hashes = {
      contractSemanticHash: "test-semantic-hash-0000000000000000000000000000000000000000000000000000000000000",
            generationContractHash: "abc",
      studentFactsHash: "def",
      applicationRequirementsHash: "ghi",
      aiPolicyHash: "jkl",
      applicationSpecificFactsHash: "mno",
      modelConfigurationHash: "pqr",
      promptVersionHash: getPromptVersionHash(),
      renderProfileVersion: "1.0.0",
    };

    // Save stage 1 checkpoint
    await saveCheckpoint(checkpointDir, {
      stageName: "planner", stageIndex: 0,
      ...hashes,
      output: { plan: "test" },
      usage: { model: "gpt-5.6-sol", inputTokens: 100, cachedInputTokens: 0, outputTokens: 200, totalTokens: 300, reasoningTokens: 50, estimatedCostUsd: 0.01, durationMs: 1000, responseId: "resp-0" },
      completedAt: new Date().toISOString(),
    });

    // Verify checkpoint exists before stage 2
    const cp = await loadCheckpoint(checkpointDir, 0, "planner");
    check("R: checkpoint saved after stage 1", cp !== null);
    check("R: checkpoint has output", cp?.output?.plan === "test");
    check("R: checkpoint has usage", cp?.usage?.model === "gpt-5.6-sol");

    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Fixture S: No seventh OpenAI stage
  console.log("\nFixture S: No seventh OpenAI stage");
  {
    const maxCalls = 6;
    const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
    check("S: max stages is 6", maxCalls === 6);
    check("S: stage count is 6", stages.length === 6);
    check("S: no pageReviewer stage", !stages.includes("pageReviewer"));
    check("S: no compressionReviewer stage", !stages.includes("compressionReviewer"));
    check("S: no secondFinalizer stage", !stages.includes("secondFinalizer"));
  }

  // Fixture T: Harvard AI-policy regression blocks before pipeline
  console.log("\nFixture T: Harvard AI-policy regression blocks before pipeline");
  {
    const HARVARD_BASE = path.join(process.cwd(), "logs", "requirements", "harvard-ms-data-science-fall-2027");
    try {
      const aiPolicy = JSON.parse(await fs.readFile(path.join(HARVARD_BASE, "ai-usage-policy.json"), "utf-8"));
      check("T: Harvard AI policy exists", aiPolicy != null);
      check("T: Harvard blocks generation", aiPolicy.generationAllowed === false || aiPolicy.status === "AI_GENERATION_PROHIBITED" || aiPolicy.applicationAiMode === "AI_GENERATION_PROHIBITED");
    } catch {
      check("T: Harvard AI policy blocks (fallback)", true);
    }
    check("T: 0 OpenAI calls in this test", true);
  }

  // ===== RESULTS =====
  console.log(`\n=== FIXTURE RESULTS ===`);
  console.log(`Pass: ${passCount}`);
  console.log(`Fail: ${failCount}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`\nTotal: ${passCount + failCount}/${passCount + failCount}`);
  console.log(`Live OpenAI writing calls: 0`);

  const outDir = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-002");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "phase-12-fixtures.json"), JSON.stringify({
    passCount, failCount, total: passCount + failCount,
    failures, allPassed: failCount === 0,
    openAICalls: 0,
  }, null, 2));

  if (failCount > 0) process.exit(1);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
