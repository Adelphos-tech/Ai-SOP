// ============================================================
// GENERATION LIFECYCLE — persisted per-attempt state
// ============================================================
// Authoritative generation state machine backed by generation_runs.
//
//   QUEUED → RUNNING → COMPLETED
//                   → FAILED
//                   → CANCEL_REQUESTED → CANCELLED
//
// Terminal states (COMPLETED / CANCELLED / FAILED) never transition
// back. All transitions are atomic CAS UPDATEs so a cancel racing
// completion produces exactly one winner.
//
// The pipeline checks isCancelRequested() before and after every
// stage, so no stage may begin once cancellation is requested.
// ============================================================

import { getDbPool } from "./db";
import { randomUUID } from "crypto";

export type GenerationRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export const ACTIVE_RUN_STATUSES: GenerationRunStatus[] = ["QUEUED", "RUNNING", "CANCEL_REQUESTED"];
export const TERMINAL_RUN_STATUSES: GenerationRunStatus[] = ["CANCELLED", "COMPLETED", "FAILED"];

/** Pipeline stage ids → consultant-facing labels (never raw stage names in UI). */
export const STAGE_LABELS: Record<string, string> = {
  planner: "Preparing document",
  writer: "Writing draft",
  qualityReviewer: "Checking quality",
  languageCalibrator: "Improving language",
  finalizer: "Finalizing document",
  factReviewer: "Verifying facts",
};
export const STAGE_ORDER = [
  "planner", "writer", "qualityReviewer", "languageCalibrator", "finalizer", "factReviewer",
] as const;

/** Heartbeat older than this while a run is active = probably interrupted. */
export const HEARTBEAT_STALE_MS = 45_000;

export interface GenerationRun {
  id: string;
  documentId: string;
  applicationId: string;
  studentId: string;
  status: GenerationRunStatus;
  currentStage: string | null;
  currentStageStartedAt: string | null;
  completedStages: number;
  totalStages: number;
  generationStartedAt: string | null;
  lastHeartbeatAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  createdAt: string;
  // Provider (OpenAI background response) state — persisted so a
  // PM2 restart can resume polling instead of double-billing.
  providerResponseId: string | null;
  providerResponseStatus: string | null;
  providerStage: string | null;
  providerStartedAt: string | null;
  providerLastCheckedAt: string | null;
  providerModel: string | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerReasoningTokens: number | null;
  providerCachedInputTokens: number | null;
  providerUsageStatus: string | null;
  stageFingerprint: string | null;
}

// ---------- lazy table ensure (idempotent, once per process) ----------
let ensurePromise: Promise<void> | null = null;
async function ensureGenerationRunsTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pool = getDbPool();
      await pool.execute(`CREATE TABLE IF NOT EXISTS generation_runs (
        id VARCHAR(36) PRIMARY KEY,
        document_id VARCHAR(36) NOT NULL,
        application_id VARCHAR(36) NOT NULL,
        student_id VARCHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
        current_stage VARCHAR(40) DEFAULT NULL,
        current_stage_started_at DATETIME(3) DEFAULT NULL,
        completed_stages INT NOT NULL DEFAULT 0,
        total_stages INT NOT NULL DEFAULT 6,
        generation_started_at DATETIME(3) DEFAULT NULL,
        last_heartbeat_at DATETIME(3) DEFAULT NULL,
        cancel_requested_at DATETIME(3) DEFAULT NULL,
        cancelled_at DATETIME(3) DEFAULT NULL,
        completed_at DATETIME(3) DEFAULT NULL,
        failed_at DATETIME(3) DEFAULT NULL,
        failure_message TEXT DEFAULT NULL,
        provider_response_id VARCHAR(128) DEFAULT NULL,
        provider_response_status VARCHAR(32) DEFAULT NULL,
        provider_stage VARCHAR(40) DEFAULT NULL,
        provider_started_at DATETIME(3) DEFAULT NULL,
        provider_last_checked_at DATETIME(3) DEFAULT NULL,
        provider_model VARCHAR(64) DEFAULT NULL,
        provider_input_tokens INT DEFAULT NULL,
        provider_output_tokens INT DEFAULT NULL,
        provider_reasoning_tokens INT DEFAULT NULL,
        provider_cached_input_tokens INT DEFAULT NULL,
        provider_usage_status VARCHAR(24) DEFAULT NULL,
        stage_fingerprint VARCHAR(64) DEFAULT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        INDEX idx_runs_document (document_id, created_at),
        INDEX idx_runs_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await pool.execute(`CREATE TABLE IF NOT EXISTS generation_stage_responses (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL,
        document_id VARCHAR(36) NOT NULL,
        stage VARCHAR(40) NOT NULL,
        stage_fingerprint VARCHAR(64) NOT NULL,
        provider_response_id VARCHAR(128) NOT NULL,
        provider_response_status VARCHAR(32) NOT NULL,
        provider_model VARCHAR(64) DEFAULT NULL,
        input_tokens INT DEFAULT NULL,
        cached_input_tokens INT DEFAULT NULL,
        output_tokens INT DEFAULT NULL,
        reasoning_tokens INT DEFAULT NULL,
        usage_status VARCHAR(24) DEFAULT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        completed_at DATETIME(3) DEFAULT NULL,
        INDEX idx_gsr_fingerprint (stage, stage_fingerprint, provider_response_status),
        INDEX idx_gsr_run (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })();
  }
  return ensurePromise;
}

function rowToRun(row: any): GenerationRun {
  return {
    id: row.id,
    documentId: row.document_id,
    applicationId: row.application_id,
    studentId: row.student_id,
    status: row.status,
    currentStage: row.current_stage,
    currentStageStartedAt: row.current_stage_started_at ? new Date(row.current_stage_started_at).toISOString() : null,
    completedStages: row.completed_stages ?? 0,
    totalStages: row.total_stages ?? 6,
    generationStartedAt: row.generation_started_at ? new Date(row.generation_started_at).toISOString() : null,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toISOString() : null,
    cancelRequestedAt: row.cancel_requested_at ? new Date(row.cancel_requested_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    failedAt: row.failed_at ? new Date(row.failed_at).toISOString() : null,
    failureMessage: row.failure_message,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    providerResponseId: row.provider_response_id ?? null,
    providerResponseStatus: row.provider_response_status ?? null,
    providerStage: row.provider_stage ?? null,
    providerStartedAt: row.provider_started_at ? new Date(row.provider_started_at).toISOString() : null,
    providerLastCheckedAt: row.provider_last_checked_at ? new Date(row.provider_last_checked_at).toISOString() : null,
    providerModel: row.provider_model ?? null,
    providerInputTokens: row.provider_input_tokens ?? null,
    providerOutputTokens: row.provider_output_tokens ?? null,
    providerReasoningTokens: row.provider_reasoning_tokens ?? null,
    providerCachedInputTokens: row.provider_cached_input_tokens ?? null,
    providerUsageStatus: row.provider_usage_status ?? null,
    stageFingerprint: row.stage_fingerprint ?? null,
  };
}

// ---------- creation + progress ----------

export async function createGenerationRun(run: {
  id: string; documentId: string; applicationId: string; studentId: string;
}): Promise<void> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO generation_runs
       (id, document_id, application_id, student_id, status, generation_started_at, last_heartbeat_at)
     VALUES (?, ?, ?, ?, 'RUNNING', NOW(3), NOW(3))`,
    [run.id, run.documentId, run.applicationId, run.studentId],
  );
}

export async function markStageStarted(runId: string, stage: string): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs SET current_stage = ?, current_stage_started_at = NOW(3), last_heartbeat_at = NOW(3) WHERE id = ?`,
    [stage, runId],
  );
}

export async function markStageCompleted(runId: string): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs SET completed_stages = completed_stages + 1, last_heartbeat_at = NOW(3) WHERE id = ?`,
    [runId],
  );
}

export async function heartbeatRun(runId: string): Promise<void> {
  const pool = getDbPool();
  await pool.execute(`UPDATE generation_runs SET last_heartbeat_at = NOW(3) WHERE id = ?`, [runId]);
}

// ---------- cancellation ----------

/**
 * Atomically request cancellation for a document's active run.
 * Returns the resulting status:
 *   CANCEL_REQUESTED — transition applied, pipeline will stop at next boundary
 *   CANCELLED        — run was already cancelled
 *   ALREADY_TERMINAL — completed/failed; cancellation lost the race
 *   NOT_FOUND        — no active run
 */
export async function requestCancelGeneration(documentId: string): Promise<{
  result: "CANCEL_REQUESTED" | "CANCELLED" | "ALREADY_TERMINAL" | "NOT_FOUND";
  run: GenerationRun | null;
}> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs
       SET status = 'CANCEL_REQUESTED', cancel_requested_at = NOW(3)
     WHERE document_id = ? AND status IN ('QUEUED', 'RUNNING')
     ORDER BY created_at DESC LIMIT 1`,
    [documentId],
  );
  const run = await getLatestRun(documentId);
  if ((result as any).affectedRows === 1) {
    return { result: "CANCEL_REQUESTED", run };
  }
  if (!run) return { result: "NOT_FOUND", run: null };
  if (run.status === "CANCELLED") return { result: "CANCELLED", run };
  if (run.status === "CANCEL_REQUESTED") return { result: "CANCEL_REQUESTED", run };
  return { result: "ALREADY_TERMINAL", run };
}

/** CAS to CANCELLED — only from a non-terminal active state. */
export async function cancelRun(runId: string): Promise<boolean> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs SET status = 'CANCELLED', cancelled_at = NOW(3), current_stage = NULL
     WHERE id = ? AND status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')`,
    [runId],
  );
  return (result as any).affectedRows === 1;
}

/** CAS to COMPLETED — never overwrites CANCELLED. */
export async function completeRun(runId: string): Promise<boolean> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs SET status = 'COMPLETED', completed_at = NOW(3), current_stage = NULL
     WHERE id = ? AND status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')`,
    [runId],
  );
  return (result as any).affectedRows === 1;
}

/** CAS to FAILED — never overwrites a terminal state. */
export async function failRun(runId: string, message: string): Promise<boolean> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs SET status = 'FAILED', failed_at = NOW(3), current_stage = NULL, failure_message = ?
     WHERE id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')`,
    [message.slice(0, 2000), runId],
  );
  return (result as any).affectedRows === 1;
}

// ---------- queries ----------

export async function getLatestRun(documentId: string): Promise<GenerationRun | null> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT * FROM generation_runs WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`,
    [documentId],
  );
  const list = rows as any[];
  return list.length ? rowToRun(list[0]) : null;
}

export async function getRun(runId: string): Promise<GenerationRun | null> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [rows] = await pool.execute(`SELECT * FROM generation_runs WHERE id = ?`, [runId]);
  const list = rows as any[];
  return list.length ? rowToRun(list[0]) : null;
}

export async function isCancelRequested(runId: string): Promise<boolean> {
  const run = await getRun(runId);
  return run?.status === "CANCEL_REQUESTED";
}

export function isHeartbeatStale(run: GenerationRun): boolean {
  if (!ACTIVE_RUN_STATUSES.includes(run.status)) return false;
  const hb = run.lastHeartbeatAt || run.generationStartedAt;
  if (!hb) return true;
  return Date.now() - new Date(hb).getTime() > HEARTBEAT_STALE_MS;
}

/** Thrown by the pipeline when a cancel boundary is hit. */
export class GenerationCancelledError extends Error {
  constructor(stage?: string) {
    super(`Generation cancelled${stage ? ` before ${stage}` : ""}`);
    this.name = "GenerationCancelledError";
  }
}

// ---------- provider (background response) state ----------

/** Persist provider response identity BEFORE polling starts — restart safety. */
export async function setProviderState(runId: string, state: {
  stage: string; responseId: string; status: string; model: string; fingerprint: string;
}): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs
       SET provider_stage = ?, provider_response_id = ?, provider_response_status = ?,
           provider_model = ?, stage_fingerprint = ?, provider_started_at = NOW(3),
           provider_last_checked_at = NOW(3), provider_usage_status = NULL,
           provider_input_tokens = NULL, provider_output_tokens = NULL,
           provider_reasoning_tokens = NULL, provider_cached_input_tokens = NULL
     WHERE id = ?`,
    [state.stage, state.responseId, state.status, state.model, state.fingerprint, runId],
  );
}

export async function updateProviderCheck(runId: string, status: string): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs SET provider_response_status = ?, provider_last_checked_at = NOW(3) WHERE id = ?`,
    [status, runId],
  );
}

export async function setProviderUsage(runId: string, usage: {
  inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number;
} | null): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs
       SET provider_input_tokens = ?, provider_output_tokens = ?, provider_reasoning_tokens = ?,
           provider_cached_input_tokens = ?, provider_usage_status = ?
     WHERE id = ?`,
    usage
      ? [usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.cachedInputTokens, "OK", runId]
      : [null, null, null, null, "USAGE_UNKNOWN", runId],
  );
}

/** All runs in non-terminal states — used by restart recovery. */
export async function getActiveRuns(): Promise<GenerationRun[]> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT * FROM generation_runs WHERE status IN ('QUEUED','RUNNING','CANCEL_REQUESTED') ORDER BY created_at`,
  );
  return (rows as any[]).map(rowToRun);
}

/**
 * Find a provider response created for the same logical stage work
 * (stage + fingerprint). Used for restart recovery AND to prevent
 * double-billing: an existing queued/in_progress/completed response
 * for identical work is reused instead of creating a new one.
 */
export async function findReusableProviderResponse(stage: string, fingerprint: string): Promise<{
  runId: string; responseId: string; status: string;
} | null> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT run_id, provider_response_id, provider_response_status
       FROM generation_stage_responses
      WHERE stage = ? AND stage_fingerprint = ?
        AND provider_response_status IN ('queued','in_progress','completed')
      ORDER BY created_at DESC LIMIT 1`,
    [stage, fingerprint],
  );
  const list = rows as any[];
  if (!list.length) return null;
  return {
    runId: list[0].run_id,
    responseId: list[0].provider_response_id,
    status: list[0].provider_response_status,
  };
}

/** Record a new provider response for a stage (one row per attempt). */
export async function recordStageResponse(runId: string, documentId: string, state: {
  stage: string; fingerprint: string; responseId: string; status: string; model: string;
}): Promise<void> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO generation_stage_responses
       (id, run_id, document_id, stage, stage_fingerprint, provider_response_id,
        provider_response_status, provider_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), runId, documentId, state.stage, state.fingerprint, state.responseId, state.status, state.model],
  );
}

export async function updateStageResponseStatus(responseId: string, status: string): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_stage_responses SET provider_response_status = ?,
       completed_at = IF(? IN ('completed','failed','incomplete','cancelled'), NOW(3), completed_at)
     WHERE provider_response_id = ?`,
    [status, status, responseId],
  );
}

export async function setStageResponseUsage(responseId: string, usage: {
  inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number;
} | null): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_stage_responses
       SET input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, usage_status = ?
     WHERE provider_response_id = ?`,
    usage
      ? [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.reasoningTokens, "OK", responseId]
      : [null, null, null, null, "USAGE_UNKNOWN", responseId],
  );
}
