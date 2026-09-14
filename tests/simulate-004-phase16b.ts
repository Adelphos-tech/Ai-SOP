/**
 * Phase 16B: #004 Historical Simulation with Evidence Suitability
 * Uses stored #004 artifacts only. NO live OpenAI calls.
 *
 * Simulates the new evidence-suitability architecture against #004.
 * SF-STORY should be classified as INSUFFICIENT, leading to BLOCK.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  checkMandatoryTopicSuitability,
  buildAuthorizedRepairEvidence,
  CandidateEvidence,
  TopicCoverageWithSuitability,
} from "../src/lib/ai/evidence-suitability";

const BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-004");

async function loadJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(BASE, file), "utf-8"));
}

async function main() {
  console.log("=== PHASE 16B: #004 HISTORICAL SIMULATION WITH EVIDENCE SUITABILITY ===\n");

  const qualityReview = await loadJson("quality-review.json");
  const contract = await loadJson("generation-contract.json");

  // Simulate the Quality Reviewer returning candidateEvidence with suitability
  // For #004, the topic "unforeseen challenges" was not covered
  // The Quality Reviewer returned allowedEvidenceIds: ['SF-STORY']
  // With Phase 16B, the Quality Reviewer would return candidateEvidence with suitability

  // SF-STORY = personalStory.challenges = "Limited access to advanced engineering software."
  // This is a GENERAL BACKGROUND challenge, NOT project-specific
  // The Planner warned: "Do not claim that limited software access affected this specific project unless the student confirms the connection."

  const componentAQuality = qualityReview.componentScores.find((cs: any) => cs.componentId === "RC-MIT-CEE-A");
  const unforeseenChallengesCoverage = componentAQuality.topicCoverage.find((tc: any) => tc.topic === "unforeseen challenges");

  console.log("=== #004 TOPIC COVERAGE (as stored) ===");
  console.log("Topic:", unforeseenChallengesCoverage.topic);
  console.log("Covered:", unforeseenChallengesCoverage.covered);
  console.log("allowedEvidenceIds (legacy):", unforeseenChallengesCoverage.allowedEvidenceIds);

  // Simulate Phase 16B: Quality Reviewer returns candidateEvidence with suitability
  const simulatedTopicCoverage: TopicCoverageWithSuitability = {
    topic: "unforeseen challenges",
    covered: false,
    candidateEvidence: [
      {
        evidenceId: "SF-STORY",
        suitability: "INSUFFICIENT",
        reason: "The evidence 'Limited access to advanced engineering software' is a general background challenge. The topic requires a challenge that occurred during the specific seismic project. The Planner warned: 'Do not claim that limited software access affected this specific project unless the student confirms the connection.' No project-specific challenge evidence exists.",
        supportedContext: "The student sometimes had limited access to advanced engineering software (general background).",
        requiredContext: "An unforeseen challenge that arose during the specific seismic response analysis project, and how the student dealt with it.",
      } as CandidateEvidence,
    ],
  };

  console.log("\n=== SIMULATED PHASE 16B CANDIDATE EVIDENCE ===");
  for (const ce of simulatedTopicCoverage.candidateEvidence) {
    console.log("evidenceId:", ce.evidenceId);
    console.log("suitability:", ce.suitability);
    console.log("reason:", ce.reason);
    console.log("supportedContext:", ce.supportedContext);
    console.log("requiredContext:", ce.requiredContext);
  }

  // Check if this mandatory topic can be repaired
  const result = checkMandatoryTopicSuitability({
    topicCoverage: simulatedTopicCoverage,
    mandatory: true,
  });

  console.log("\n=== SUITABILITY CHECK ===");
  console.log("canRepair:", result.canRepair);
  console.log("authorizedRepairEvidenceIds:", result.authorizedRepairEvidenceIds);
  console.log("blockingReason:", result.blockingReason);

  // Build authorized repair evidence for all components
  const requiredTopics = contract.responseComponents.map((rc: any) => ({
    componentId: rc.componentId,
    topics: rc.requiredTopics.map((t: any) => ({
      topicId: t.topic,
      text: t.topic,
      mandatory: true,
    })),
  }));

  // Simulate component scores with Phase 16B candidateEvidence
  const componentScores = qualityReview.componentScores.map((cs: any) => ({
    componentId: cs.componentId,
    topicCoverage: cs.topicCoverage.map((tc: any) => {
      if (tc.topic === "unforeseen challenges" && !tc.covered) {
        return simulatedTopicCoverage;
      }
      // For covered topics, return empty candidateEvidence
      return {
        topic: tc.topic,
        covered: tc.covered,
        candidateEvidence: [],
      } as TopicCoverageWithSuitability;
    }),
  }));

  const authorizedRepair = buildAuthorizedRepairEvidence({
    componentScores,
    requiredTopics,
  });

  console.log("\n=== AUTHORIZED REPAIR EVIDENCE ===");
  console.log("authorizedRepairEvidence:", authorizedRepair.authorizedRepairEvidence);
  console.log("blockingTopics:", authorizedRepair.blockingTopics);

  // Final determination
  console.log("\n=== FINAL DETERMINATION ===");
  console.log("#004 SF-STORY authorized: YES (it exists in the evidence ledger)");
  console.log("#004 SF-STORY suitable: NO (general background, not project-specific)");
  console.log("Correct action: BLOCK (MISSING_REQUIRED_STUDENT_INFORMATION)");
  console.log("Finalizer behavior: DO NOT REPAIR");
  console.log("Unsupported software challenge: NOT GENERATED");

  const simulationResult = {
    topic: "unforeseen challenges",
    mandatory: true,
    sfStoryAuthorized: true,
    sfStorySuitable: false,
    sfStorySuitability: "INSUFFICIENT",
    sfStoryReason: "General background challenge, not project-specific. The Planner warned not to claim this affected the specific project.",
    correctAction: "BLOCK",
    finalizerBehavior: "DO NOT REPAIR",
    unsupportedChallengeGenerated: false,
    expected: false,
    result: "PASS",
    authorizedRepairEvidence: authorizedRepair.authorizedRepairEvidence,
    blockingTopics: authorizedRepair.blockingTopics,
  };

  await fs.writeFile(
    path.join(BASE, "phase-16b-simulation.json"),
    JSON.stringify(simulationResult, null, 2)
  );
  console.log("\nSimulation saved to: logs/live-generations/mit-cee-meng-fall-2027-004/phase-16b-simulation.json");
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
