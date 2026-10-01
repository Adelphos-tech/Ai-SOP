/**
 * @file pipeline-checkpoint.ts
 * @description
 * Pipeline Checkpoint/Resume system.
 *
 * After each successful stage, save a checkpoint with:
 *   - stageName, stageIndex
 *   - inputHash, generationContractHash
 *   - model, configurationHash
 *   - output, usage
 *   - completedAt
 *
 * On technical failure, resume from the last successful checkpoint
 * instead of rerunning the entire pipeline.
 *
 * A checkpoint may be reused ONLY if all relevant hashes match.
 */

import { promises as fs } from "fs";
import path from "path";
import * as crypto from "crypto";

export interface CheckpointHashes {
  generationContractHash: string;
  contractSemanticHash: string;
  studentFactsHash: string;
  applicationRequirementsHash: string;
  aiPolicyHash: string;
  applicationSpecificFactsHash: string;
  modelConfigurationHash: string;
  promptVersionHash: string;
  renderProfileVersion: string;
  [key: string]: unknown;
}

export interface StageCheckpoint {
  generationId?: string;
  inputHash?: string;
  configurationHash?: string;
  dependencies?: CheckpointHashes;
  dependenciesHash?: string;
  outputHash?: string;
  rawOutputHash?: string;
  previousCheckpointHash?: string | null;
  callId?: string;
  rawOutput?: string;
  stageName: string;
  stageIndex: number;
  generationContractHash: string;
  contractSemanticHash: string;
  studentFactsHash: string;
  applicationRequirementsHash: string;
  aiPolicyHash: string;
  applicationSpecificFactsHash: string;
  modelConfigurationHash: string;
  promptVersionHash: string;
  renderProfileVersion: string;
  output: any;
  usage: {
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number;
    durationMs: number;
    responseId: string;
  };
  completedAt: string;
}

export interface CheckpointDirectory {
  basePath: string;
  generationId: string;
}

export interface CheckpointValidityResult {
  valid: boolean;
  invalidReasons: string[];
}

/**
 * Compute a stable hash for any JSON-serializable value.
 */
export function computeHash(value: any): string {
  const normalized = JSON.parse(JSON.stringify(value));
  const canonical = (item: any): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  };
  return crypto.createHash("sha256").update(canonical(normalized)).digest("hex");
}

/**
 * Get the checkpoint file path for a given stage.
 */
export function getCheckpointPath(checkpointDir: CheckpointDirectory, stageIndex: number, stageName: string): string {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(stageName)) {
    throw new Error("INVALID_CHECKPOINT_STAGE");
  }
  const padded = String(stageIndex).padStart(2, "0");
  return path.join(checkpointDir.basePath, `checkpoint-${padded}-${stageName}.json`);
}

/**
 * Save a checkpoint after a successful stage.
 */
export async function saveCheckpoint(
  checkpointDir: CheckpointDirectory,
  checkpoint: StageCheckpoint
): Promise<void> {
  const filePath = getCheckpointPath(checkpointDir, checkpoint.stageIndex, checkpoint.stageName);
  await fs.mkdir(checkpointDir.basePath, { recursive: true });
  await atomicWriteDurable(filePath, JSON.stringify(checkpoint, null, 2));
}

/**
 * Load a checkpoint for a given stage.
 */
export async function loadCheckpoint(
  checkpointDir: CheckpointDirectory,
  stageIndex: number,
  stageName: string
): Promise<StageCheckpoint | null> {
  const filePath = getCheckpointPath(checkpointDir, stageIndex, stageName);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Validate a checkpoint against current input hashes.
 * A checkpoint may be reused ONLY if all relevant hashes match.
 */
export function validateCheckpoint(
  checkpoint: StageCheckpoint,
  currentHashes: {
    generationContractHash: string;
    contractSemanticHash: string;
    studentFactsHash: string;
    applicationRequirementsHash: string;
    aiPolicyHash: string;
    applicationSpecificFactsHash: string;
    modelConfigurationHash: string;
    promptVersionHash: string;
    renderProfileVersion: string;
  }
): CheckpointValidityResult {
  const invalidReasons: string[] = [];
  if (checkpoint.dependencies && computeHash(checkpoint.dependencies) !== computeHash(currentHashes)) {
    invalidReasons.push("DEPENDENCIES_CHANGED");
  }
  if (checkpoint.dependenciesHash && checkpoint.dependenciesHash !== computeHash(currentHashes)) {
    invalidReasons.push("DEPENDENCIES_CHANGED");
  }
  if (checkpoint.outputHash && checkpoint.outputHash !== computeHash(checkpoint.output)) {
    invalidReasons.push("OUTPUT_INTEGRITY_FAILED");
  }
  if (checkpoint.rawOutput !== undefined && checkpoint.rawOutputHash !== computeHash(checkpoint.rawOutput)) {
    invalidReasons.push("RAW_OUTPUT_INTEGRITY_FAILED");
  }

  if (checkpoint.generationContractHash !== currentHashes.generationContractHash) {
    invalidReasons.push("GENERATION_CONTRACT_CHANGED");
  }
  if (checkpoint.contractSemanticHash !== currentHashes.contractSemanticHash) {
    invalidReasons.push("CONTRACT_SEMANTIC_HASH_CHANGED");
  }
  if (checkpoint.studentFactsHash !== currentHashes.studentFactsHash) {
    invalidReasons.push("STUDENT_FACTS_CHANGED");
  }
  if (checkpoint.applicationRequirementsHash !== currentHashes.applicationRequirementsHash) {
    invalidReasons.push("APPLICATION_REQUIREMENTS_CHANGED");
  }
  if (checkpoint.aiPolicyHash !== currentHashes.aiPolicyHash) {
    invalidReasons.push("AI_POLICY_CHANGED");
  }
  if (checkpoint.applicationSpecificFactsHash !== currentHashes.applicationSpecificFactsHash) {
    invalidReasons.push("APPLICATION_SPECIFIC_FACTS_CHANGED");
  }
  if (checkpoint.modelConfigurationHash !== currentHashes.modelConfigurationHash) {
    invalidReasons.push("MODEL_CONFIGURATION_CHANGED");
  }
  if (checkpoint.promptVersionHash !== currentHashes.promptVersionHash) {
    invalidReasons.push("PROMPT_VERSION_CHANGED");
  }
  if (checkpoint.renderProfileVersion !== currentHashes.renderProfileVersion) {
    invalidReasons.push("RENDER_PROFILE_VERSION_CHANGED");
  }

  return {
    valid: invalidReasons.length === 0,
    invalidReasons,
  };
}

/**
 * Find the last valid checkpoint to resume from.
 * Returns the stage index to resume at (0 = start from beginning).
 */
export async function findResumePoint(
  checkpointDir: CheckpointDirectory,
  currentHashes: {
    generationContractHash: string;
    contractSemanticHash: string;
    studentFactsHash: string;
    applicationRequirementsHash: string;
    aiPolicyHash: string;
    applicationSpecificFactsHash: string;
    modelConfigurationHash: string;
    promptVersionHash: string;
    renderProfileVersion: string;
  },
  stageNames: Array<{ name: string; index: number }>
): Promise<{ resumeAtStage: number; validCheckpoints: StageCheckpoint[] }> {
  const validCheckpoints: StageCheckpoint[] = [];
  let lastValidStage = -1;

  for (const stage of stageNames) {
    const checkpoint = await loadCheckpoint(checkpointDir, stage.index, stage.name);
    if (!checkpoint) {
      break; // No checkpoint for this stage — must run from here
    }

    const validity = validateCheckpoint(checkpoint, currentHashes);
    if (!validity.valid) {
      break; // Checkpoint invalid — must run from here
    }

    validCheckpoints.push(checkpoint);
    lastValidStage = stage.index;
  }

  return {
    resumeAtStage: lastValidStage + 1, // Resume at the NEXT stage after the last valid one
    validCheckpoints,
  };
}

/**
 * List all checkpoints in a directory.
 */
export async function listCheckpoints(
  checkpointDir: CheckpointDirectory
): Promise<StageCheckpoint[]> {
  const checkpoints: StageCheckpoint[] = [];
  try {
    const files = await fs.readdir(checkpointDir.basePath);
    const checkpointFiles = files.filter(f => f.startsWith("checkpoint-")).sort();
    for (const file of checkpointFiles) {
      const data = await fs.readFile(path.join(checkpointDir.basePath, file), "utf-8");
      checkpoints.push(JSON.parse(data));
    }
  } catch {
    return [];
  }
  return checkpoints;
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWriteDurable(filePath: string, text: string): Promise<void> {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
  await syncDirectory(path.dirname(filePath));
}

export async function appendDurable(filePath: string, value: unknown): Promise<void> {
  const handle = await fs.open(filePath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

// ============================================================
// ATTEMPT ARTIFACT RETENTION (DEBUG ARTIFACTS)
// ============================================================
// logs/attempts/<generationId>/ holds full raw model output and
// rendered drafts — DEBUG artifacts, not operational logs. They are
// needed for recovery while a run is live and for post-incident
// debugging, but must not be retained indefinitely.
//
// Policy: attempt directories older than ATTEMPT_ARTIFACT_TTL_DAYS
// (default 14) are removed ONLY when no .execution.lock is present —
// a locked attempt may be resumable by an in-flight or recovering
// generation and is never touched. Correlation evidence survives in
// generation_runs / generation_stage_responses / openai-usage.jsonl.
// ============================================================

const ATTEMPT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove expired attempt directories. Called explicitly (cron / startup
 * maintenance hook) — never implicitly inside generation paths.
 * Returns the list of removed generation ids for the caller to log.
 */
export async function cleanupAttemptArtifacts(opts?: {
  attemptsRoot?: string;
  ttlDays?: number;
  now?: number;
}): Promise<{ removed: string[]; skippedLocked: string[] }> {
  const attemptsRoot = opts?.attemptsRoot || path.join(process.cwd(), "logs", "attempts");
  const ttlDays = opts?.ttlDays ?? Number(process.env.ATTEMPT_ARTIFACT_TTL_DAYS || 14);
  const ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
  const now = opts?.now ?? Date.now();
  const removed: string[] = [];
  const skippedLocked: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(attemptsRoot, { withFileTypes: true });
  } catch {
    return { removed, skippedLocked };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !ATTEMPT_UUID_RE.test(entry.name)) continue;
    const dir = path.join(attemptsRoot, entry.name);
    try {
      const stat = await fs.stat(dir);
      if (now - stat.mtimeMs <= ttlMs) continue;
      // Never delete an attempt that still holds an execution lock —
      // a live or recoverable generation may depend on it.
      try {
        await fs.access(path.join(dir, ".execution.lock"));
        skippedLocked.push(entry.name);
        continue;
      } catch { /* no lock — safe to remove */ }
      await fs.rm(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // Cleanup is telemetry-adjacent maintenance — a failed removal is
      // skipped, not fatal, and reported via the returned list.
    }
  }
  return { removed, skippedLocked };
}
