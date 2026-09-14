/**
 * PHASE SOP-AI-12 — Network-Disabled Runner Mock
 *
 * Verifies the real run-application-pipeline.ts checkpoint/resume behavior
 * WITHOUT making any OpenAI calls. Uses a mock stage executor that simulates
 * stage successes and technical failures.
 *
 * Tests:
 *   1. Stage 6 technical failure → resume from stage 6 (stages 1-5 not rerun)
 *   2. Stage 4 technical failure → resume from stage 4
 *   3. No repeated successful stages
 *   4. No seventh stage
 *   5. Checkpoint invalidation on contract change
 *   6. Partial paid attempts remain in accounting
 *   7. Technical retries costed separately from successful run
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !specifier.endsWith(".ts") && error.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { createStageExecution, EXECUTION_STAGES, StageExecutionError } =
  await import("../src/lib/ai/pipeline/stage-execution.ts");
const { computeHash } = await import("../src/lib/ai/pipeline-checkpoint.ts");

const hashes = {
  generationContractHash: "a".repeat(64),
  studentFactsHash: "b".repeat(64),
  applicationRequirementsHash: "c".repeat(64),
  aiPolicyHash: "d".repeat(64),
  applicationSpecificFactsHash: "e".repeat(16),
  modelConfigurationHash: "f".repeat(64),
  promptVersionHash: "prompt-v12-2026-09-09",
  renderProfileVersion: "1.0.0",
};

function mockUsage(stage: string, costUsd = 0.05) {
  return {
    stage,
    model: "gpt-5.6-sol",
    responseId: `resp-${stage}-${Math.random().toString(36).slice(2, 8)}`,
    durationMs: 100,
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 500,
    totalTokens: 1500,
    reasoningTokens: 100,
    estimatedCostUsd: costUsd,
    success: true,
  };
}

function mockContent(stage: string) {
  if (stage === "planner") return JSON.stringify({ componentPlans: [{ componentId: "A" }] });
  if (stage === "writer") return JSON.stringify({ responses: [{ componentId: "A", text: "Draft text." }] });
  if (stage === "qualityReviewer") return JSON.stringify({
    componentScores: [{ componentId: "A", score: 8, topicCoverage: [], feedback: "" }],
    requirementCompliance: { requiredTopics: "PASS" },
  });
  if (stage === "languageCalibrator") return JSON.stringify({ responses: [{ componentId: "A", text: "Calibrated text." }] });
  if (stage === "finalizer") return JSON.stringify({ responses: [{ componentId: "A", text: "Final text." }] });
  if (stage === "factReviewer") return JSON.stringify({
    components: [{ componentId: "A", pass: true, claims: [], inventedCount: 0, alteredCount: 0, elaborationCount: 0, ambiguousCount: 0 }],
    totalInventedFacts: 0, totalAlteredFacts: 0, totalInterpretiveElaborations: 0, totalAmbiguousClaims: 0, overallPass: true,
  });
  return "{}";
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const tmp = path.join(process.cwd(), "logs", "phase-12b-mock", randomUUID());
  await fs.mkdir(tmp, { recursive: true });
  try {
    await fn(tmp);
  } finally {
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}
  }
}

test("stage 6 technical failure → resume from stage 6 without rerunning stages 1-5", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);
    let callCount = 0;
    const callLog: string[] = [];

    // Run 1: stages 1-5 succeed, stage 6 fails with technical error
    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          callCount++;
          callLog.push(stage);
          if (stage === "factReviewer") {
            throw new StageExecutionError("EMPTY_CONTENT", "factReviewer returned empty content", true);
          }
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      try {
        for (const stage of EXECUTION_STAGES) {
          await exec.execute(stage, "sys", "user");
        }
        assert.fail("Should have thrown at factReviewer");
      } catch (e) {
        assert.ok(e instanceof StageExecutionError);
        assert.equal(e.code, "EMPTY_CONTENT");
      }
      await exec.close();
    }

    assert.equal(callCount, 6, "Run 1 should have made 6 calls (1-5 success + 6 fail)");
    assert.deepEqual(callLog, [...EXECUTION_STAGES], "Run 1 should call all 6 stages in order");

    // Run 2: resume — stages 1-5 should be restored from checkpoints, only stage 6 runs
    callCount = 0;
    callLog.length = 0;
    {
      const exec = await createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          callCount++;
          callLog.push(stage);
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) {
        await exec.execute(stage, "sys", "user");
      }
      await exec.finish(true);
      await exec.close();
    }

    assert.equal(callCount, 1, "Resume should only call stage 6 (stages 1-5 from checkpoint)");
    assert.deepEqual(callLog, ["factReviewer"], "Resume should only call factReviewer");
  });
});

test("stage 4 technical failure → resume from stage 4", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);
    const callLog: string[] = [];

    // Run 1: stages 1-3 succeed, stage 4 fails
    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          callLog.push(stage);
          if (stage === "languageCalibrator") {
            throw new StageExecutionError("TIMEOUT", "languageCalibrator timed out", true);
          }
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      try {
        for (const stage of EXECUTION_STAGES) {
          await exec.execute(stage, "sys", "user");
        }
        assert.fail("Should have thrown at languageCalibrator");
      } catch (e) {
        assert.ok(e instanceof StageExecutionError);
      }
      await exec.close();
    }

    // Run 2: resume — stages 1-3 from checkpoint, 4-6 run
    callLog.length = 0;
    {
      const exec = await createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          callLog.push(stage);
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) {
        await exec.execute(stage, "sys", "user");
      }
      await exec.finish(true);
      await exec.close();
    }

    assert.deepEqual(callLog, ["languageCalibrator", "finalizer", "factReviewer"],
      "Resume should call stages 4-6 only");
  });
});

test("no seventh stage is possible", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);
    const exec = await createStageExecution({
      generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
      call: async (stage, _sys, _user, onUsage) => {
        const usage = mockUsage(stage);
        await onUsage(usage);
        return { content: mockContent(stage), stageUsage: usage };
      },
    });
    for (const stage of EXECUTION_STAGES) {
      await exec.execute(stage, "sys", "user");
    }
    // Attempting a 7th stage should fail
    await assert.rejects(
      () => exec.execute("planner" as any, "sys", "user"),
      (e: any) => e instanceof StageExecutionError && e.code === "STAGE_ORDER_VIOLATION"
    );
    await exec.finish(true);
    await exec.close();
  });
});

test("checkpoint invalidation on contract change", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);

    // Run 1: succeed all 6 stages
    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) {
        await exec.execute(stage, "sys", "user");
      }
      await exec.finish(true);
      await exec.close();
    }

    // Run 2: try to resume with changed contract hash → should be rejected
    const changedHashes = { ...hashes, generationContractHash: "z".repeat(64) };
    await assert.rejects(
      () => createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes: changedHashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      }),
      (e: any) => e instanceof StageExecutionError && e.code === "STALE_CHECKPOINT_REJECTED"
    );
  });
});

test("checkpoint invalidation on prompt version change", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);

    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) {
        await exec.execute(stage, "sys", "user");
      }
      await exec.finish(true);
      await exec.close();
    }

    const changedHashes = { ...hashes, promptVersionHash: "prompt-v13-2026-09-10" };
    await assert.rejects(
      () => createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes: changedHashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      }),
      (e: any) => e instanceof StageExecutionError && e.code === "STALE_CHECKPOINT_REJECTED"
    );
  });
});

test("partial paid attempts remain in accounting", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);

    // Run 1: fail at stage 6
    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          if (stage === "factReviewer") throw new StageExecutionError("EMPTY_CONTENT", "", true);
          const usage = mockUsage(stage, 0.04);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      try {
        for (const stage of EXECUTION_STAGES) await exec.execute(stage, "sys", "user");
      } catch {}
      await exec.close();
      const accounting = exec.accounting();
      assert.equal(accounting.paidApiCalls, 5, "Run 1 should have 5 paid calls");
      assert.equal(accounting.failedPipelineRuns, 1);
      assert.ok(accounting.allAttemptCostUsd > 0, "Partial cost should be recorded");
    }

    // Run 2: resume and succeed
    {
      const exec = await createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage, 0.05);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) await exec.execute(stage, "sys", "user");
      await exec.finish(true);
      await exec.close();
      const accounting = exec.accounting();
      assert.equal(accounting.paidApiCalls, 6, "Total paid calls: 5 partial + 1 resume");
      assert.equal(accounting.successfulPipelineRuns, 1);
      assert.equal(accounting.failedPipelineRuns, 1);
      // With checkpointing, all-attempt cost = partial costs + resume cost.
      // It should NOT include repeated stages 1-5.
      assert.ok(accounting.allAttemptCostUsd >= accounting.successfulRunCostUsd,
        "All-attempt cost should be at least successful run cost");
      assert.ok(accounting.allAttemptCostUsd < 0.30,
        "All-attempt cost should be far less than without checkpointing (~0.48)");
    }
  });
});

test("technical retry cost is separate from successful run cost", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);

    {
      const exec = await createStageExecution({
        generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          if (stage === "factReviewer") throw new StageExecutionError("EMPTY_CONTENT", "", true);
          const usage = mockUsage(stage, 0.04);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      try {
        for (const stage of EXECUTION_STAGES) await exec.execute(stage, "sys", "user");
      } catch {}
      await exec.close();
    }

    {
      const exec = await createStageExecution({
        generationId, mode: "TECHNICAL_STAGE_RETRY", basePath, hashes, exchangeRate: 94.843169,
        call: async (stage, _sys, _user, onUsage) => {
          const usage = mockUsage(stage, 0.05);
          await onUsage(usage);
          return { content: mockContent(stage), stageUsage: usage };
        },
      });
      for (const stage of EXECUTION_STAGES) await exec.execute(stage, "sys", "user");
      await exec.finish(true);
      await exec.close();
      const accounting = exec.accounting();
      assert.ok(accounting.successfulRunCostUsd > 0, "Successful run cost recorded");
      // With checkpointing, all-attempt cost = partial + resume, not 2x full pipeline.
      assert.ok(accounting.allAttemptCostUsd >= accounting.successfulRunCostUsd,
        "All-attempt cost should be at least successful run cost");
      assert.ok(accounting.allAttemptCostUsd < 0.30,
        "All-attempt cost should be far less than without checkpointing (~0.48)");
    }
  });
});

test("durable stage artifacts are saved", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    const basePath = path.join(dir, generationId);

    const exec = await createStageExecution({
      generationId, mode: "CONTENT_REGENERATION", basePath, hashes, exchangeRate: 94.843169,
      call: async (stage, _sys, _user, onUsage) => {
        const usage = mockUsage(stage);
        await onUsage(usage);
        return { content: mockContent(stage), stageUsage: usage };
      },
    });
    for (const stage of EXECUTION_STAGES) await exec.execute(stage, "sys", "user");
    await exec.finish(true);
    await exec.close();

    // Verify checkpoint files exist
    for (let i = 0; i < EXECUTION_STAGES.length; i++) {
      const stage = EXECUTION_STAGES[i];
      const prefix = String(i + 1).padStart(2, "0");
      const checkpointPath = path.join(basePath, `checkpoint-${prefix}-${stage}.json`);
      const rawPath = path.join(basePath, `raw-${prefix}-${stage}.txt`);
      const artifactPath = path.join(basePath, `artifact-${prefix}-${stage}.json`);
      await fs.access(checkpointPath);
      await fs.access(rawPath);
      await fs.access(artifactPath);
    }

    // Verify state and journal
    await fs.access(path.join(basePath, "run-state.json"));
    await fs.access(path.join(basePath, "attempts.jsonl"));
  });
});

test("invalid generation ID is rejected", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => createStageExecution({
        generationId: "not-a-uuid", mode: "CONTENT_REGENERATION",
        basePath: path.join(dir, "not-a-uuid"), hashes, exchangeRate: 94.843169,
        call: async () => ({ content: "{}", stageUsage: mockUsage("planner") }),
      }),
      (e: any) => e instanceof StageExecutionError && e.code === "INVALID_ATTEMPT_PATH"
    );
  });
});

test("basePath must match generation ID", async () => {
  await withTempDir(async (dir) => {
    const generationId = randomUUID();
    await assert.rejects(
      () => createStageExecution({
        generationId, mode: "CONTENT_REGENERATION",
        basePath: path.join(dir, "different-name"), hashes, exchangeRate: 94.843169,
        call: async () => ({ content: "{}", stageUsage: mockUsage("planner") }),
      }),
      (e: any) => e instanceof StageExecutionError && e.code === "INVALID_ATTEMPT_PATH"
    );
  });
});
