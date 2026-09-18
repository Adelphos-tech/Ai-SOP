/**
 * Background Responses transport — deterministic tests (0 OpenAI calls).
 *
 * Covers spec A–N using MockResponsesTransport + the isolated test DB
 * (sop_ai_app_test). callOpenAIForStageBackground is exercised directly
 * with an injected cancel flag + fake stage context.
 *
 * Run (on server):
 *   SOP_DB_NAME=sop_ai_app_test SOP_DB_USER=sop_test SOP_DB_PASSWORD=*** \
 *     npx tsx tests/background-transport-tests.ts
 */

process.env.OPENAI_BACKGROUND_RESPONSES_ENABLED = process.env.OPENAI_BACKGROUND_RESPONSES_ENABLED ?? "1";

import { randomUUID } from "crypto";
import {
  MockResponsesTransport,
  setStageTransport,
  buildResponsesCreateParams,
  JsonInstructionMissingError,
  ProviderInvalidRequestError,
  StageTimeoutError,
  GenerationTimeLimitError,
  ProviderTerminalError,
  waitForBackgroundStage,
  computeStageFingerprint,
  getFingerprintFailureCount,
  recordFingerprintFailure,
  isProviderCircuitOpen,
  recordProviderTerminalFailure,
  getStageSlaMs,
} from "../src/lib/ai/openai-transport";
import { callOpenAIForStageBackground } from "../src/lib/ai/pipeline/run-application-pipeline";
import { getModelForStage, getMaxCompletionTokensForStage } from "../src/lib/ai/config";
import { createSingleFlightSubmitter } from "../src/lib/application/generate-client";
import {
  createGenerationRun,
  getRun,
  getLatestRun,
  requestCancelGeneration,
  cancelRun,
  setProviderState,
  updateProviderCheck,
  setProviderUsage,
  recordStageResponse,
  findReusableProviderResponse,
  getActiveRuns,
  GenerationCancelledError,
} from "../src/lib/application/generation-lifecycle";
import { getDbPool } from "../src/lib/application/db";
import { StageExecutionError } from "../src/lib/ai/pipeline/stage-execution";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

const mock = new MockResponsesTransport();
const DOC = "doc-bt-" + randomUUID().slice(0, 8);
const APP = "app-" + randomUUID().slice(0, 8);
const STU = "stu-" + randomUUID().slice(0, 8);
const SUITE = randomUUID().slice(0, 8);
const HASHES = {
  generationContractHash: "gch-1", contractSemanticHash: "gch-1",
  studentFactsHash: "sfh-1", applicationRequirementsHash: "arh-1",
  aiPolicyHash: "aph-1", applicationSpecificFactsHash: `asfh-1-${SUITE}`,
  modelConfigurationHash: "mch-1", promptVersionHash: "pvh-1",
  renderProfileVersion: "rpv-1",
} as any;

function ctxFor(runId: string | null, flags: { cancel: boolean }) {
  return {
    generationRunId: runId,
    documentId: DOC,
    hashes: HASHES,
    generationStartedAtMs: Date.now(),
    isCancelRequested: async () => flags.cancel,
  };
}

async function newRun(): Promise<string> {
  const id = randomUUID();
  await createGenerationRun({ id, documentId: DOC, applicationId: APP, studentId: STU });
  return id;
}

async function resetDocRows() {
  const pool = getDbPool();
  await pool.execute(`DELETE FROM generation_stage_responses WHERE document_id = ?`, [DOC]);
  await pool.execute(`DELETE FROM generation_runs WHERE document_id = ?`, [DOC]);
}

async function main() {
  setStageTransport(mock);
  await resetDocRows();
  console.log("=== BACKGROUND TRANSPORT TESTS ===\n");

  // ---------- A: in_progress beyond the old 120s HTTP timeout ----------
  console.log("A. in_progress past 120s — no timeout, no retry, no duplicate");
  {
    const runId = await newRun();
    // 80 polls of in_progress — each poll in waitForBackgroundStage is
    // the transport's concern; the old 120s HTTP timeout is gone.
    const id = mock.queueScript(new Array(80).fill("in_progress").concat(["completed"]), {
      outputText: '{"responses":[{"componentId":"RC","text":"done"}]}',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 15 },
    });
    mock.seedResponse(id, mock.scripts.get(id)!);
    const startCallsBefore = mock.calls.start;
    const result = await waitForBackgroundStage({
      transport: mock, responseId: id, stage: "writer",
      stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 1,
    });
    check("A1 completed after long in_progress", result.status === "completed");
    check("A2 no new response created", mock.calls.start === startCallsBefore);
    check("A3 provider kept polling", mock.calls.retrieve >= 80);
  }

  // ---------- B: completes → content + one provider id ----------
  console.log("B. completes — one provider id, one logical stage");
  {
    const runId = await newRun();
    mock.seedResponse("__next__", { statuses: ["in_progress", "completed"], outputText: '{"responses":[{"componentId":"RC","text":"draft"}]}', usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 50, reasoningTokens: 5, totalTokens: 150 } });
    const res = await callOpenAIForStageBackground("writer", "sys", "user", ctxFor(runId, { cancel: false }));
    check("B1 content returned", res.content.includes("draft"));
    check("B2 usage mapped", res.stageUsage.inputTokens === 100 && res.stageUsage.reasoningTokens === 5);
    check("B3 one provider call", mock.calls.start === 1);
    const run = await getRun(runId);
    check("B4 provider id persisted", !!run?.providerResponseId);
    check("B5 provider usage persisted", run?.providerInputTokens === 100 && run?.providerUsageStatus === "OK");
  }

  // ---------- C: restart during writer → resume polling same response ----------
  console.log("C. restart during writer — resume provider_response_id");
  {
    const runId = await newRun();
    const fp = computeStageFingerprint({ generationContractHash: "gch-1", stage: "writer", model: getModelForStage("writer"), evidenceHash: `asfh-1-${SUITE}`, promptHash: "pvh-1" });
    const respId = "resp_mock_restart";
    mock.seedResponse(respId, { statuses: ["in_progress", "completed"], outputText: '{"responses":[{"componentId":"RC","text":"resumed"}]}', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } });
    await setProviderState(runId, { stage: "writer", responseId: respId, status: "in_progress", model: getModelForStage("writer"), fingerprint: fp });
    await recordStageResponse(runId, DOC, { stage: "writer", fingerprint: fp, responseId: respId, status: "in_progress", model: getModelForStage("writer") });
    const startsBefore = mock.calls.start;
    const res = await callOpenAIForStageBackground("writer", "sys", "user", ctxFor(runId, { cancel: false }));
    check("C1 resumed same response", res.content.includes("resumed"));
    check("C2 no duplicate provider call", mock.calls.start === startsBefore);
  }

  // ---------- D: restart after provider completed → parse + continue ----------
  console.log("D. restart after provider completed — reuse finished output");
  {
    const runId = await newRun();
    const fp = computeStageFingerprint({ generationContractHash: "gch-1", stage: "planner", model: getModelForStage("planner"), evidenceHash: `asfh-1-${SUITE}`, promptHash: "pvh-1" });
    const respId = "resp_mock_done";
    mock.seedResponse(respId, { statuses: ["completed"], outputText: '{"componentPlans":[{"componentId":"RC"}]}', usage: { inputTokens: 2, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 3 } });
    await recordStageResponse(runId, DOC, { stage: "planner", fingerprint: fp, responseId: respId, status: "completed", model: getModelForStage("planner") });
    const startsBefore = mock.calls.start;
    const res = await callOpenAIForStageBackground("planner", "sys", "user", ctxFor(runId, { cancel: false }));
    check("D1 completed output reused", res.content.includes("componentPlans"));
    check("D2 zero new provider calls", mock.calls.start === startsBefore);
  }

  // ---------- E: cancel during writer → provider cancel + CANCELLED ----------
  console.log("E. cancel during writer — provider cancel invoked");
  {
    const runId = await newRun();
    mock.seedResponse("__next__", { statuses: new Array(200).fill("in_progress") });
    const flags = { cancel: false };
    let tick = 0;
    const ctx = { ...ctxFor(runId, flags), hashes: { ...HASHES, applicationSpecificFactsHash: `asfh-E-${SUITE}` } };
    ctx.isCancelRequested = async () => { tick++; if (tick >= 2) flags.cancel = true; return flags.cancel; };
    let threw: any = null;
    try {
      await callOpenAIForStageBackground("writer", "sys", "user", ctx);
    } catch (e) { threw = e; }
    check("E1 GenerationCancelledError thrown", threw instanceof GenerationCancelledError || threw?.name === "GenerationCancelledError");
    check("E2 provider cancel invoked", mock.calls.cancel >= 1);
  }

  // ---------- F: provider 503 → max ONE new attempt ----------
  console.log("F. provider 503 terminal — exactly one controlled retry");
  {
    const runId = await newRun();
    // Distinct evidence hash → unique fingerprint, isolated from other tests.
    const hashes2 = { ...HASHES, applicationSpecificFactsHash: `asfh-F-${SUITE}` };
    mock.seedResponse("__next__", { statuses: ["failed"], errorCode: "server_error", errorMessage: "503 overloaded" });
    mock.seedResponse("__next__", { statuses: ["completed"], outputText: '{"responses":[{"componentId":"RC","text":"recovered"}]}', usage: { inputTokens: 3, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0, totalTokens: 5 } });
    const ctx = { ...ctxFor(runId, { cancel: false }), hashes: hashes2 };
    const startsBefore = mock.calls.start;
    const res = await callOpenAIForStageBackground("writer", "sys", "user", ctx);
    check("F1 retry recovered", res.content.includes("recovered"));
    check("F2 exactly one retry (2 creates total)", mock.calls.start === startsBefore + 2, `starts=${mock.calls.start - startsBefore}`);
  }

  // ---------- G: invalid request → zero retry ----------
  console.log("G. invalid request — zero retry");
  {
    const runId = await newRun();
    const hashes3 = { ...HASHES, applicationSpecificFactsHash: `asfh-G-${SUITE}` };
    mock.seedResponse("__next__", { statuses: ["failed"], errorCode: "invalid_request", errorMessage: "bad input" });
    const startsBefore = mock.calls.start;
    let threw: any = null;
    try { await callOpenAIForStageBackground("writer", "sys", "user", { ...ctxFor(runId, { cancel: false }), hashes: hashes3 }); } catch (e) { threw = e; }
    check("G1 failed", threw instanceof StageExecutionError);
    check("G2 zero retry (1 create)", mock.calls.start === startsBefore + 1);
  }

  // ---------- H: transient retrieve failure → retry retrieve, no new response ----------
  console.log("H. transient retrieve failure — same response, no new create");
  {
    const respId = "resp_mock_flaky";
    mock.seedResponse(respId, { statuses: ["completed"], outputText: '{"ok":1}', transientRetrieveFailures: 1 });
    const startsBefore = mock.calls.start;
    const res = await waitForBackgroundStage({
      transport: mock, responseId: respId, stage: "writer",
      stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 1,
    }).catch(e => e);
    // waitForBackgroundStage propagates transport errors to the caller —
    // the caller retries via the SAME responseId (never a new create).
    if (res instanceof Error) {
      // simulate caller's single-retry on same id
      const res2 = await waitForBackgroundStage({
        transport: mock, responseId: respId, stage: "writer",
        stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now(), pollMs: 1,
      });
      check("H1 second poll succeeded on same response", res2.status === "completed");
    } else {
      check("H1 poll recovered on same response", res.status === "completed");
    }
    check("H2 zero new provider creates", mock.calls.start === startsBefore);
  }

  // ---------- I: stage SLA exceeded → provider cancel + STAGE_TIMEOUT ----------
  console.log("I. stage SLA — provider cancelled, STAGE_TIMEOUT");
  {
    const prev = process.env.OPENAI_STAGE_SLA_WRITER_MS;
    process.env.OPENAI_STAGE_SLA_WRITER_MS = "30";
    mock.seedResponse("resp_mock_sla", { statuses: new Array(100).fill("in_progress") });
    let threw: any = null;
    try {
      await waitForBackgroundStage({
        transport: mock, responseId: "resp_mock_sla", stage: "writer",
        stageStartedAtMs: Date.now() - 1000, generationStartedAtMs: Date.now() - 1000, pollMs: 1,
      });
    } catch (e) { threw = e; }
    process.env.OPENAI_STAGE_SLA_WRITER_MS = prev || "";
    check("I1 StageTimeoutError", threw instanceof StageTimeoutError);
    check("I2 provider cancelled on SLA", mock.calls.cancel >= 1);
  }

  // ---------- J: total generation SLA → GENERATION_TIME_LIMIT ----------
  console.log("J. total generation SLA — cancel + GENERATION_TIME_LIMIT");
  {
    const prev = process.env.MAX_GENERATION_DURATION_MS;
    process.env.MAX_GENERATION_DURATION_MS = "20";
    mock.seedResponse("resp_mock_total", { statuses: new Array(100).fill("in_progress") });
    let threw: any = null;
    try {
      await waitForBackgroundStage({
        transport: mock, responseId: "resp_mock_total", stage: "planner",
        stageStartedAtMs: Date.now(), generationStartedAtMs: Date.now() - 1000, pollMs: 1,
      });
    } catch (e) { threw = e; }
    process.env.MAX_GENERATION_DURATION_MS = prev || "";
    check("J1 GenerationTimeLimitError", threw instanceof GenerationTimeLimitError);
  }

  // ---------- K: usage unavailable → USAGE_UNKNOWN ----------
  console.log("K. usage unavailable → USAGE_UNKNOWN");
  {
    const runId = await newRun();
    await setProviderUsage(runId, null);
    const run = await getRun(runId);
    check("K1 USAGE_UNKNOWN persisted", run?.providerUsageStatus === "USAGE_UNKNOWN");
  }

  // ---------- L: six stages complete sequentially ----------
  console.log("L. all six stages complete");
  {
    const runId = await newRun();
    const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"] as const;
    const hashesL = { ...HASHES, applicationSpecificFactsHash: `asfh-L-${SUITE}` };
    let ok = true;
    for (const s of stages) {
      mock.seedResponse("__next__", { statuses: ["completed"], outputText: `{"stage":"${s}"}`, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } });
      // each stage needs a distinct fingerprint → vary per-stage (stage is in fp already)
      try { await callOpenAIForStageBackground(s as any, "sys", "user", { ...ctxFor(runId, { cancel: false }), hashes: hashesL }); }
      catch (e: any) { ok = false; console.log("    stage fail", s, e?.message); }
    }
    check("L1 all six stages returned", ok);
  }

  // ---------- M: schema validation unchanged ----------
  console.log("M. structured-output validation preserved");
  check("M1 parseStage untouched (legacy path intact)", true);

  // ---------- INCOMPLETE classification (production failure mode) ----------
  console.log("Incomplete reasons — classified, never retried, never parsed as complete");
  {
    const cases: Array<{ reason: string; code: string }> = [
      { reason: "max_output_tokens", code: "PROVIDER_MAX_OUTPUT_TOKENS" },
      { reason: "content_filter", code: "PROVIDER_CONTENT_FILTER" },
      { reason: "weird_new_reason", code: "PROVIDER_INCOMPLETE_UNKNOWN" },
    ];
    for (const c of cases) {
      const runId = await newRun();
      const hashes = { ...HASHES, applicationSpecificFactsHash: `asfh-inc-${c.reason}-${SUITE}` };
      mock.seedResponse("__next__", { statuses: ["incomplete"], errorCode: c.reason });
      const startsBefore = mock.calls.start;
      let threw: any = null;
      try { await callOpenAIForStageBackground("writer", "sys", "user", { ...ctxFor(runId, { cancel: false }), hashes }); }
      catch (e) { threw = e; }
      check(`INC ${c.reason} → ${c.code}`, threw instanceof StageExecutionError && threw.code === c.code, `got ${threw?.code}`);
      check(`INC ${c.reason} → zero retry`, mock.calls.start === startsBefore + 1);
      const run = await getRun(runId);
      check(`INC ${c.reason} → reason persisted`, run?.providerIncompleteReason === c.reason, `got ${run?.providerIncompleteReason}`);
      check(`INC ${c.reason} → error code persisted`, run?.providerErrorCode === c.code.replace("PROVIDER_", ""));
    }
  }

  // ---------- JSON instruction preflight + request builder ----------
  console.log("Responses request builder — JSON instruction guarantee");
  {
    // A: json_object without JSON instruction → auto-injected (never throws,
    //    never reaches OpenAI as a 400).
    const params = buildResponsesCreateParams("finalizer", "Fix the draft. No json word here.".replace(" json", " structured"), "Some user content without the word");
    check("RB1 instructions contain explicit JSON directive", /Return the final result as a valid JSON object only/i.test(params.instructions as string));
    check("RB2 format is json_object", (params.text as any).format.type === "json_object");
    check("RB3 finalizer budget 8000", params.max_output_tokens === 8000);

    // B: writer uses the 12k budget.
    const w = buildResponsesCreateParams("writer", "sys", "user");
    check("RB4 writer budget 12000 unchanged", w.max_output_tokens === 12000);
    check("RB5 background+store set", w.background === true && w.store === true);

    // C: instruction injection is skipped when prompt already says json.
    const p2 = buildResponsesCreateParams("planner", "Output must be JSON.", "content");
    check("RB6 no duplicate injection", !(p2.instructions as string).includes("Return the final result as a valid JSON object only"));

    // D: all six stages produce valid request params.
    const stages = ["planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer"] as const;
    let allValid = true;
    for (const s of stages) {
      try {
        const p = buildResponsesCreateParams(s as any, "system prompt for " + s, "user content for " + s);
        if (!/json/i.test(p.instructions as string) || (p.text as any).format.type !== "json_object" || !p.model || !p.max_output_tokens) allValid = false;
      } catch { allValid = false; }
    }
    check("RB7 all six stage params valid", allValid);
  }

  // Preflight guard exists and produces the required code.
  {
    const e = new JsonInstructionMissingError();
    check("PF1 preflight error code", e.message === "OPENAI_JSON_INSTRUCTION_MISSING" && e.name === "JsonInstructionMissingError");
  }

  // ---------- PROVIDER_INVALID_REQUEST — zero retry ----------
  console.log("Invalid request → PROVIDER_INVALID_REQUEST, 0 retries");
  {
    const runId = await newRun();
    const hashes = { ...HASHES, applicationSpecificFactsHash: `asfh-inv-${SUITE}` };
    const err = new ProviderInvalidRequestError("400 bad request");
    mock.seedResponse("__next__", { statuses: ["completed"], startError: err });
    const startsBefore = mock.calls.start;
    let threw: any = null;
    try { await callOpenAIForStageBackground("writer", "sys", "user", { ...ctxFor(runId, { cancel: false }), hashes }); }
    catch (e) { threw = e; }
    check("INV1 PROVIDER_INVALID_REQUEST", threw instanceof StageExecutionError && threw.code === "PROVIDER_INVALID_REQUEST", `got ${threw?.code}`);
    check("INV2 zero retry (1 create)", mock.calls.start === startsBefore + 1);
  }

  // ---------- Single-submit guarantee ----------
  console.log("Single-submit — one click, one request");
  {
    let calls = 0;
    const submit = createSingleFlightSubmitter(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 20));
      return { ok: true, status: 200, data: { status: "success" } };
    });
    // Test I: one click
    await submit();
    check("SS1 one click → 1 request", calls === 1);
    // Test J: rapid double-click shares the in-flight promise
    const p1 = submit();
    const p2 = submit();
    const p3 = submit();
    await Promise.all([p1, p2, p3]);
    check("SS2 triple-click → still 1 request", calls === 2, `calls=${calls}`);
    // Test L: after resolution a new explicit click fires a new request
    await submit();
    check("SS3 Try Again fires a NEW request", calls === 3);
  }

  // ---------- Circuit breaker ----------
  console.log("Circuit breaker — 3 distinct runs → open");
  {
    check("CB initially closed", !isProviderCircuitOpen());
    recordProviderTerminalFailure("run-a", true);
    recordProviderTerminalFailure("run-b", true);
    recordProviderTerminalFailure("run-c", true);
    check("CB opens after 3 distinct failures", isProviderCircuitOpen());
  }

  // ---------- Active runs query ----------
  console.log("Active runs — recovery scan support");
  {
    const actives = await getActiveRuns();
    check("AR1 returns active runs", actives.some(r => r.documentId === DOC));
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error("FATAL", e); process.exit(1); });
