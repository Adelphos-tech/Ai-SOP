import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AttemptAccounting } from "../attempt-accounting";
import { AttemptAccountingTracker } from "../attempt-accounting";
import type { CheckpointHashes, StageCheckpoint } from "../pipeline-checkpoint";
import { normalizeStageOutput, STAGE_CONTRACT_VERSIONS } from "./stage-contracts";
import { STAGE_OUTPUT_SCHEMAS } from "../schemas";
import {
  appendDurable, atomicWriteDurable, computeHash,
  getCheckpointPath, syncDirectory, validateCheckpoint,
} from "../pipeline-checkpoint";
import type { StageUsage } from "../types";

export const EXECUTION_STAGES = [
  "planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer",
] as const;
export type ExecutionStage = typeof EXECUTION_STAGES[number];
export type ExecutionMode = "CONTENT_REGENERATION" | "TECHNICAL_STAGE_RETRY";
export interface StageExecutionResult {
  content: string;
  /** Canonical normalized + schema-validated stage output (parseStage result).
   *  This — not a raw re-parse — is what downstream stages consume. */
  output: Record<string, any>;
  stageUsage: StageUsage;
}
export interface StageExecutionOptions {
  generationId: string;
  mode: ExecutionMode;
  basePath: string;
  hashes: CheckpointHashes;
  exchangeRate: number;
  call: (
    stage: ExecutionStage, system: string, user: string,
    onUsage: (usage: StageUsage) => Promise<void>,
  ) => Promise<{ content: string; stageUsage: StageUsage }>;
  maxTechnicalRetries?: number;
}
export interface StageExecution {
  generationId: string;
  execute(stage: ExecutionStage, system: string, user: string, context?: { freezeComponentIds?: Set<string>; expectedClaimIds?: Map<string, string[]> }): Promise<StageExecutionResult>;
  finish(success: boolean): Promise<void>;
  accounting(): AttemptAccounting;
  close(): Promise<void>;
}

export class StageExecutionError extends Error {
  readonly code: string;
  readonly technical: boolean;
  constructor(code: string, message = code, technical = false) {
    super(message);
    this.code = code;
    this.technical = technical;
    this.name = "StageExecutionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type FailureKind = "TECHNICAL" | "CONTENT";
interface CallRecord {
  id: string;
  runId: string;
  stage: ExecutionStage;
  stageIndex: number;
  inputHash: string;
  applicationRetries: number;
  sdkRetries: 0;
  startedAt: string;
  completedAt?: string;
  status: "STARTED" | "SUCCESS" | "TECHNICAL" | "CONTENT";
  reason?: string;
  retryReason?: string;
  usages: StageUsage[];
}
interface RunRecord {
  id: string;
  mode: ExecutionMode;
  startedAt: string;
  completedAt?: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
}
interface State {
  version: 1;
  revision: number;
  generationId: string;
  hashes: CheckpointHashes;
  dependenciesHash: string;
  exchangeRate: number;
  maxTechnicalRetries: number;
  status: "RUNNING" | "SUCCESS" | "FAILED_TECHNICAL" | "FAILED_CONTENT";
  failure?: { kind: FailureKind; stageIndex: number; reason: string };
  calls: CallRecord[];
  runs: RunRecord[];
  checkpoints: string[];
}
interface JournalEntry {
  revision: number;
  type: string;
  data: unknown;
  timestamp: string;
  stateHash: string;
  previousHash: string | null;
  hash: string;
}

function classifyFailure(error: unknown): FailureKind {
  if (error instanceof StageExecutionError) return error.technical ? "TECHNICAL" : "CONTENT";
  const e = error as { status?: number; code?: string; name?: string; message?: string } | null;
  const code = e?.code || "";
  const name = e?.name || "";
  if (/SCHEMA|CONTENT|VALIDATION|PARSE|REFUSAL/.test(code)) return "CONTENT";
  if (e?.status === 408 || e?.status === 429 || (e?.status !== undefined && e.status >= 500 && e.status <= 599)) return "TECHNICAL";
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EAI_AGAIN", "EMPTY_CONTENT", "RATE_LIMIT", "SERVER_ERROR", "TIMEOUT"].includes(code)) return "TECHNICAL";
  if (["APIConnectionError", "APIConnectionTimeoutError", "TimeoutError", "RateLimitError", "InternalServerError"].includes(name)) return "TECHNICAL";
  if (/returned empty content|empty response|timed out|timeout/i.test(e?.message || "")) return "TECHNICAL";
  return "CONTENT";
}

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Parse + structurally validate a stage output.
 *
 * Flow: JSON.parse → normalizeStageOutput → Zod schema (single source
 * of structural truth) → domain checks that need pipeline context
 * (finalizer claim-metadata completeness) → contract-version stamp.
 *
 * Domain/safety validation (claim IDs, evidence allowlists, invented/
 * altered fact policy) stays in the pipeline validators — NOT here.
 */
export function parseStage(stage: ExecutionStage, content: string, context?: { freezeComponentIds?: Set<string>; expectedClaimIds?: Map<string, string[]> }): Record<string, any> {
  if (!text(content)) throw new StageExecutionError("EMPTY_CONTENT", `${stage} returned empty content`, true);
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new StageExecutionError("CONTENT_JSON_INVALID"); }
  if (!object(parsed)) throw new StageExecutionError("CONTENT_SCHEMA_INVALID");
  // Normalize harmless representation differences BEFORE strict checks —
  // e.g. factReviewer claims using `text` instead of `claim`, or an
  // omitted blockingReason.
  const normalized = normalizeStageOutput(stage, parsed);

  // Structural validation — Zod is the single source of truth.
  const result = STAGE_OUTPUT_SCHEMAS[stage].safeParse(normalized);
  if (!result.success) {
    // Internal diagnostics only — paths/codes, never applicant content.
    const issues = result.error.issues.slice(0, 5).map(i => `${i.path.join(".") || "(root)"}:${i.code}`).join("; ");
    // Preserve legacy semantics: missing/invalid finalizer claim-metadata
    // fields were technical-retryable (model can correct on retry).
    const isFinalizerMetadata = stage === "finalizer" && result.error.issues.some(i =>
      ["retainedClaimIds", "removedClaimIds", "repairClaims"].includes(String(i.path[i.path.length - 1])));
    throw new StageExecutionError(
      "AI_STAGE_SCHEMA_INVALID",
      `${stage}: structural contract violation (${STAGE_CONTRACT_VERSIONS[stage]}) — ${issues}`,
      isFinalizerMetadata,
    );
  }
  const output = result.data as Record<string, any>;

  // Phase 21/33B/34C: Finalizer claim-metadata completeness needs action-
  // plan context (FREEZE vs non-FREEZE, expected claim IDs) — domain rule,
  // kept outside the structural schema.
  if (stage === "finalizer") {
    for (const item of output.responses) {
      const isEmptyMetadata = item.retainedClaimIds.length === 0 && item.removedClaimIds.length === 0;
      if (isEmptyMetadata) {
        const isFreeze = context?.freezeComponentIds?.has(item.componentId) ?? false;
        const expectedIds = context?.expectedClaimIds?.get(item.componentId) ?? [];
        if (!isFreeze && expectedIds.length > 0) {
          throw new StageExecutionError(
            "FINALIZER_METADATA_INCOMPLETE",
            `finalizer: component ${item.componentId} has empty retainedClaimIds and removedClaimIds. Non-FREEZE actions must provide explicit claim provenance metadata. Expected claim IDs: ${expectedIds.join(", ")}. Please return retainedClaimIds and removedClaimIds for every pre-final claim.`,
            true // technical retryable
          );
        }
      }
    }
  }

  // Stamp the contract version so stored checkpoints identify which
  // contract produced this output (set in code — never model-generated).
  output._contractVersion = STAGE_CONTRACT_VERSIONS[stage];
  return output;
}

function validUsage(usage: StageUsage, stage: ExecutionStage): boolean {
  return object(usage) && usage.stage === stage && text(usage.model) && typeof usage.responseId === "string" && typeof usage.success === "boolean" &&
    [usage.durationMs, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.totalTokens, usage.reasoningTokens, usage.estimatedCostUsd].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

function buildAccounting(state: State, checkpoints: StageCheckpoint[]): AttemptAccounting {
  const tracker = new AttemptAccountingTracker(state.exchangeRate);
  tracker.recordContentGenerationAttempt();
  for (const run of state.runs) {
    tracker.recordPipelineRun();
    if (run.status === "FAILED") tracker.recordFailedRun();
    if (run.status === "SUCCESS") {
      const chainCost = checkpoints.reduce((total, checkpoint) => total + checkpoint.usage.estimatedCostUsd, 0);
      tracker.recordSuccessfulRun(chainCost, chainCost * state.exchangeRate);
    }
  }
  for (const call of state.calls) {
    for (const usage of call.usages) tracker.recordPaidApiCall(usage.estimatedCostUsd);
    if (!call.usages.length) tracker.recordUnknownUsageApiCall();
    if (call.applicationRetries > 0) tracker.recordTechnicalRetry({
      stageName: call.stage, stageIndex: call.stageIndex, reason: call.retryReason || "TECHNICAL_FAILURE",
      sdkRetries: 0, applicationRetries: call.applicationRetries,
      costUsd: call.usages.reduce((sum, usage) => sum + usage.estimatedCostUsd, 0), timestamp: call.startedAt,
    });
  }
  return tracker.getAccounting();
}

export async function createStageExecution(options: StageExecutionOptions): Promise<StageExecution> {
  const basePath = path.resolve(options.basePath);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.generationId) || path.basename(basePath) !== options.generationId) {
    throw new StageExecutionError("INVALID_ATTEMPT_PATH", "basePath must be the exact generationId UUID directory");
  }
  if (!["CONTENT_REGENERATION", "TECHNICAL_STAGE_RETRY"].includes(options.mode)) throw new StageExecutionError("INVALID_EXECUTION_MODE");
  if (!Number.isFinite(options.exchangeRate) || options.exchangeRate <= 0) throw new StageExecutionError("INVALID_EXCHANGE_RATE");
  const maxTechnicalRetries = options.maxTechnicalRetries ?? 2;
  if (!Number.isInteger(maxTechnicalRetries) || maxTechnicalRetries < 0) throw new StageExecutionError("INVALID_RETRY_LIMIT");
  const hashes: CheckpointHashes = JSON.parse(JSON.stringify(options.hashes));
  for (const key of ["generationContractHash", "studentFactsHash", "applicationRequirementsHash", "aiPolicyHash", "applicationSpecificFactsHash", "modelConfigurationHash", "promptVersionHash", "renderProfileVersion"]) {
    if (!text(hashes[key])) throw new StageExecutionError("MISSING_DEPENDENCY_HASH", key);
  }
  const dependenciesHash = computeHash(hashes);
  if (options.mode === "CONTENT_REGENERATION") {
    // recursive: a restarted/resumed attempt may already have this dir.
    await fs.mkdir(basePath, { mode: 0o700, recursive: true });
    await syncDirectory(path.dirname(basePath));
  } else {
    const stat = await fs.lstat(basePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StageExecutionError("INVALID_ATTEMPT_PATH");
  }
  const lockPath = path.join(basePath, ".execution.lock");
  const lockToken = randomUUID();
  let lock;
  try { lock = await fs.open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Phase 21: Stale lock recovery.
      // Read the lock file and check if the owning process is still alive.
      // If the PID is dead, the lock is stale and can be safely removed.
      // If the PID is alive, the lock is active and must not be removed.
      try {
        const lockData = JSON.parse(await fs.readFile(lockPath, "utf8"));
        const lockPid = lockData.pid;
        if (typeof lockPid === "number" && lockPid > 0) {
          // Check if process is still alive
          try {
            process.kill(lockPid, 0);
            // Process is still alive — lock is active
            throw new StageExecutionError("ATTEMPT_LOCKED", `Existing lock held by active PID ${lockPid}; it will not be removed`);
          } catch (killError: any) {
            if (killError.code === "ESRCH") {
              // Process is dead — stale lock, remove and retry
              await fs.unlink(lockPath);
              await syncDirectory(basePath);
              lock = await fs.open(lockPath, "wx", 0o600);
            } else {
              // Permission error or other — treat as active lock
              throw new StageExecutionError("ATTEMPT_LOCKED", `Existing lock held by PID ${lockPid}; unable to verify process status`);
            }
          }
        } else {
          // No valid PID in lock — stale, remove and retry
          await fs.unlink(lockPath);
          await syncDirectory(basePath);
          lock = await fs.open(lockPath, "wx", 0o600);
        }
      } catch (e) {
        if (e instanceof StageExecutionError) throw e;
        // Can't read lock file — treat as active for safety
        throw new StageExecutionError("ATTEMPT_LOCKED", "Existing lock could not be read; it will not be removed");
      }
    } else {
      throw error;
    }
  }
  const releaseLock = async () => {
    try {
      const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (current.token !== lockToken) throw new StageExecutionError("LOCK_OWNERSHIP_LOST");
      await fs.unlink(lockPath);
      await syncDirectory(basePath);
    } catch (e: any) {
      if (e?.code === "ENOENT") return; // Lock already removed — safe
      if (e instanceof StageExecutionError) throw e;
      // Best-effort cleanup — don't crash on lock release failure
    }
  };
  try {
    await lock.writeFile(JSON.stringify({ token: lockToken, pid: process.pid, createdAt: new Date().toISOString() }));
    await lock.sync();
  } finally { await lock.close(); }
  await syncDirectory(basePath);

  let state: State;
  const checkpoints: StageCheckpoint[] = [];
  let previousJournalHash: string | null = null;
  let poisoned = false;
  let closed = false;
  let busy = false;
  let cursor = 0;
  const statePath = path.join(basePath, "run-state.json");
  const journalPath = path.join(basePath, "attempts.jsonl");
  const accounting = () => buildAccounting(state, checkpoints);
  const persist = async (type: string, data: unknown) => {
    try {
      state.revision++;
      const stateHash = computeHash(state);
      const entry = { revision: state.revision, type, data, timestamp: new Date().toISOString(), stateHash, previousHash: previousJournalHash };
      const hash = computeHash(entry);
      await appendDurable(journalPath, { ...entry, hash });
      previousJournalHash = hash;
      await atomicWriteDurable(statePath, JSON.stringify({ state, stateHash, journalHash: hash }, null, 2));
      await atomicWriteDurable(path.join(basePath, "accounting.json"), JSON.stringify(accounting(), null, 2));
      await atomicWriteDurable(path.join(basePath, "runs.json"), JSON.stringify(state.runs, null, 2));
    } catch (error) { poisoned = true; throw error; }
  };
  try {
    if (options.mode === "CONTENT_REGENERATION") {
      state = {
        version: 1, revision: 0, generationId: options.generationId, hashes, dependenciesHash,
        exchangeRate: options.exchangeRate, maxTechnicalRetries, status: "RUNNING", calls: [], runs: [], checkpoints: [],
      };
    } else {
      const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
      state = saved.state;
      if (!state || saved.stateHash !== computeHash(state)) throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
      if (state.version !== 1 || state.generationId !== options.generationId || state.dependenciesHash !== dependenciesHash || computeHash(state.hashes) !== dependenciesHash || state.exchangeRate !== options.exchangeRate || state.maxTechnicalRetries !== maxTechnicalRetries) {
        throw new StageExecutionError("STALE_CHECKPOINT_REJECTED");
      }
      const journal = await fs.readFile(journalPath, "utf8");
      if (!journal.endsWith("\n")) throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
      const entries: JournalEntry[] = journal.trimEnd().split("\n").map(line => JSON.parse(line));
      for (let i = 0; i < entries.length; i++) {
        const { hash, ...entry } = entries[i];
        if (entry.revision !== i + 1 || entry.previousHash !== previousJournalHash || hash !== computeHash(entry)) throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
        previousJournalHash = hash;
      }
      if (previousJournalHash !== saved.journalHash || entries.length !== state.revision || entries[entries.length - 1]?.stateHash !== saved.stateHash) throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
      if (state.status !== "FAILED_TECHNICAL" || state.failure?.kind !== "TECHNICAL" || state.runs.some(run => run.status === "RUNNING")) throw new StageExecutionError("TECHNICAL_RETRY_NOT_ALLOWED");
      if (state.checkpoints.length >= EXECUTION_STAGES.length || state.failure.stageIndex !== state.checkpoints.length + 1) throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
      for (let i = 0; i < state.checkpoints.length; i++) {
        const stage = EXECUTION_STAGES[i];
        const checkpoint: StageCheckpoint = JSON.parse(await fs.readFile(getCheckpointPath({ basePath, generationId: options.generationId }, i + 1, stage), "utf8"));
        const prefix = `${String(i + 1).padStart(2, "0")}-${stage}`;
        const raw = await fs.readFile(path.join(basePath, `raw-${prefix}.txt`), "utf8");
        const artifact = JSON.parse(await fs.readFile(path.join(basePath, `artifact-${prefix}.json`), "utf8"));
        const call = state.calls.find(item => item.id === checkpoint.callId);
        if (checkpoint.stageName !== stage || checkpoint.stageIndex !== i + 1 || checkpoint.generationId !== options.generationId || computeHash(checkpoint) !== state.checkpoints[i] || !validateCheckpoint(checkpoint, hashes).valid || checkpoint.dependenciesHash !== dependenciesHash || checkpoint.configurationHash !== hashes.modelConfigurationHash || checkpoint.previousCheckpointHash !== (i ? state.checkpoints[i - 1] : null) || !text(checkpoint.inputHash) || checkpoint.rawOutput !== raw || checkpoint.rawOutputHash !== computeHash(raw) || checkpoint.outputHash !== computeHash(artifact) || checkpoint.outputHash !== computeHash(parseStage(stage, raw)) || !call || call.status !== "SUCCESS" || call.stage !== stage || call.stageIndex !== i + 1 || call.inputHash !== checkpoint.inputHash || !call.usages.some(usage => computeHash(usage) === computeHash(checkpoint.usage))) {
          throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
        }
        checkpoints.push(checkpoint);
      }
      const failedStageCalls = state.calls.filter(call => call.stageIndex === state.failure!.stageIndex);
      if (!failedStageCalls.length || failedStageCalls[failedStageCalls.length - 1].status !== "TECHNICAL") throw new StageExecutionError("CHECKPOINT_INTEGRITY_FAILED");
      if (failedStageCalls.length > maxTechnicalRetries) throw new StageExecutionError("TECHNICAL_RETRY_LIMIT_EXCEEDED");
    }
    const run: RunRecord = { id: randomUUID(), mode: options.mode, startedAt: new Date().toISOString(), status: "RUNNING" };
    state.runs.push(run);
    state.status = "RUNNING";
    await persist("RUN_STARTED", run);

    const fail = async (kind: FailureKind, stageIndex: number, reason: string) => {
      state.status = kind === "TECHNICAL" ? "FAILED_TECHNICAL" : "FAILED_CONTENT";
      state.failure = { kind, stageIndex, reason };
      run.status = "FAILED";
      run.completedAt = new Date().toISOString();
      await persist("RUN_FAILED", state.failure);
    };
    const assertOpen = () => {
      if (closed) throw new StageExecutionError("EXECUTION_CLOSED");
      if (poisoned) throw new StageExecutionError("PERSISTENCE_FAILED_LOCK_RETAINED");
      if (busy) throw new StageExecutionError("STAGE_EXECUTION_IN_PROGRESS");
    };
    const manager: StageExecution = {
      generationId: options.generationId,
      accounting,
      async execute(stage, system, user, context) {
        assertOpen();
        if (state.status !== "RUNNING") throw new StageExecutionError("RUN_NOT_ACTIVE");
        if (stage !== EXECUTION_STAGES[cursor]) throw new StageExecutionError("STAGE_ORDER_VIOLATION");
        if (typeof system !== "string" || typeof user !== "string") throw new StageExecutionError("INVALID_STAGE_PROMPTS");
        busy = true;
        const stageIndex = cursor + 1;
        const inputHash = computeHash({ stage, stageIndex, system, user });
        let callRecord: CallRecord | undefined;
        let usageQueue = Promise.resolve();
        let usageFailure: unknown;
        let acceptingUsage = true;
        try {
          const restored = checkpoints[cursor];
          if (restored) {
            if (restored.inputHash !== inputHash) throw new StageExecutionError("STALE_CHECKPOINT_REJECTED");
            cursor++;
            return { content: restored.rawOutput!, output: restored.output, stageUsage: { ...restored.usage, stage, success: true } };
          }
          const prior = state.calls.filter(call => call.stageIndex === stageIndex);
          // Phase 34C: Allow different input hashes for technical retries
          // (corrective feedback changes the prompt). Only check input hash
          // consistency when the last call was NOT a technical retry.
          if (prior.length) {
            const lastPrior = prior[prior.length - 1];
            if (lastPrior.status !== "TECHNICAL" && prior.some(call => call.inputHash !== inputHash)) {
              throw new StageExecutionError("STALE_CHECKPOINT_REJECTED");
            }
            if (lastPrior.status !== "TECHNICAL" || prior.length > state.maxTechnicalRetries) {
              throw new StageExecutionError("TECHNICAL_RETRY_LIMIT_EXCEEDED");
            }
          }
          callRecord = {
            id: randomUUID(), runId: run.id, stage, stageIndex, inputHash, applicationRetries: prior.length,
            sdkRetries: 0, startedAt: new Date().toISOString(), status: "STARTED", usages: [],
            ...(prior.length ? { retryReason: prior[prior.length - 1].reason } : {}),
          };
          state.calls.push(callRecord);
          await persist("CALL_STARTED", callRecord);
          const activeCall = callRecord;
          const onUsage = (usage: StageUsage): Promise<void> => {
            if (!acceptingUsage) return Promise.reject(new StageExecutionError("LATE_USAGE_CALLBACK"));
            const captured: StageUsage = JSON.parse(JSON.stringify(usage));
            const operation = usageQueue.then(async () => {
              if (!validUsage(captured, stage)) throw new StageExecutionError("INVALID_USAGE_RECORD");
              if (activeCall.usages.length) {
                if (computeHash(activeCall.usages[0]) === computeHash(captured)) return;
                throw new StageExecutionError("MULTIPLE_USAGE_RECORDS_FOR_CALL");
              }
              activeCall.usages.push(captured);
              await persist("USAGE_RECORDED", { callId: activeCall.id, usage: captured });
            });
            usageQueue = operation.catch(error => { usageFailure = error; });
            return operation;
          };
          let result: { content: string; stageUsage: StageUsage };
          try {
            result = await options.call(stage, system, user, onUsage);
            await usageQueue;
            if (usageFailure) throw usageFailure;
            if (!activeCall.usages.length && result.stageUsage) await onUsage(result.stageUsage);
          } finally {
            acceptingUsage = false;
            await usageQueue;
          }
          if (usageFailure) throw usageFailure;
          if (!activeCall.usages.length || computeHash(activeCall.usages[0]) !== computeHash(result.stageUsage)) throw new StageExecutionError("USAGE_RECORD_MISMATCH");
          const output = parseStage(stage, result.content, context);
          const checkpoint: StageCheckpoint = {
            generationId: options.generationId, stageName: stage, stageIndex,
            generationContractHash: hashes.generationContractHash, contractSemanticHash: hashes.contractSemanticHash, studentFactsHash: hashes.studentFactsHash,
            applicationRequirementsHash: hashes.applicationRequirementsHash, aiPolicyHash: hashes.aiPolicyHash,
            applicationSpecificFactsHash: hashes.applicationSpecificFactsHash, modelConfigurationHash: hashes.modelConfigurationHash,
            promptVersionHash: hashes.promptVersionHash, renderProfileVersion: hashes.renderProfileVersion,
            configurationHash: hashes.modelConfigurationHash, dependencies: hashes, dependenciesHash, inputHash,
            output, outputHash: computeHash(output), rawOutput: result.content, rawOutputHash: computeHash(result.content),
            previousCheckpointHash: state.checkpoints.length ? state.checkpoints[state.checkpoints.length - 1] : null,
            callId: activeCall.id, usage: { ...result.stageUsage }, completedAt: new Date().toISOString(),
          };
          const prefix = `${String(stageIndex).padStart(2, "0")}-${stage}`;
          try {
            await atomicWriteDurable(path.join(basePath, `raw-${prefix}.txt`), result.content);
            await atomicWriteDurable(path.join(basePath, `artifact-${prefix}.json`), JSON.stringify(output, null, 2));
            await atomicWriteDurable(getCheckpointPath({ basePath, generationId: options.generationId }, stageIndex, stage), JSON.stringify(checkpoint, null, 2));
          } catch (error) { poisoned = true; throw error; }
          activeCall.status = "SUCCESS";
          activeCall.completedAt = checkpoint.completedAt;
          checkpoints.push(checkpoint);
          state.checkpoints.push(computeHash(checkpoint));
          delete state.failure;
          await persist("STAGE_COMPLETED", { callId: activeCall.id, checkpointHash: computeHash(checkpoint) });
          cursor++;
          return { content: result.content, output, stageUsage: { ...result.stageUsage } };
        } catch (error) {
          await usageQueue;
          if (!poisoned) {
            const kind = classifyFailure(error);
            const reason = (error as Error)?.message || String(error);
            if (callRecord) {
              callRecord.status = kind;
              callRecord.reason = reason;
              callRecord.completedAt = new Date().toISOString();
            }
            // Phase 34C: For FINALIZER_METADATA_INCOMPLETE, don't fail the run.
            // The pipeline will catch this and retry with corrective feedback.
            // The run stays RUNNING so execute() can be called again.
            const isMetadataIncomplete = error instanceof StageExecutionError && error.code === "FINALIZER_METADATA_INCOMPLETE";
            if (isMetadataIncomplete) {
              await persist("CALL_FAILED", { callId: callRecord?.id, kind, reason });
            } else {
              await fail(kind, stageIndex, reason);
            }
          }
          throw error;
        } finally { acceptingUsage = false; busy = false; }
      },
      async finish(success) {
        assertOpen();
        if (run.status !== "RUNNING") {
          if ((run.status === "SUCCESS") !== success) throw new StageExecutionError("RUN_ALREADY_FINISHED");
          return;
        }
        busy = true;
        try {
          if (success) {
            if (cursor !== EXECUTION_STAGES.length || checkpoints.length !== EXECUTION_STAGES.length) throw new StageExecutionError("INCOMPLETE_STAGE_CHAIN");
            state.status = "SUCCESS";
            run.status = "SUCCESS";
            run.completedAt = new Date().toISOString();
            delete state.failure;
            await persist("RUN_SUCCEEDED", run);
          } else {
            await fail("CONTENT", cursor + 1, "PIPELINE_ABORTED_OR_CONTENT_REJECTED");
          }
        } finally { busy = false; }
      },
      async close() {
        if (closed) return;
        assertOpen();
        if (run.status === "RUNNING") await manager.finish(false);
        await releaseLock();
        closed = true;
      },
    };
    return manager;
  } catch (error) {
    if (!poisoned) await releaseLock();
    throw error;
  }
}
