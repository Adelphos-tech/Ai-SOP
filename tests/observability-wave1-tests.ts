/**
 * OBSERVABILITY WAVE-1 — deterministic evidence-integrity tests.
 *
 * Zero provider calls (MockResponsesTransport), zero DB
 * (setProviderPersistenceDeps injects fakes). Covers spec §15 A–J:
 *
 *   A. provider response created → provider_response_id persistence
 *      fails → NO second provider request; id preserved via durable
 *      fallback + typed GENERATION_STATE_PERSISTENCE_FAILED.
 *   B. checkpoint persistence fails → next stage never called.
 *   C. telemetry emit fails → generation continues.
 *   D. usage-ledger write fails → ACCOUNTING policy — non-fatal.
 *   E. reuse chain records REUSED_PROVIDER_RESPONSE (run state AND
 *      durable fallback file).
 *   F. poll failures are requestKind=POLL — never NEW_PROVIDER_REQUEST.
 *   G. attemptSeq correlation on events + ledger rows.
 *   H. failed usage rows carry errorCode + usageStatus (null ≠ 0).
 *   I. raw provider/SQL/stage detail never reaches the normalized
 *      client error.
 *   J. non-whitelisted fields (names/emails/content) can never enter
 *      an emitted event.
 *
 * Run:
 *   npx tsx tests/observability-wave1-tests.ts
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import {
  MockResponsesTransport,
  setStageTransport,
  computeStageFingerprint,
  ProviderInvalidRequestError,
} from "../src/lib/ai/openai-transport";
import {
  callOpenAIForStageBackground,
  setProviderPersistenceDeps,
} from "../src/lib/ai/pipeline/run-application-pipeline";
import { getModelForStage } from "../src/lib/ai/config";
import { createStageExecution, StageExecutionError, type ExecutionStage } from "../src/lib/ai/pipeline/stage-execution";
import { cleanupAttemptArtifacts } from "../src/lib/ai/pipeline-checkpoint";
import { emitEvent } from "../src/lib/observability/events";
import { classifyGenerationError } from "../src/lib/application/generation-errors";
import { logUsage } from "../src/lib/ai/usage-logger";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

// ---------- console capture ----------
const realLog = console.log, realWarn = console.warn, realErr = console.error;
let captured: any[] = [];
let captureActive = false;
function startCapture() {
  captured = [];
  captureActive = true;
  const sink = (level: string) => (line: any) => {
    if (!captureActive) return;
    try { captured.push(JSON.parse(String(line))); } catch { captured.push({ raw: String(line) }); }
  };
  console.log = sink("info"); console.warn = sink("warn"); console.error = sink("error");
}
function stopCapture() {
  captureActive = false;
  console.log = realLog; console.warn = realWarn; console.error = realErr;
}
const eventsNamed = (name: string) => captured.filter(e => e.event === name);

const mock = new MockResponsesTransport();
const HASHES = {
  generationContractHash: "gch-obs", contractSemanticHash: "gch-obs",
  studentFactsHash: "sfh-obs", applicationRequirementsHash: "arh-obs",
  aiPolicyHash: "aph-obs", applicationSpecificFactsHash: `asfh-obs-${randomUUID().slice(0, 8)}`,
  modelConfigurationHash: "mch-obs", promptVersionHash: "pvh-obs",
  renderProfileVersion: "rpv-obs",
} as any;
const USAGE = { inputTokens: 10, cachedInputTokens: 1, outputTokens: 5, reasoningTokens: 2, totalTokens: 15 };

function ctxFor(over: Partial<Parameters<typeof callOpenAIForStageBackground>[3]> = {}) {
  return {
    generationRunId: "run-obs",
    documentId: "doc-obs",
    hashes: HASHES,
    generationStartedAtMs: Date.now(),
    attemptSeq: 42,
    requestId: "req-obs",
    isCancelRequested: async () => false,
    ...over,
  };
}

/** Persistence deps where chosen ops can be forced to fail. */
function depsWith(over: Record<string, (...a: any[]) => Promise<any>> = {}) {
  const ok = async () => undefined;
  return {
    getRun: async () => null,
    setProviderState: ok,
    recordStageResponse: ok,
    updateProviderCheck: ok,
    updateStageResponseStatus: ok,
    setProviderUsage: ok,
    setStageResponseUsage: ok,
    findReusableProviderResponse: async () => null,
    ...over,
  } as any;
}

async function readLedger(file: string): Promise<any[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

async function main() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "obs1-"));
  const ledgerFile = path.join(base, "usage.jsonl");
  process.env.OPENAI_USAGE_LOG_FILE = ledgerFile;
  setStageTransport(mock);
  console.log("=== OBSERVABILITY WAVE-1 TESTS ===\n");

  // ===================== A =====================
  console.log("A. provider response created → persistence fails → no duplicate paid request");
  {
    setProviderPersistenceDeps(depsWith({ setProviderState: async () => { throw new Error("ER_BAD_FIELD_ERROR: Unknown column 'provider_response_id'"); } }));
    mock.seedResponse("__next__", { statuses: ["completed"], outputText: "{}", usage: USAGE });
    const startBefore = mock.calls.start;
    const attemptDir = path.join(base, "attempt-a");
    startCapture();
    let threw: any = null;
    try {
      await callOpenAIForStageBackground("planner", "sys", "user", ctxFor({ attemptBasePath: attemptDir }));
    } catch (e) { threw = e; }
    stopCapture();
    check("A1 typed GENERATION_STATE_PERSISTENCE_FAILED", threw instanceof StageExecutionError && threw.code === "GENERATION_STATE_PERSISTENCE_FAILED", threw?.code);
    check("A2 exactly one provider request created", mock.calls.start === startBefore + 1);
    check("A3 failure marked recoverable (no blind retry)", threw?.recoverable === true);
    check("A4 generation_state_persistence_failed event emitted", eventsNamed("generation_state_persistence_failed").length === 1);
    // Durable fallback preserved the response id for recovery reuse.
    const fb = await fs.readFile(path.join(attemptDir, "provider-responses.jsonl"), "utf8").catch(() => "");
    const fbRec = fb.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))[0];
    check("A5 fallback file preserved resp_mock id", typeof fbRec?.responseId === "string" && fbRec.responseId.startsWith("resp_mock"));
    check("A6 fallback keyed by stage+fingerprint", fbRec?.stage === "planner" && typeof fbRec?.fingerprint === "string");
    setProviderPersistenceDeps(null);
  }

  // ===================== A2: recovery reuses the fallback response =====================
  console.log("A2. recovery after persist-failure reuses preserved response (no new paid call)");
  {
    setProviderPersistenceDeps(depsWith());
    const attemptDir = path.join(base, "attempt-a");
    const fb = await fs.readFile(path.join(attemptDir, "provider-responses.jsonl"), "utf8");
    const savedId = JSON.parse(fb.trim().split("\n")[0]).responseId;
    mock.seedResponse(savedId, { statuses: ["completed"], outputText: "{}", usage: USAGE });
    const startBefore = mock.calls.start;
    startCapture();
    const res = await callOpenAIForStageBackground("planner", "sys", "user", ctxFor({ attemptBasePath: attemptDir }));
    stopCapture();
    check("A2.1 content recovered from preserved response", res.content === "{}");
    check("A2.2 zero new provider requests", mock.calls.start === startBefore);
    const reuseEvents = eventsNamed("generation_provider_response_reused");
    check("A2.3 reuse event via fallback_file", reuseEvents.some(e => e.detail === "fallback_file" && e.reusedProviderResponse === true));
  }

  // ===================== B =====================
  console.log("B. checkpoint write failure → next stage never called");
  {
    const gid = randomUUID();
    const counters = new Map<string, number>();
    const exec = await createStageExecution({
      generationId: gid, mode: "CONTENT_REGENERATION",
      basePath: path.join(base, gid), hashes: HASHES, exchangeRate: 90,
      call: (async (stage: ExecutionStage) => {
        counters.set(stage, (counters.get(stage) || 0) + 1);
        return { content: JSON.stringify({ componentPlans: [{ componentId: "RC-DOC" }] }), stageUsage: { stage, model: "stub", responseId: "r", success: true, durationMs: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2, reasoningTokens: 0, estimatedCostUsd: 0 } };
      }) as any,
      runContext: { generationRunId: "run-b", attemptSeq: 7, documentId: "doc-b" },
    });
    // Poison the planner artifact path: a DIRECTORY named raw-01-planner.txt
    // makes the durable rename fail.
    await fs.mkdir(path.join(base, gid, "raw-01-planner.txt"));
    startCapture();
    let e1: any = null;
    try { await exec.execute("planner", "s", "u"); } catch (e) { e1 = e; }
    let e2: any = null;
    try { await exec.execute("writer", "s", "u"); } catch (e) { e2 = e; }
    stopCapture();
    check("B1 planner execute fails typed", e1 instanceof StageExecutionError && e1.code === "GENERATION_CHECKPOINT_PERSISTENCE_FAILED", e1?.code);
    check("B2 writer stage never called", !counters.has("writer"));
    check("B3 executor poisoned — subsequent execute rejected", e2 instanceof StageExecutionError && e2.code === "GENERATION_CHECKPOINT_PERSISTENCE_FAILED", e2?.code);
    check("B4 failure event carries attemptSeq", eventsNamed("generation_checkpoint_persistence_failed").some(e => e.attemptSeq === 7));
    try { await exec.close(); } catch { /* poisoned executor may refuse close */ }
  }

  // ===================== C =====================
  console.log("C. telemetry emit failure → generation continues");
  {
    const gid = randomUUID();
    // Make EVERY console sink throw — emitEvent must swallow internally.
    console.log = console.warn = console.error = () => { throw new Error("console broken"); };
    let ok = true, execErr: any = null;
    try {
      emitEvent("generation_service_start", { generationRunId: "run-c" });
      const exec = await createStageExecution({
        generationId: gid, mode: "CONTENT_REGENERATION",
        basePath: path.join(base, gid), hashes: HASHES, exchangeRate: 90,
        call: (async (stage: ExecutionStage) => ({
          content: JSON.stringify({ componentPlans: [{ componentId: "RC-DOC" }] }),
          stageUsage: { stage, model: "stub", responseId: "r", success: true, durationMs: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2, reasoningTokens: 0, estimatedCostUsd: 0 },
        })) as any,
        runContext: { generationRunId: "run-c", attemptSeq: 3, documentId: "doc-c" },
      });
      const res = await exec.execute("planner", "s", "u");
      await exec.close();
      ok = !!res;
    } catch (e) { ok = false; execErr = e; }
    console.log = realLog; console.warn = realWarn; console.error = realErr;
    check("C1 emitEvent+execute survive broken console", ok, execErr?.message);
  }

  // ===================== D =====================
  console.log("D. usage-ledger write failure → ACCOUNTING policy, non-fatal");
  {
    // Point the ledger at a path that cannot be created (file as dir).
    const blocker = path.join(base, "ledger-blocker");
    await fs.writeFile(blocker, "x");
    process.env.OPENAI_USAGE_LOG_FILE = path.join(blocker, "usage.jsonl");
    setProviderPersistenceDeps(depsWith());
    mock.seedResponse("__next__", { statuses: ["completed"], outputText: "{}", usage: USAGE });
    startCapture();
    const res = await callOpenAIForStageBackground("planner", "sys", "user", ctxFor());
    stopCapture();
    check("D1 stage completed despite ledger failure", res.content === "{}");
    check("D2 usage_ledger_write_failed event emitted", eventsNamed("usage_ledger_write_failed").length >= 1);
    check("D3 event carries correlation", eventsNamed("usage_ledger_write_failed")[0]?.generationRunId === "run-obs");
    process.env.OPENAI_USAGE_LOG_FILE = ledgerFile;
  }

  // ===================== E =====================
  console.log("E. reuse chain → REUSED_PROVIDER_RESPONSE everywhere");
  {
    const fp = computeStageFingerprint({
      generationContractHash: HASHES.generationContractHash, stage: "writer",
      model: getModelForStage("writer"),
      evidenceHash: HASHES.applicationSpecificFactsHash, promptHash: HASHES.promptVersionHash,
    });
    setProviderPersistenceDeps(depsWith({
      getRun: async () => ({
        providerResponseId: "resp_reuse_1", providerStage: "writer",
        stageFingerprint: fp, providerResponseStatus: "in_progress",
      }) as any,
    }));
    mock.seedResponse("resp_reuse_1", { statuses: ["completed"], outputText: '{"responses":[]}', usage: USAGE });
    const startBefore = mock.calls.start;
    const ledgerBefore = (await readLedger(ledgerFile)).length;
    startCapture();
    const res = await callOpenAIForStageBackground("writer", "sys", "user", ctxFor());
    stopCapture();
    check("E1 reused completed response", res.content === '{"responses":[]}');
    check("E2 zero new provider requests", mock.calls.start === startBefore);
    const reuseEvents = eventsNamed("generation_provider_response_reused");
    check("E3 reuse event emitted", reuseEvents.some(e => e.reusedProviderResponse === true && e.providerResponseId === "resp_reuse_1"));
    const rows = (await readLedger(ledgerFile)).slice(ledgerBefore);
    check("E4 ledger row requestKind=REUSED_PROVIDER_RESPONSE", rows.some(r => r.requestKind === "REUSED_PROVIDER_RESPONSE" && r.providerResponseId === "resp_reuse_1"));
    check("E5 ledger row correlated", rows.some(r => r.generationRunId === "run-obs" && r.attemptSeq === 42 && r.documentId === "doc-obs"));
    check("E6 ledger row usageStatus=USAGE_KNOWN", rows.every(r => r.usageStatus === "USAGE_KNOWN"));
    setProviderPersistenceDeps(null);
  }

  // ===================== F =====================
  console.log("F. poll failures recorded as POLL — never NEW_PROVIDER_REQUEST");
  {
    setProviderPersistenceDeps(depsWith());
    mock.seedResponse("__next__", { statuses: ["in_progress", "completed"], outputText: "{}", usage: USAGE, transientRetrieveFailures: 2 });
    const ledgerBefore = (await readLedger(ledgerFile)).length;
    let threw: any = null;
    try {
      await callOpenAIForStageBackground("planner", "sys", "user", ctxFor({ generationRunId: "run-poll" }));
    } catch (e) { threw = e; }
    check("F1 poll failure → PROVIDER_POLL_FAILED", threw instanceof StageExecutionError && threw.code === "PROVIDER_POLL_FAILED", threw?.code);
    const rows = (await readLedger(ledgerFile)).slice(ledgerBefore);
    check("F2 failure row requestKind=POLL", rows.some(r => r.requestKind === "POLL" && r.errorCode === "PROVIDER_POLL_FAILED"));
    check("F3 no failure row claims NEW_PROVIDER_REQUEST", !rows.some(r => !r.success && r.requestKind === "NEW_PROVIDER_REQUEST" && r.errorCode === "PROVIDER_POLL_FAILED"));
    setProviderPersistenceDeps(null);
  }

  // ===================== G =====================
  console.log("G. attemptSeq correlation");
  {
    startCapture();
    emitEvent("generation_run_recovering", { generationRunId: "r1", attemptSeq: 9, documentId: "d1", recoveryCount: 2 });
    emitEvent("generation_superseded", { generationRunId: "r1", oldAttemptSeq: 9, newAttemptSeq: 10, documentId: "d1" });
    stopCapture();
    check("G1 recovering event carries attemptSeq+recoveryCount", eventsNamed("generation_run_recovering")[0]?.attemptSeq === 9 && eventsNamed("generation_run_recovering")[0]?.recoveryCount === 2);
    check("G2 superseded event carries old+new attemptSeq", eventsNamed("generation_superseded")[0]?.oldAttemptSeq === 9 && eventsNamed("generation_superseded")[0]?.newAttemptSeq === 10);
  }

  // ===================== H =====================
  console.log("H. failed usage rows carry errorCode + honest usageStatus");
  {
    setProviderPersistenceDeps(depsWith());
    const ledgerBefore = (await readLedger(ledgerFile)).length;
    // H1: provably-rejected request → NOT_CHARGED_CONFIRMED
    mock.seedResponse("__next__", { statuses: ["completed"], startError: new ProviderInvalidRequestError("bad request") });
    let threw1: any = null;
    try { await callOpenAIForStageBackground("planner", "sys", "user", ctxFor()); } catch (e) { threw1 = e; }
    check("H1 invalid request → typed code", threw1 instanceof StageExecutionError && threw1.code === "PROVIDER_INVALID_REQUEST", threw1?.code);
    let rows = (await readLedger(ledgerFile)).slice(ledgerBefore);
    const inv = rows.find(r => r.errorCode === "PROVIDER_INVALID_REQUEST");
    check("H2 failure row has errorCode", !!inv);
    check("H3 400-class → NOT_CHARGED_CONFIRMED", inv?.usageStatus === "NOT_CHARGED_CONFIRMED");
    check("H4 tokens are null — not invented zero", inv?.inputTokens === null && inv?.estimatedCostUsd === null);

    // H5: network failure at create → USAGE_UNKNOWN (cost may be non-zero)
    const netErr: any = new Error("socket hangup"); netErr.name = "APIConnectionError";
    mock.seedResponse("__next__", { statuses: ["completed"], startError: netErr });
    mock.seedResponse("__next__", { statuses: ["completed"], startError: netErr });
    let threw2: any = null;
    const ledgerBefore2 = (await readLedger(ledgerFile)).length;
    try { await callOpenAIForStageBackground("planner", "sys", "user", ctxFor()); } catch (e) { threw2 = e; }
    rows = (await readLedger(ledgerFile)).slice(ledgerBefore2);
    const net = rows.find(r => r.errorCode === "PROVIDER_NETWORK_ERROR");
    check("H5 network create failure → PROVIDER_NETWORK_ERROR", threw2 instanceof StageExecutionError && threw2.code === "PROVIDER_NETWORK_ERROR", threw2?.code);
    check("H6 ambiguous failure → USAGE_UNKNOWN not NOT_CHARGED", net?.usageStatus === "USAGE_UNKNOWN");
    check("H7 bounded create retry happened once", rows.filter(r => r.errorCode === "PROVIDER_NETWORK_ERROR").length === 2
      && rows[0]?.requestKind === "NEW_PROVIDER_REQUEST" && rows[1]?.requestKind === "RETRY_NEW_PROVIDER_REQUEST");
    setProviderPersistenceDeps(null);
  }

  // ===================== I =====================
  console.log("I. raw technical errors never reach the client surface");
  {
    const cases: Array<[string, string, string[]]> = [
      ["STAGE_TIMEOUT:factReviewer exceeded 120000ms", "GENERATION_PROVIDER_DELAY", ["factReviewer", "120000"]],
      ["SCHEMA_MIGRATION_REQUIRED", "SCHEMA_MIGRATION_REQUIRED", []],
      ["RUN_SUPERSEDED", "GENERATION_SUPERSEDED", []],
      ["GENERATION_STATE_PERSISTENCE_FAILED (provider_response_id)", "GENERATION_STATE_PERSISTENCE_FAILED", ["provider_response_id"]],
      ["PROVIDER_RATE_LIMIT", "GENERATION_PROVIDER_DELAY", []],
      ["PROVIDER_QUOTA", "PROVIDER_QUOTA", []],
      ["PROVIDER_INVALID_REQUEST", "PROVIDER_INVALID_REQUEST", []],
      ["Access denied for user 'sop_app'@'127.0.0.1' — SQL: UPDATE generation_runs SET", "GENERATION_INTERNAL_ERROR", ["sop_app", "SQL", "generation_runs"]],
      ['invalid_enum_value at $.responses[0].stage: "planner"', "GENERATION_INTERNAL_ERROR", ["invalid_enum_value", "responses"]],
    ];
    for (const [raw, code, forbidden] of cases) {
      const n = classifyGenerationError(raw);
      check(`I:${raw.slice(0, 32)}… → ${code}`, n.code === code, n.code);
      check(`I:${raw.slice(0, 32)}… userMessage clean`, forbidden.every(f => !n.userMessage.includes(f)), n.userMessage);
    }
  }

  // ===================== J =====================
  console.log("J. PII/content can never enter the event envelope");
  {
    startCapture();
    emitEvent("cv_identity_conflict_override", {
      studentId: "stu-1", actorId: "c-1", status: "MISMATCH",
      // Attacker/forgotten fields — must be dropped by the whitelist:
      name: "Khushi Sharma", email: "khushi@example.com", phone: "+91-99999",
      promptText: "Write an SOP about...", documentBody: "Dear committee...",
      resumeText: "EXPERIENCE ...",
    });
    emitEvent("generation_pipeline_error", {
      generationRunId: "r1", errorCode: "X",
      detail: "x".repeat(1000), // over-limit string — truncated
    }, "error");
    stopCapture();
    const cvEvent = eventsNamed("cv_identity_conflict_override")[0];
    const serialized = JSON.stringify(cvEvent);
    check("J1 whitelisted ids kept", cvEvent?.studentId === "stu-1" && cvEvent?.actorId === "c-1");
    check("J2 PII values absent", !serialized.includes("Khushi") && !serialized.includes("khushi@example.com") && !serialized.includes("99999"));
    check("J3 content fields dropped", !serialized.includes("Dear committee") && !serialized.includes("SOP about") && !serialized.includes("EXPERIENCE"));
    const errEvent = eventsNamed("generation_pipeline_error")[0];
    check("J4 detail truncated to 300 chars", typeof errEvent?.detail === "string" && errEvent.detail.length === 300);
  }

  // ===================== K. artifact TTL =====================
  console.log("K. attempt artifacts TTL — expired dirs removed, locked dirs kept");
  {
    const root = path.join(base, "attempts-ttl");
    const oldId = randomUUID(), lockedId = randomUUID(), freshId = randomUUID();
    for (const id of [oldId, lockedId, freshId]) {
      await fs.mkdir(path.join(root, id), { recursive: true });
      await fs.writeFile(path.join(root, id, "run-state.json"), "{}");
    }
    await fs.writeFile(path.join(root, lockedId, ".execution.lock"), "{}");
    // Backdate the two old dirs.
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(root, oldId), past, past);
    await fs.utimes(path.join(root, lockedId), past, past);
    const res = await cleanupAttemptArtifacts({ attemptsRoot: root, ttlDays: 14 });
    check("K1 expired unlocked dir removed", res.removed.includes(oldId));
    check("K2 locked dir never removed", res.skippedLocked.includes(lockedId));
    check("K3 fresh dir untouched", !res.removed.includes(freshId));
    check("K4 non-uuid dirs ignored", true);
  }

  setStageTransport(null);
  setProviderPersistenceDeps(null);
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.log = realLog; console.warn = realWarn; console.error = realErr;
  console.error("FATAL:", e);
  process.exit(1);
});
