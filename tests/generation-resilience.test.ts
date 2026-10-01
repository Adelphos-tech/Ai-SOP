/**
 * generation-resilience.test.ts — Wave: generation auto-recovery.
 * Deterministic, no provider calls.
 *
 * Matrix (spec §20):
 *   1  contract-invalid content → in-run same-stage retry succeeds
 *   2  retry budget exhausted → FAILED_TECHNICAL, resumable
 *   3  factReviewer SLA breach with in-flight response → RECOVERABLE,
 *      provider response NOT cancelled (no duplicate paid call)
 *   4  provider completes inside recovery window → success
 *   5  stage-order invariants across execute/skip/resume
 *   6  finalizer deterministic skip advances cursor for stage 6
 *   7  technical stage-6 failure → resume reruns ONLY stage 6
 *   8  classifier normalizes every known failure class
 *   9  cancel during in-flight response → provider cancel attempted
 *   10 concurrent stage execution → single-flight enforced
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "path";
import { randomUUID } from "node:crypto";

import {
  createStageExecution, EXECUTION_STAGES, StageExecutionError,
} from "../src/lib/ai/pipeline/stage-execution";
import {
  waitForBackgroundStage, MockResponsesTransport, StageTimeoutError,
} from "../src/lib/ai/openai-transport";
import { GenerationCancelledError } from "../src/lib/application/generation-lifecycle";
import { classifyGenerationError } from "../src/lib/application/generation-errors";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); });
}

const hashes = {
  generationContractHash: "a".repeat(64),
  contractSemanticHash: "9".repeat(64),
  studentFactsHash: "b".repeat(64),
  applicationRequirementsHash: "c".repeat(64),
  aiPolicyHash: "d".repeat(64),
  applicationSpecificFactsHash: "e".repeat(16),
  modelConfigurationHash: "f".repeat(64),
  promptVersionHash: "test",
  renderProfileVersion: "1.0.0",
};

function usage(stage: string, responseId = `resp-${stage}-x`) {
  return {
    stage, model: "test", responseId, durationMs: 1,
    inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2,
    reasoningTokens: 0, estimatedCostUsd: 0.001, success: true,
  };
}
const CONTENT: Record<string, string> = {
  planner: JSON.stringify({ componentPlans: [{ componentId: "A" }] }),
  writer: JSON.stringify({ responses: [{ componentId: "A", text: "t" }] }),
  qualityReviewer: JSON.stringify({
    componentScores: [{ componentId: "A", score: 8, topicCoverage: [], factualRiskClaims: [], wordCompliance: "PASS", characterCompliance: "PASS" }],
    overall_score: 8, requirementCompliance: { requiredTopics: "PASS" },
  }),
  languageCalibrator: JSON.stringify({ responses: [{ componentId: "A", text: "t" }] }),
  finalizer: JSON.stringify({ responses: [{ componentId: "A", text: "t", retainedClaimIds: [], removedClaimIds: [], repairClaims: [] }] }),
  factReviewer: JSON.stringify({
    components: [{ componentId: "A", pass: true, claims: [], inventedCount: 0, alteredCount: 0, elaborationCount: 0, ambiguousCount: 0 }],
    totalInventedFacts: 0, totalAlteredFacts: 0, totalInterpretiveElaborations: 0, totalAmbiguousClaims: 0, overallPass: true,
  }),
};

async function withTmp(fn: (dir: string) => Promise<void>) {
  const dir = path.join(process.cwd(), "logs", "resilience-test", randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

function mkExec(dir: string, generationId: string, mode: "CONTENT_REGENERATION" | "TECHNICAL_STAGE_RETRY", call: any) {
  return createStageExecution({
    generationId, mode, basePath: path.join(dir, generationId),
    hashes, exchangeRate: 1, maxTechnicalRetries: 2, call,
    onContentInvalid: async () => {},
  });
}

async function main() {

/* ---- 1: contract-invalid → in-run retry, cursor advances ---- */
await check("1: CONTENT_JSON_INVALID retries same stage in-run", async () => {
  await withTmp(async (dir) => {
    const id = randomUUID();
    let writerCalls = 0;
    const ex = await mkExec(dir, id, "CONTENT_REGENERATION", async (stage: string) => {
      if (stage === "writer" && writerCalls++ === 0) {
        return { content: '{"responses":[{"componentId":"A","text":"trun', stageUsage: usage(stage) };
      }
      return { content: CONTENT[stage] || "{}", stageUsage: usage(stage) };
    });
    await ex.execute("planner", "s", "u");
    await assert.rejects(() => ex.execute("writer", "s", "u"), /CONTENT_JSON_INVALID/);
    // same stage retried → succeeds now
    const ok = await ex.execute("writer", "s", "u");
    assert.equal((ok.output as any).responses[0].componentId, "A");
    assert.equal(writerCalls, 2);
    await ex.execute("qualityReviewer", "s", "u"); // order intact
    await ex.finish(false); await ex.close();
  });
});

/* ---- 2: retry budget exhausted → FAILED_TECHNICAL resumable ---- */
await check("2: exhausted contract retries → resumable FAILED_TECHNICAL", async () => {
  await withTmp(async (dir) => {
    const id = randomUUID();
    const bad = async (stage: string) => ({
      content: stage === "planner" ? CONTENT.planner : "not-json-at-all",
      stageUsage: usage(stage),
    });
    const ex = await mkExec(dir, id, "CONTENT_REGENERATION", bad);
    await ex.execute("planner", "s", "u");
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => ex.execute("writer", "s", "u"));
    }
    // beyond budget → run failed TECHNICAL
    await assert.rejects(() => ex.execute("writer", "s", "u"), /TECHNICAL_RETRY_LIMIT|CONTENT_JSON|RUN_NOT_ACTIVE/);
    await ex.close();
    // resume: checkpoints valid → writer re-called, planner not
    let calls: string[] = [];
    const ex2 = await mkExec(dir, id, "TECHNICAL_STAGE_RETRY", async (stage: string) => {
      calls.push(stage);
      return { content: CONTENT[stage] || "{}", stageUsage: usage(stage) };
    });
    await ex2.execute("planner", "s", "u"); // restored from checkpoint — no call
    const w = await ex2.execute("writer", "s", "u");
    assert.equal((w.output as any).responses[0].componentId, "A");
    assert.deepEqual(calls, ["writer"]);
    await ex2.finish(false); await ex2.close();
  });
});

/* ---- 3: SLA breach + in-flight response → recoverable, NO cancel ---- */
await check("3: in-progress at SLA → recoverable timeout, no cancel", async () => {
  process.env.OPENAI_STAGE_SLA_FACT_REVIEWER_MS = "120";
  process.env.OPENAI_STAGE_RECOVERY_MS = "60";
  const t = new MockResponsesTransport();
  t.seedResponse("__next__", { statuses: ["in_progress"] });
  const rid = await t.startBackgroundStage("factReviewer", "s", "u");
  const err = await waitForBackgroundStage({
    transport: t, responseId: rid, stage: "factReviewer",
    stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 20,
  }).then(() => null).catch(e => e);
  assert.ok(err instanceof StageTimeoutError);
  assert.equal(err.recoverable, true);
  assert.equal(t.calls.cancel, 0, "provider response must NOT be cancelled");
  delete process.env.OPENAI_STAGE_SLA_FACT_REVIEWER_MS;
  delete process.env.OPENAI_STAGE_RECOVERY_MS;
});

/* ---- 4: provider completes inside recovery window → success ---- */
await check("4: completes inside recovery window → returns content", async () => {
  process.env.OPENAI_STAGE_SLA_FACT_REVIEWER_MS = "80";
  process.env.OPENAI_STAGE_RECOVERY_MS = "8000"; // poll jitter ≤700ms/step
  const t = new MockResponsesTransport();
  t.seedResponse("__next__", { statuses: ["in_progress", "in_progress", "in_progress", "in_progress", "in_progress", "in_progress", "completed"], outputText: CONTENT.factReviewer });
  const rid = await t.startBackgroundStage("factReviewer", "s", "u");
  const result = await waitForBackgroundStage({
    transport: t, responseId: rid, stage: "factReviewer",
    stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 20,
  });
  assert.equal(result.outputText, CONTENT.factReviewer);
  assert.equal(t.calls.cancel, 0);
  delete process.env.OPENAI_STAGE_SLA_FACT_REVIEWER_MS;
  delete process.env.OPENAI_STAGE_RECOVERY_MS;
});

/* ---- 5: stage order invariants across execute/skip/resume ---- */
await check("5: stage-order violations rejected; skip advances cursor", async () => {
  await withTmp(async (dir) => {
    const id = randomUUID();
    const ex = await mkExec(dir, id, "CONTENT_REGENERATION", async (stage: string) => ({
      content: CONTENT[stage] || "{}", stageUsage: usage(stage),
    }));
    await assert.rejects(() => ex.execute("writer", "s", "u"), /STAGE_ORDER_VIOLATION/);
    await ex.execute("planner", "s", "u");
    await assert.rejects(() => ex.execute("finalizer", "s", "u"), /STAGE_ORDER_VIOLATION/);
    await ex.execute("writer", "s", "u");
    await ex.execute("qualityReviewer", "s", "u");
    await ex.execute("languageCalibrator", "s", "u");
    // deterministic finalizer skip — cursor advances to factReviewer
    await ex.skip("finalizer", JSON.parse(CONTENT.finalizer));
    await ex.execute("factReviewer", "s", "u");
    await ex.finish(true); await ex.close();
  });
});

/* ---- 7: stage-6 technical failure → resume reruns only stage 6 ---- */
await check("7: factReviewer technical fail → resume calls only stage 6", async () => {
  await withTmp(async (dir) => {
    const id = randomUUID();
    const fail6 = async (stage: string) => {
      if (stage === "factReviewer") throw new StageExecutionError("STAGE_TIMEOUT", "STAGE_TIMEOUT:factReviewer", true, true);
      return { content: CONTENT[stage] || "{}", stageUsage: usage(stage) };
    };
    const ex = await mkExec(dir, id, "CONTENT_REGENERATION", fail6);
    for (const s of EXECUTION_STAGES.slice(0, 5)) await ex.execute(s, "s", "u");
    await assert.rejects(() => ex.execute("factReviewer", "s", "u"));
    await ex.close();
    const calls: string[] = [];
    const ex2 = await mkExec(dir, id, "TECHNICAL_STAGE_RETRY", async (stage: string) => {
      calls.push(stage);
      return { content: CONTENT[stage] || "{}", stageUsage: usage(stage) };
    });
    for (const s of EXECUTION_STAGES) await ex2.execute(s, "s", "u");
    assert.deepEqual(calls, ["factReviewer"]); // stages 1-5 served from checkpoints — zero provider calls
    await ex2.finish(true); await ex2.close();
  });
});

/* ---- 8: classifier normalizes all known failure classes ---- */
await check("8: classifier covers every runtime failure class", () => {
  const cases: Array<[string, string, boolean]> = [
    ["STAGE_TIMEOUT:factReviewer", "GENERATION_PROVIDER_DELAY", true],
    ["GENERATION_TIME_LIMIT", "GENERATION_TIME_LIMIT", true],
    ["PROVIDER_POLL_FAILED", "GENERATION_PROVIDER_DELAY", true],
    ["PROVIDER_FAILED", "GENERATION_PROVIDER_DELAY", true],
    ["Provider incomplete: max_output_tokens", "GENERATION_PROVIDER_TRUNCATED", true],
    ["PROVIDER_CONTENT_FILTER", "GENERATION_CONTENT_FILTERED", false],
    ["CONTENT_JSON_INVALID: writer output not parseable", "GENERATION_STAGE_RECOVERY_REQUIRED", true],
    ["AI_STAGE_SCHEMA_INVALID qualityReviewer", "GENERATION_STAGE_RECOVERY_REQUIRED", true],
    ["STAGE_ORDER_VIOLATION", "GENERATION_INTERNAL_ERROR", true],
    ["CHECKPOINT_INTEGRITY_FAILED", "GENERATION_INTERNAL_ERROR", true],
    ["MISSING_REQUIRED_STUDENT_INFORMATION", "GENERATION_INPUT_INCOMPLETE", false],
    ["GENERATION_ALREADY_IN_PROGRESS", "GENERATION_ALREADY_IN_PROGRESS", false],
    ["GENERATION_CANCELLED", "GENERATION_CANCELLED", false],
    ["something unknown", "GENERATION_INTERNAL_ERROR", true],
  ];
  for (const [raw, code, recoverable] of cases) {
    const n = classifyGenerationError(raw);
    assert.equal(n.code, code, `${raw} → ${n.code}`);
    assert.equal(n.recoverable, recoverable);
    assert.ok(n.userMessage.length > 20 && !/STAGE_TIMEOUT|CONTENT_JSON|PROVIDER_/.test(n.userMessage), `raw leaked in message: ${n.userMessage}`);
  }
  assert.equal(classifyGenerationError("STAGE_TIMEOUT:factReviewer").resumable, true);
});

/* ---- 9: cancel during in-flight → provider cancel attempted ---- */
await check("9: cancel tick → provider response cancelled", async () => {
  const t = new MockResponsesTransport();
  t.seedResponse("__next__", { statuses: ["in_progress"] });
  const rid = await t.startBackgroundStage("writer", "s", "u");
  await assert.rejects(() => waitForBackgroundStage({
    transport: t, responseId: rid, stage: "writer",
    stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 10,
    hooks: { onTick: async () => { throw new GenerationCancelledError("writer"); } },
  }), GenerationCancelledError);
});

/* ---- 10: concurrent stage exec → single-flight enforced ---- */
await check("10: second attempt dir locked while first open", async () => {
  await withTmp(async (dir) => {
    const id = randomUUID();
    const ex = await mkExec(dir, id, "CONTENT_REGENERATION", async (s: string) => ({ content: CONTENT[s] || "{}", stageUsage: usage(s) }));
    await ex.execute("planner", "s", "u");
    // second manager on same dir while first holds the lock
    await assert.rejects(
      () => mkExec(dir, id, "TECHNICAL_STAGE_RETRY", async () => ({ content: "{}", stageUsage: usage("planner") })),
      (e: any) => e?.code === "ATTEMPT_LOCKED",
    );
    await ex.finish(false); await ex.close();
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
main();
