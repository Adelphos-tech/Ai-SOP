import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

interface UsageRow {
  timestamp: string;
  model: string;
  pipelineStage: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  duration: number;
  success: boolean;
}

const usagePath = "logs/openai-usage.jsonl";
const costPath = "logs/live-generations/mit-cee-meng-fall-2027-002/cost.json";
const runnerPath = "src/lib/ai/pipeline/run-application-pipeline.ts";
const outputPath = "logs/phase-12b/mit-002-attempt-cost-audit.json";
const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"];
const usdScale = 10_000_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function decimal(units: number, places: number): string {
  assert(Number.isSafeInteger(units) && units >= 0);
  const scale = 10 ** places;
  return `${Math.floor(units / scale)}.${String(units % scale).padStart(places, "0")}`;
}

function costUnits(row: UsageRow): number {
  for (const value of [row.inputTokens, row.cachedInputTokens, row.outputTokens, row.totalTokens, row.reasoningTokens]) {
    assert(Number.isSafeInteger(value) && value >= 0);
  }
  assert.equal(row.model, "gpt-5.6-sol");
  assert.equal(row.success, true);
  assert(row.cachedInputTokens <= row.inputTokens);
  assert(row.reasoningTokens <= row.outputTokens);
  assert.equal(row.totalTokens, row.inputTokens + row.outputTokens);
  const units = (row.inputTokens - row.cachedInputTokens) * 40 + row.cachedInputTokens * 4 + row.outputTokens * 200;
  assert(Number.isSafeInteger(units));
  assert(Math.abs(row.estimatedCostUsd - units / usdScale) < 1e-12, "Historical logged estimate must reconcile to historical token rates");
  return units;
}

async function main() {
  const root = process.cwd();
  const rootName = path.basename(root);
  assert.ok(rootName === "server-12b" || rootName === "sop-ai-app",
    `Run from server-12b or sop-ai-app only (cwd basename: ${rootName})`);
  const usageRaw = await fs.readFile(path.join(root, usagePath), "utf8");
  const costRaw = await fs.readFile(path.join(root, costPath), "utf8");
  const runnerRaw = await fs.readFile(path.join(root, runnerPath), "utf8");
  const costArtifact = JSON.parse(costRaw);
  const entries = usageRaw.split("\n").map((raw, index) => ({ raw, sourceLine: index + 1 }))
    .filter(entry => entry.raw.trim()).map(entry => ({ ...entry, row: JSON.parse(entry.raw) as UsageRow }));
  const firstTimestamp = "2026-09-09T18:36:01.263Z";
  const lastTimestamp = "2026-09-09T18:46:37.545Z";
  const selected = entries.filter(entry => entry.row.timestamp >= firstTimestamp && entry.row.timestamp <= lastTimestamp);
  assert.equal(selected.length, 16, "Sixteen successful logged rows, NOT sixteen total billed calls");
  assert.deepEqual(selected.map(entry => entry.sourceLine), Array.from({ length: 16 }, (_, index) => 59 + index));
  selected.forEach((entry, index) => {
    costUnits(entry.row);
    if (index > 0) assert(entry.row.timestamp > selected[index - 1].row.timestamp);
  });
  const grouped = [selected.slice(0, 5), selected.slice(5, 10), selected.slice(10)];
  assert.deepEqual(grouped.map(group => group[0].row.timestamp), [firstTimestamp, "2026-09-09T18:39:59.097Z", "2026-09-09T18:43:38.074Z"]);
  grouped.forEach((group, index) => assert.deepEqual(group.map(entry => entry.row.pipelineStage), stages.slice(0, index === 2 ? 6 : 5)));
  assert.equal(costArtifact.stages.length, 6);
  grouped[2].forEach((entry, index) => {
    const artifactStage = costArtifact.stages[index];
    assert.equal(artifactStage.stage, entry.row.pipelineStage);
    assert.equal(artifactStage.durationMs, entry.row.duration);
    for (const field of ["model", "inputTokens", "cachedInputTokens", "outputTokens", "totalTokens", "reasoningTokens", "estimatedCostUsd", "success"] as const) {
      assert.equal(artifactStage[field], entry.row[field], `cost.json stage ${index + 1}: ${field}`);
    }
  });
  const totals = grouped.map(group => group.reduce((sum, entry) => sum + costUnits(entry.row), 0));
  assert.deepEqual(totals, [2_221_600, 1_903_472, 3_336_832]);
  const allLoggedUnits = totals.reduce((sum, units) => sum + units, 0);
  const successfulFactReviewerUnits = costUnits(selected[15].row);
  const avoidableUnits = totals[1] + totals[2] - successfulFactReviewerUnits;
  const hypotheticalKnownUnits = totals[0] + successfulFactReviewerUnits;
  assert.equal(allLoggedUnits, 7_461_904);
  assert.equal(avoidableUnits, 3_924_064);
  assert.equal(hypotheticalKnownUnits, 3_537_840);
  assert.equal(allLoggedUnits, avoidableUnits + hypotheticalKnownUnits);
  assert(Math.abs(costArtifact.estimatedUsd - totals[2] / usdScale) < 1e-12);
  for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"] as const) {
    assert.equal(costArtifact.usage[field], grouped[2].reduce((sum, entry) => sum + entry.row[field], 0));
  }
  assert.equal(costArtifact.exchangeRate.rate, 94.843169);
  const fxUnits = 94_843_169;
  const money = (units: number) => ({ usd: decimal(units, 7), inr: decimal(units * fxUnits, 13) });
  const emptyContentCheck = runnerRaw.indexOf('if (!content) throw new Error(`${stage} returned empty content`)');
  const usageExtraction = runnerRaw.indexOf("const promptTokens = response.usage");
  const usageLogging = runnerRaw.indexOf("await logUsage(");
  const currentSourceMatchesOriginalLoggingOrder = emptyContentCheck >= 0 && emptyContentCheck < usageExtraction && usageExtraction < usageLogging;
  const audit = {
    auditVersion: "phase-12b",
    billingStatus: "BILLING_STATUS_UNCERTAIN",
    accountingBasis: "Historical application-log token-price estimates, not provider invoices. Raw IEEE-754 JSON values are retained; decimal arithmetic uses exact integer 0.0000001 USD units and historical rates, not estimates for missing failures.",
    pipelineRuns: 3,
    contentGenerationAttempts: 3,
    successfulPipelineRuns: 1,
    failedPipelineRuns: 2,
    runAttribution: "Three timestamp-ordered planner restarts with stage sequences 1-5, 1-5, 1-6; run 3 matches all six cost.json stages. The usage log has no generation or attempt IDs. Run 1/2 stage-6 empty-content failure attribution is historical context, not a failed usage row or provider billing record.",
    technicalStageRetries: 0,
    technicalStageRetriesBasis: "No in-place stage retry is visible; these were full pipeline restarts. SDK transport retries and billed request count remain unknown.",
    paidApiCalls: null,
    totalBilledCalls: null,
    allAttemptCostUsd: null,
    allAttemptCostInr: null,
    totalBilledCostUsd: null,
    totalBilledCostInr: null,
    partialAttempt1CostUsd: null,
    partialAttempt1CostInr: null,
    partialAttempt2CostUsd: null,
    partialAttempt2CostInr: null,
    failedFactReviewerCostUsd: null,
    failedFactReviewerCostInr: null,
    failedFactReviewerInputTokens: null,
    failedFactReviewerOutputTokens: null,
    failedFactReviewerTotalTokens: null,
    loggedSuccessfulCalls: selected.length,
    loggedCallCountLowerBound: selected.length,
    successfulRunCostUsd: totals[2] / usdScale,
    successfulRunCostInr: Number(money(totals[2]).inr),
    successfulRunCostBasis: "Logged six-stage estimate only; exact billed successful-run cost is unknown.",
    successfulRunBilledCostUsd: null,
    successfulRunBilledCostInr: null,
    partialAttempt1LoggedLowerBound: money(totals[0]),
    partialAttempt2LoggedLowerBound: money(totals[1]),
    successfulRunLoggedCost: money(totals[2]),
    allAttemptLoggedCostLowerBoundUsd: allLoggedUnits / usdScale,
    allAttemptLoggedCostLowerBoundInr: Number(money(allLoggedUnits).inr),
    allAttemptLoggedCostLowerBoundExact: money(allLoggedUnits),
    failedFactReviewerAttempts: [1, 2].map(runNumber => ({
      runNumber,
      stage: "factReviewer",
      usageLogRow: null,
      timestamp: null,
      responseId: null,
      tokens: null,
      costUsd: null,
      costInr: null,
      billingStatus: "BILLING_STATUS_UNCERTAIN",
    })),
    requiredFirstStages: { runNumber: 1, stageNumbers: [1, 2, 3, 4, 5], sourceLines: [59, 60, 61, 62, 63], loggedCost: money(totals[0]) },
    avoidableRepeatedStages: {
      description: "Run 2 stages 1-5 PLUS run 3 stages 1-5; run 1 stages 1-5 were required and are not waste.",
      loggedCalls: 10,
      sourceLines: selected.slice(5, 15).map(entry => entry.sourceLine),
      loggedCost: money(avoidableUnits),
    },
    checkpointSavingsUsd: null,
    checkpointSavingsInr: null,
    checkpointAvoidableLoggedCostUsd: avoidableUnits / usdScale,
    checkpointAvoidableLoggedCostInr: Number(money(avoidableUnits).inr),
    hypotheticalCheckpointCostUsd: null,
    hypotheticalCheckpointCostInr: null,
    hypotheticalCheckpointLoggedLowerBound: money(hypotheticalKnownUnits),
    hypotheticalCheckpointFormula: `${money(totals[0]).usd} required first five + ${money(successfulFactReviewerUnits).usd} successful factReviewer + unknown run-1 failed factReviewer cost + unknown run-2 failed factReviewer cost. This is an accounting counterfactual, not a prediction of tokens, content, or billing after checkpointing.`,
    successfulFactReviewerLoggedCost: money(successfulFactReviewerUnits),
    fx: { ...costArtifact.exchangeRate, basis: "Historical artifact rate reused without network lookup; no claim about current FX or invoiced INR." },
    uncertaintyReason: "Original callOpenAI throws on empty content before extracting response.usage or logging usage. Missing failures cannot be priced as zero or as the successful reviewer. logUsage also swallows write failures. Sixteen logged successes do not establish the total number of paid calls or the exact all-attempt bill.",
    historicalCorrection: "Historical audit remains untouched. It truncated planner costs, mislabeled sixteen logged successes as paidApiCalls, and subtracted guessed reviewer costs from the wrong repeated-stage base.",
    provenance: {
      usage: { path: usagePath, sha256: hash(usageRaw), totalRows: entries.length, selectedLineRange: [59, 74], firstTimestamp, lastTimestamp },
      successfulCostArtifact: { path: costPath, sha256: hash(costRaw), raw: costRaw },
      originalRunner: {
        path: runnerPath,
        originalLineRange: [113, 156],
        currentSourceSha256: hash(runnerRaw),
        currentSourceMatchesOriginalLoggingOrder,
        evidenceBasis: "Exact original source lines inspected before implementation; current source hash is not claimed to be a historical execution hash.",
        originalSourceLines: [
          { line: 113, raw: "  const response = await client.chat.completions.create({" },
          { line: 123, raw: '  const content = response.choices[0]?.message?.content || "";' },
          { line: 124, raw: '  if (!content) throw new Error(`${stage} returned empty content`);' },
          { line: 127, raw: "  const promptTokens = response.usage?.prompt_tokens || 0;" },
          { line: 128, raw: "  const completionTokens = response.usage?.completion_tokens || 0;" },
          { line: 129, raw: "  const totalTokens = response.usage?.total_tokens || 0;" },
          { line: 130, raw: "  const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;" },
          { line: 131, raw: "  const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;" },
          { line: 150, raw: "  await logUsage({" },
          { line: 155, raw: "    estimatedCostUsd: cost.totalCostUsd, duration, success: true," },
          { line: 156, raw: "  } as UsageLogEntry);" },
        ],
      },
      pricing: { path: "src/lib/ai/pricing.ts", lineRange: [15, 19], inputUsdPerMillion: "4.00", cachedInputUsdPerMillion: "0.40", outputUsdPerMillion: "20.00", independentlyVerifiedProviderRates: false },
      runnerArtifactWriter: { path: "tests/run-mit-live-002.ts", failureLines: [234, 242], successfulCostAndAccountingLines: [282, 307] },
    },
    runs: grouped.map((group, index) => ({
      runNumber: index + 1,
      outcome: index === 2 ? "SUCCESS" : "PARTIAL_FAILED_STAGE_6_HISTORICAL_CONTEXT",
      firstLoggedCompletionTimestamp: group[0].row.timestamp,
      lastLoggedCompletionTimestamp: group[group.length - 1].row.timestamp,
      exactRunStartTimestamp: null,
      exactRunEndTimestamp: null,
      loggedSuccessfulCalls: group.length,
      totalBilledCalls: null,
      totalBilledCostUsd: null,
      loggedCostLowerBound: money(totals[index]),
      rawRows: group.map(entry => ({ sourcePath: usagePath, sourceLine: entry.sourceLine, sha256: hash(entry.raw), raw: entry.raw, parsed: entry.row, exactLoggedCost: money(costUnits(entry.row)) })),
    })),
  };
  assert.equal(audit.paidApiCalls, null);
  assert.equal(audit.allAttemptCostUsd, null);
  assert.equal(audit.hypotheticalCheckpointCostUsd, null);
  assert.equal(audit.avoidableRepeatedStages.loggedCalls, 10);
  assert.equal(await fs.readFile(path.join(root, usagePath), "utf8"), usageRaw);
  assert.equal(await fs.readFile(path.join(root, costPath), "utf8"), costRaw);
  const destination = path.join(root, outputPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(audit, null, 2) + "\n");
  console.log(JSON.stringify({ billingStatus: audit.billingStatus, runs: totals.map(money), allLoggedLowerBound: money(allLoggedUnits), avoidableRepeatedStages: money(avoidableUnits), hypotheticalKnownLowerBound: money(hypotheticalKnownUnits), outputPath }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
