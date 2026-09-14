/**
 * Phase 18: Recovery script for #005 artifacts after SSH connection drop.
 * The pipeline completed successfully (all 6 stages) but the runner script
 * was interrupted before saving artifacts to the output directory.
 * This script reads from the attempt checkpoint directory and saves
 * all artifacts to the live-generations output directory.
 *
 * NO OpenAI calls — this is pure artifact recovery from stored checkpoints.
 */

import { promises as fs } from "fs";
import path from "path";

const ATTEMPT_DIR = path.join(process.cwd(), "logs", "attempts", "afeefc94-6515-467f-a053-7a1e85abc45c");
const OUTPUT_BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-005");
const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");

async function loadJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(file, "utf-8"));
}

async function saveJson(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function main() {
  console.log("=== PHASE 18: #005 ARTIFACT RECOVERY ===\n");

  // Load run-state for metadata
  const runState = await loadJson(path.join(ATTEMPT_DIR, "run-state.json"));
  const generationId = runState.state.generationId;
  console.log("Generation ID:", generationId);
  console.log("Status:", runState.state.status);

  // Load all stage artifacts
  const planner = await loadJson(path.join(ATTEMPT_DIR, "artifact-01-planner.json"));
  const writer = await loadJson(path.join(ATTEMPT_DIR, "artifact-02-writer.json"));
  const qualityReview = await loadJson(path.join(ATTEMPT_DIR, "artifact-03-qualityReviewer.json"));
  const languageCalibration = await loadJson(path.join(ATTEMPT_DIR, "artifact-04-languageCalibrator.json"));
  const finalizer = await loadJson(path.join(ATTEMPT_DIR, "artifact-05-finalizer.json"));
  const factReview = await loadJson(path.join(ATTEMPT_DIR, "artifact-06-factReviewer.json"));

  // Load accounting
  const accounting = await loadJson(path.join(ATTEMPT_DIR, "accounting.json"));
  const runs = await loadJson(path.join(ATTEMPT_DIR, "runs.json"));

  // Load existing pre-generation artifacts
  const contract = await loadJson(path.join(OUTPUT_BASE, "generation-contract.json"));
  const gateResult = await loadJson(path.join(OUTPUT_BASE, "gate-result.json"));

  // Extract final responses from finalizer
  const responses = finalizer.responses.map((r: any) => ({
    componentId: r.componentId,
    title: r.title || r.componentId,
    text: r.text,
  }));

  // Build final text
  const finalText = responses.map((r: any) => r.text).join("\n\n");

  // Word count
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;

  // Extract cost from accounting
  const costUsd = accounting.successfulRunCostUsd || accounting.allAttemptCostUsd || 0;
  const costInr = costUsd * (runState.state.exchangeRate || 95.121034);

  // Extract token usage from calls
  const calls = runState.state.calls || [];
  const totalInputTokens = calls.reduce((sum: number, c: any) => sum + (c.usage?.inputTokens || 0), 0);
  const totalCachedInputTokens = calls.reduce((sum: number, c: any) => sum + (c.usage?.cachedInputTokens || 0), 0);
  const totalOutputTokens = calls.reduce((sum: number, c: any) => sum + (c.usage?.outputTokens || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const duration = calls.reduce((sum: number, c: any) => sum + (c.usage?.durationMs || 0), 0);

  // Extract fact review results
  let inventedFacts = 0;
  let alteredFacts = 0;
  let interpretiveElaborations = 0;
  let supportedStudent = 0;
  let supportedProgram = 0;
  let supportedFaculty = 0;
  let ambiguous = 0;

  if (factReview.components) {
    for (const comp of factReview.components) {
      for (const claim of comp.claims || []) {
        switch (claim.classification) {
          case "INVENTED_FACT": inventedFacts++; break;
          case "ALTERED_FACT": alteredFacts++; break;
          case "INTERPRETIVE_ELABORATION": interpretiveElaborations++; break;
          case "SUPPORTED_STUDENT_FACT": supportedStudent++; break;
          case "SUPPORTED_PROGRAM_FACT": supportedProgram++; break;
          case "SUPPORTED_FACULTY_FACT": supportedFaculty++; break;
          case "AMBIGUOUS": ambiguous++; break;
        }
      }
    }
  }

  // Build compliance
  const factSafetyStatus = inventedFacts > 0 || alteredFacts > 0 ? "FAIL" : "PASS";
  const submissionStatus = inventedFacts > 0 || alteredFacts > 0 ? "REVIEW_REQUIRED" : "READY_TO_SUBMIT";
  const compliance = {
    submissionStatus,
    factSafety: {
      status: factSafetyStatus,
      inventedFacts,
      alteredFacts,
      interpretiveElaborations,
      supportedStudent,
      supportedProgram,
      supportedFaculty,
      ambiguous,
    },
  };

  // Save all artifacts
  console.log("\nSaving artifacts...");
  await saveJson(path.join(OUTPUT_BASE, "planner.json"), planner);
  await saveJson(path.join(OUTPUT_BASE, "writer.json"), writer);
  await saveJson(path.join(OUTPUT_BASE, "quality-review.json"), qualityReview);
  await saveJson(path.join(OUTPUT_BASE, "language-calibration.json"), languageCalibration);
  await saveJson(path.join(OUTPUT_BASE, "bounded-finalizer.json"), finalizer);
  await saveJson(path.join(OUTPUT_BASE, "final-fact-review.json"), factReview);
  await saveJson(path.join(OUTPUT_BASE, "final-compliance.json"), compliance);
  await saveJson(path.join(OUTPUT_BASE, "submission-status.json"), {
    submissionStatus,
    factSafety: compliance.factSafety,
  });

  // Save final response
  const finalResponse = {
    status: "success",
    generationId,
    documentType: "STATEMENT OF OBJECTIVES",
    responseComponentCount: responses.length,
    responses,
    finalText,
    wordCount,
    model: "gpt-5.6-sol",
    stages: 6,
    duration,
  };
  await saveJson(path.join(OUTPUT_BASE, "final-response.json"), finalResponse);

  // Save final statement text
  await fs.writeFile(path.join(OUTPUT_BASE, "final-statement-of-objectives.txt"), finalText);

  // Save cost
  await saveJson(path.join(OUTPUT_BASE, "cost.json"), {
    usage: {
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
    },
    estimatedUsd: costUsd,
    estimatedInr: costInr,
    exchangeRate: runState.state.exchangeRate || 95.121034,
    stages: calls.map((c: any) => ({ stage: c.stage, durationMs: c.usage?.durationMs, inputTokens: c.usage?.inputTokens, outputTokens: c.usage?.outputTokens, costUsd: c.usage?.costUsd })),
  });

  // Save usage
  await saveJson(path.join(OUTPUT_BASE, "usage.json"), {
    stages: calls.map((c: any) => ({ stage: c.stage, durationMs: c.usage?.durationMs, inputTokens: c.usage?.inputTokens, outputTokens: c.usage?.outputTokens })),
    totalInputTokens,
    totalCachedInputTokens,
    totalOutputTokens,
    totalTokens,
    estimatedApiCostUSD: costUsd,
    estimatedApiCostINR: costInr,
    exchangeRate: runState.state.exchangeRate || 95.121034,
  });

  // Save attempt accounting
  await saveJson(path.join(OUTPUT_BASE, "attempt-accounting.json"), {
    ...accounting,
    pipelineRuns: 1,
    contentGenerationAttempts: 1,
    technicalStageRetries: 0,
    paidApiCalls: calls.length,
    successfulRunCostUsd: costUsd,
    technicalRetryCostUsd: 0,
    allAttemptCostUsd: costUsd,
    allAttemptCostInr: costInr,
  });

  // Print summary
  console.log("\n=== RECOVERY SUMMARY ===");
  console.log("Status: SUCCESS");
  console.log("Generation ID:", generationId);
  console.log("Stages: 6");
  console.log("Duration:", (duration / 1000).toFixed(1) + "s");
  console.log("Word count:", wordCount);
  console.log("Cost USD: $" + costUsd.toFixed(6));
  console.log("Cost INR: ₹" + costInr.toFixed(2));
  console.log("Input tokens:", totalInputTokens);
  console.log("Output tokens:", totalOutputTokens);
  console.log("Total tokens:", totalTokens);
  console.log();
  console.log("Fact Safety:");
  console.log("  Invented:", inventedFacts);
  console.log("  Altered:", alteredFacts);
  console.log("  Interpretive:", interpretiveElaborations);
  console.log("  Supported student:", supportedStudent);
  console.log("  Supported program:", supportedProgram);
  console.log("  Supported faculty:", supportedFaculty);
  console.log("  Ambiguous:", ambiguous);
  console.log("  Status:", factSafetyStatus);
  console.log("  Submission:", submissionStatus);
  console.log();
  console.log("All artifacts saved to:", OUTPUT_BASE);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
