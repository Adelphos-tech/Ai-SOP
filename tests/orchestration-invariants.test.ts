/**
 * ORCHESTRATION INVARIANT TESTS — deterministic, zero provider calls.
 *
 * Exercises the real StageExecution manager (cursor, locks, checkpoints,
 * resume) with an injected stub `call`. Verifies:
 *  - canonical stage order 1→6
 *  - out-of-order stage rejection (STAGE_ORDER_VIOLATION)
 *  - skip() advances the cursor without a provider call
 *  - no double execution of a skipped stage
 *  - cross-invocation file lock (ATTEMPT_LOCKED)
 *  - TECHNICAL_STAGE_RETRY replays persisted checkpoints without new calls
 */
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import assert from "node:assert";
import { createStageExecution, EXECUTION_STAGES, StageExecutionError, type ExecutionStage } from "../src/lib/ai/pipeline/stage-execution";

const HASHES = {
  generationContractHash: "h-gc", contractSemanticHash: "h-cs", studentFactsHash: "h-sf",
  applicationRequirementsHash: "h-ar", aiPolicyHash: "h-ap", applicationSpecificFactsHash: "h-af",
  modelConfigurationHash: "h-mc", promptVersionHash: "h-pv", renderProfileVersion: "h-rp",
};

const usage = (stage: ExecutionStage) => ({
  stage, model: "stub", responseId: `stub-${randomUUID()}`, success: true,
  durationMs: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2,
  reasoningTokens: 0, estimatedCostUsd: 0,
});

const OUTPUTS: Record<ExecutionStage, any> = {
  planner: { componentPlans: [{ componentId: "RC-DOC" }] },
  writer: { responses: [{ componentId: "RC-DOC", text: "draft" }] },
  qualityReviewer: { componentScores: [{ componentId: "RC-DOC", score: 8, topicCoverage: [], factualRiskClaims: [], wordCompliance: "PASS", characterCompliance: "N/A" }], overall_score: 8, requirementCompliance: {} },
  languageCalibrator: { responses: [{ componentId: "RC-DOC", text: "styled" }] },
  finalizer: { responses: [{ componentId: "RC-DOC", text: "final", retainedClaimIds: [], removedClaimIds: [], repairClaims: [] }] },
  factReviewer: { components: [{ componentId: "RC-DOC", pass: true, claims: [] }], overallPass: true },
};

function makeCall(counters: Map<string, number>, failAt?: ExecutionStage) {
  return async (stage: ExecutionStage) => {
    counters.set(stage, (counters.get(stage) || 0) + 1);
    if (stage === failAt) { const e: any = new Error("boom"); e.status = 500; throw e; }
    return { content: JSON.stringify(OUTPUTS[stage]), stageUsage: usage(stage) };
  };
}

async function makeExec(mode: "CONTENT_REGENERATION" | "TECHNICAL_STAGE_RETRY", generationId: string, base: string, counters: Map<string, number>, failAt?: ExecutionStage) {
  return createStageExecution({
    generationId, mode,
    basePath: path.join(base, generationId),
    hashes: HASHES as any, exchangeRate: 90,
    call: makeCall(counters, failAt) as any,
  });
}

const results: string[] = [];
const check = (name: string, fn: () => void) => {
  try { fn(); results.push(`PASS  ${name}`); }
  catch (e: any) { results.push(`FAIL  ${name} — ${e.message}`); }
};

async function main() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "orch-"));

  // 1. Canonical order works
  {
    const gid = randomUUID(); const counters = new Map();
    const exec = await makeExec("CONTENT_REGENERATION", gid, base, counters);
    for (const stage of EXECUTION_STAGES) await exec.execute(stage, "s", "u");
    await exec.finish(true);
    await exec.close();
    check("normal 1→6 order", () => assert.strictEqual(counters.size, 6));
  }

  // 2. Out-of-order stage rejected before provider call
  {
    const gid = randomUUID(); const counters = new Map();
    const exec = await makeExec("CONTENT_REGENERATION", gid, base, counters);
    let code = "";
    try { await exec.execute("writer", "s", "u"); } catch (e: any) { code = e.code; }
    check("writer before planner rejected (no provider call)", () => {
      assert.strictEqual(code, "STAGE_ORDER_VIOLATION");
      assert.strictEqual(counters.size, 0);
    });
  }

  // 3. skip() advances cursor with zero provider calls; stage 6 runs
  {
    const gid = randomUUID(); const counters = new Map();
    const exec = await makeExec("CONTENT_REGENERATION", gid, base, counters);
    for (const stage of EXECUTION_STAGES.slice(0, 4)) await exec.execute(stage, "s", "u");
    await exec.skip("finalizer", OUTPUTS.finalizer, { freezeComponentIds: new Set(["RC-DOC"]) });
    await exec.execute("factReviewer", "s", "u");
    await exec.finish(true);
    await exec.close();
    check("skip advances cursor, no finalizer provider call, factReviewer runs", () => {
      assert.strictEqual(counters.get("finalizer") || 0, 0);
      assert.strictEqual(counters.get("factReviewer"), 1);
    });
  }

  // 4. Cannot execute a stage that was already skipped
  {
    const gid = randomUUID(); const counters = new Map();
    const exec = await makeExec("CONTENT_REGENERATION", gid, base, counters);
    for (const stage of EXECUTION_STAGES.slice(0, 4)) await exec.execute(stage, "s", "u");
    await exec.skip("finalizer", OUTPUTS.finalizer, { freezeComponentIds: new Set(["RC-DOC"]) });
    let code = "";
    try { await exec.execute("finalizer", "s", "u"); } catch (e: any) { code = e.code; }
    check("execute on skipped stage rejected", () => {
      assert.strictEqual(code, "STAGE_ORDER_VIOLATION");
      assert.strictEqual(counters.get("finalizer") || 0, 0);
    });
  }

  // 5. Duplicate worker on same generation dir is locked out
  {
    const gid = randomUUID(); const counters = new Map();
    await makeExec("CONTENT_REGENERATION", gid, base, counters);
    let code = "";
    try { await makeExec("CONTENT_REGENERATION", gid, base, counters); } catch (e: any) { code = e.code; }
    check("duplicate executor → ATTEMPT_LOCKED", () => assert.strictEqual(code, "ATTEMPT_LOCKED"));
  }

  // 6. Resume: crash at writer — TECHNICAL_STAGE_RETRY replays planner
  //    checkpoint with zero provider calls, then retries writer once.
  {
    const gid = randomUUID(); const counters = new Map();
    const exec1 = await makeExec("CONTENT_REGENERATION", gid, base, counters, "writer");
    await exec1.execute("planner", "s", "u");
    try { await exec1.execute("writer", "s", "u"); } catch { /* technical */ }
    await exec1.finish(false);
    await exec1.close();

    const exec2 = await makeExec("TECHNICAL_STAGE_RETRY", gid, base, counters);
    const plannerCallsBefore = counters.get("planner") || 0;
    await exec2.execute("planner", "s", "u");   // replayed from checkpoint
    await exec2.execute("writer", "s", "u");    // real retry
    check("resume replays planner checkpoint, retries writer exactly once", () => {
      assert.strictEqual(counters.get("planner"), plannerCallsBefore);   // no dup call
      assert.strictEqual(counters.get("writer"), 2);                     // 1 fail + 1 retry
    });
    await exec2.finish(false);
    await exec2.close();
  }

  // 7. finish(true) then further execute → closed
  {
    const gid = randomUUID(); const counters = new Map();
    const exec = await makeExec("CONTENT_REGENERATION", gid, base, counters);
    await exec.execute("planner", "s", "u");
    await exec.finish(false);
    await exec.close();
    let code = "";
    try { await exec.execute("writer", "s", "u"); } catch (e: any) { code = e.code; }
    check("closed executor rejects stages", () => assert.strictEqual(code, "EXECUTION_CLOSED"));
  }

  console.log("\nORCHESTRATION INVARIANT TEST\n");
  let fails = 0;
  for (const r of results) { console.log(r); if (r.startsWith("FAIL")) fails++; }
  console.log(`\n${results.length - fails}/${results.length} PASS · provider calls: 0`);
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
