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
import {
  assertGenerationLifecycleSchema,
} from "./generation-schema";
import { randomUUID } from "crypto";

export type GenerationRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "RECOVERING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

// ============================================================
// CANONICAL GENERATION STATUS DOMAIN — single source of truth.
// ============================================================
// Every status enumeration (SQL IN-lists, JS predicates, UI gating)
// MUST derive from these constants. Never write a literal status
// list for generation_runs elsewhere — a status added here must
// take effect everywhere at once (see GEN-003 audit finding).
// ============================================================

/** RECOVERING = active: heartbeat stops while the provider response keeps
 *  running server-side; stale-heartbeat recovery resumes the same run. */
export const ACTIVE_GENERATION_STATUSES: readonly GenerationRunStatus[] =
  ["QUEUED", "RUNNING", "RECOVERING", "CANCEL_REQUESTED"];

/** Back-compat alias — canonical name is ACTIVE_GENERATION_STATUSES. */
export const ACTIVE_RUN_STATUSES: readonly GenerationRunStatus[] = ACTIVE_GENERATION_STATUSES;

export const TERMINAL_RUN_STATUSES: readonly GenerationRunStatus[] = ["CANCELLED", "COMPLETED", "FAILED"];

/** Active statuses from which a cancellation request can be applied —
 *  CANCEL_REQUESTED is excluded (already requested). */
export const CANCELLABLE_RUN_STATUSES: readonly GenerationRunStatus[] =
  ACTIVE_GENERATION_STATUSES.filter(s => s !== "CANCEL_REQUESTED");

/** Statuses claimable by resume outright (status-flip serializes
 *  claimants). RUNNING is claimable only via the stale-heartbeat
 *  branch in claimRunForResume; CANCEL_REQUESTED is never claimable. */
export const RESUME_CLAIMABLE_RUN_STATUSES: readonly GenerationRunStatus[] = ["QUEUED", "RECOVERING"];

export function isActiveGenerationStatus(status: unknown): status is GenerationRunStatus {
  return typeof status === "string" && (ACTIVE_GENERATION_STATUSES as readonly string[]).includes(status);
}

export function isTerminalRunStatus(status: unknown): status is GenerationRunStatus {
  return typeof status === "string" && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** SQL IN-list fragment built from a canonical status list, e.g.
 *  `'QUEUED','RUNNING'`. Values are module-level constants only —
 *  never pass runtime/user input. */
export function runStatusInSql(statuses: readonly GenerationRunStatus[]): string {
  return statuses.map(s => `'${s}'`).join(",");
}

/** Active status IN-list fragment for SQL: ('QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED'). */
export const ACTIVE_RUN_STATUS_SQL = runStatusInSql(ACTIVE_GENERATION_STATUSES);
export const TERMINAL_RUN_STATUS_SQL = runStatusInSql(TERMINAL_RUN_STATUSES);

/** Max automatic recoveries per run before a recoverable failure is
 *  marked FAILED — prevents infinite resume loops on a permanently
 *  stuck provider response. */
export const MAX_RUN_RECOVERIES = 3;

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
  /** Strict total order over attempts — DB AUTO_INCREMENT, unique,
   *  immutable, non-null. The ONLY authority ordering field; created_at
   *  remains for display/logging only. */
  attemptSeq: number | null;
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
  providerErrorCode: string | null;
  providerIncompleteReason: string | null;
  stageFingerprint: string | null;
  recoveryCount: number;
  /** Aggregated generation warnings persisted at completion (codes only,
   *  no applicant content). */
  warnings: Array<{ code: string; message: string }> | null;
}

// ---------- runtime schema assertion (memoized, read-only) ----------
/**
 * Runtime schema assertion — READ-ONLY. All generation lifecycle and
 * repository operations call this first; it verifies required schema
 * (attempt_seq AUTO_INCREMENT UNIQUE, active_generation_run_id, ...)
 * via information_schema and throws SchemaMigrationRequiredError when
 * anything is missing. Schema changes are deployment-owned:
 * scripts/migrate-generation-ordering.ts — never request traffic.
 */
async function ensureGenerationRunsTable(): Promise<void> {
  await assertGenerationLifecycleSchema();
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
    attemptSeq: row.attempt_seq != null ? Number(row.attempt_seq) : null,
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
    providerErrorCode: row.provider_error_code ?? null,
    providerIncompleteReason: row.provider_incomplete_reason ?? null,
    stageFingerprint: row.stage_fingerprint ?? null,
    recoveryCount: row.recovery_count ?? 0,
    warnings: (() => { try { return row.warnings_json ? JSON.parse(row.warnings_json) : null; } catch { return null; } })(),
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
     WHERE document_id = ? AND status IN (${runStatusInSql(CANCELLABLE_RUN_STATUSES)})
     ORDER BY attempt_seq DESC LIMIT 1`,
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
     WHERE id = ? AND status IN (${ACTIVE_RUN_STATUS_SQL})`,
    [runId],
  );
  return (result as any).affectedRows === 1;
}

/** Back-compat alias for application-repository — the lifecycle
 *  assertion covers application_documents.active_generation_run_id too.
 *  READ-ONLY: throws SchemaMigrationRequiredError when schema is absent. */
export { assertGenerationLifecycleSchema as ensureGenerationLifecycleSchema };

/** CAS to COMPLETED — never overwrites CANCELLED, and never lets a
 *  superseded run complete: the document's active_generation_run_id
 *  must still be this run (or NULL for pre-ownership rows). Persists
 *  aggregated generation warnings (codes only, no applicant content). */
export async function completeRun(runId: string, warnings?: Array<{ code: string; message: string }>): Promise<boolean> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs gr
     JOIN application_documents d ON d.id = gr.document_id
     LEFT JOIN generation_runs newer
            ON newer.document_id = gr.document_id
           AND newer.attempt_seq > gr.attempt_seq
     SET gr.status = 'COMPLETED', gr.completed_at = NOW(3), gr.current_stage = NULL,
         gr.warnings_json = ?
     WHERE gr.id = ? AND gr.status IN (${ACTIVE_RUN_STATUS_SQL})
       AND (d.active_generation_run_id IS NULL OR d.active_generation_run_id = gr.id)
       AND newer.id IS NULL`,
    [warnings?.length ? JSON.stringify(warnings.map(w => ({ code: w.code, message: String(w.message || "").slice(0, 500) }))) : null, runId],
  );
  return (result as any).affectedRows === 1;
}

/**
 * CAS RUNNING → RECOVERING — the stage SLA fired while a provider
 * response is still in flight. The run stays active but heartbeat stops;
 * stale-heartbeat recovery resumes the SAME run and polls the SAME
 * provider response (no duplicate paid call). Bounded by
 * MAX_RUN_RECOVERIES — returns false when the budget is exhausted or
 * the run already left RUNNING, and the caller must fall back to FAILED.
 */
export async function markRunRecovering(runId: string, message: string): Promise<boolean> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs
        SET status = 'RECOVERING', failure_message = ?, recovery_count = recovery_count + 1
      WHERE id = ? AND status = 'RUNNING' AND recovery_count < ${MAX_RUN_RECOVERIES}`,
    [message.slice(0, 2000), runId],
  );
  return (result as any).affectedRows === 1;
}

/** Thrown by the pipeline when a stage boundary finds this run is no
 *  longer the document's authoritative generation — a newer run owns
 *  the document lock. The superseded run must stop without touching
 *  document state. */
export class GenerationSupersededError extends Error {
  constructor(stage?: string) {
    super(`RUN_SUPERSEDED${stage ? ` at ${stage}` : ""}`);
    this.name = "GenerationSupersededError";
  }
}

/**
 * Atomically claim a run for resume. Exactly one resumer wins:
 *   - QUEUED / RECOVERING → RUNNING (status flip serializes claimants)
 *   - RUNNING → claim only if its heartbeat is stale (orphaned — a live
 *     process's heartbeat stays fresh, so a live run can never be
 *     re-claimed underneath itself)
 *   - CANCEL_REQUESTED / terminal → claim fails (a cancelled run can
 *     never resume — cancel/recovery race resolves to cancel)
 * Returns true iff THIS caller claimed the run.
 */
export async function claimRunForResume(runId: string, staleAfterMs = 15_000): Promise<boolean> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  // A run may only resume when no LATER generation attempt exists for the
  // same document — a newer row (any status, including terminal) means a
  // newer explicit attempt was started, so this run is superseded.
  // Ordering is attempt_seq — DB AUTO_INCREMENT, strictly increasing and
  // unique: a strict total order with no ties. The LEFT JOIN anti-join
  // keeps the check atomic with the status CAS.
  const [result] = await pool.execute(
    `UPDATE generation_runs g
    LEFT JOIN generation_runs newer
           ON newer.document_id = g.document_id
          AND newer.attempt_seq > g.attempt_seq
        SET g.status = 'RUNNING', g.last_heartbeat_at = NOW(3)
      WHERE g.id = ? AND (
        g.status IN (${runStatusInSql(RESUME_CLAIMABLE_RUN_STATUSES)})
        OR (g.status = 'RUNNING' AND (g.last_heartbeat_at IS NULL
            OR g.last_heartbeat_at < DATE_SUB(NOW(3), INTERVAL ? MICROSECOND)))
      ) AND newer.id IS NULL`,
    [runId, Math.round(staleAfterMs * 1000)],
  );
  return (result as any).affectedRows === 1;
}

/** True when any run for the same document has a higher attempt_seq —
 *  i.e. a newer attempt exists and this run is superseded. attempt_seq is
 *  unique and strictly increasing: exactly one of (A newer, B newer)
 *  holds for any two distinct runs.
 *  Used to classify a failed resume claim: newer-run-exists → superseded,
 *  otherwise the run simply moved to a non-claimable state. */
export async function hasNewerGenerationRun(documentId: string, runId: string): Promise<boolean> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT 1 FROM generation_runs
      WHERE document_id = ?
        AND attempt_seq > (SELECT attempt_seq FROM generation_runs WHERE id = ?)
      LIMIT 1`,
    [documentId, runId],
  );
  return (rows as any[]).length > 0;
}

/** CAS to FAILED — never overwrites a terminal state. */
export async function failRun(runId: string, message: string): Promise<boolean> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE generation_runs SET status = 'FAILED', failed_at = NOW(3), current_stage = NULL, failure_message = ?
     WHERE id = ? AND status NOT IN (${TERMINAL_RUN_STATUS_SQL})`,
    [message.slice(0, 2000), runId],
  );
  return (result as any).affectedRows === 1;
}

// ---------- queries ----------

export async function getLatestRun(documentId: string): Promise<GenerationRun | null> {
  await ensureGenerationRunsTable();
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT * FROM generation_runs WHERE document_id = ? ORDER BY attempt_seq DESC LIMIT 1`,
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

export async function updateProviderCheck(runId: string, status: string, terminal?: {
  errorCode?: string; incompleteReason?: string; errorMessage?: string;
}): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_runs SET provider_response_status = ?, provider_last_checked_at = NOW(3),
       provider_error_code = COALESCE(?, provider_error_code),
       provider_incomplete_reason = COALESCE(?, provider_incomplete_reason),
       provider_error_message = COALESCE(?, provider_error_message)
     WHERE id = ?`,
    [status, terminal?.errorCode || null, terminal?.incompleteReason || null,
     terminal?.errorMessage ? terminal.errorMessage.slice(0, 1000) : null, runId],
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
    `SELECT * FROM generation_runs WHERE status IN (${ACTIVE_RUN_STATUS_SQL}) ORDER BY attempt_seq`,
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

export async function updateStageResponseStatus(responseId: string, status: string, terminal?: {
  errorCode?: string; incompleteReason?: string;
}): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `UPDATE generation_stage_responses SET provider_response_status = ?,
       completed_at = IF(? IN ('completed','failed','incomplete','cancelled'), NOW(3), completed_at),
       provider_error_code = COALESCE(?, provider_error_code),
       provider_incomplete_reason = COALESCE(?, provider_incomplete_reason)
     WHERE provider_response_id = ?`,
    [status, status, terminal?.errorCode || null, terminal?.incompleteReason || null, responseId],
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
