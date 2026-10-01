// ============================================================
// OBSERVABILITY — canonical event envelope + persistence classes
// ============================================================
// Single emit point for structured operational events. Three rules:
//
//   1. WHITELISTED FIELDS ONLY. The envelope drops any key not in
//      EVENT_FIELDS, so a caller can never accidentally serialize a
//      name/email/prompt/document field. PII and content payloads are
//      structurally impossible, not convention-dependent.
//
//   2. NEVER THROWS. Telemetry failure must never crash generation —
//      console failures are swallowed after a last-resort stderr write.
//
//   3. IDs + ENUMS + COUNTS + CODES. No values: no applicant content,
//      no provider request/response bodies, no auth material.
// ============================================================

export type EventLevel = "info" | "warn" | "error";

/**
 * Persistence classification — the canonical decision every durable
 * write must be assigned. NOT implicit: if a write isn't listed here
 * it doesn't exist as far as reliability guarantees are concerned.
 *
 * CORE_STATE  — required for correct recovery/ownership. A failed
 *               CORE_STATE write must NEVER be silently swallowed:
 *               retry once, then halt with a typed error.
 * ACCOUNTING  — cost/usage evidence. Failure → warn event, continue.
 * TELEMETRY   — diagnostic/status-history. Failure → warn event, continue.
 */
export type PersistenceClass = "CORE_STATE" | "ACCOUNTING" | "TELEMETRY";

export const PERSISTENCE_CLASS: Record<string, PersistenceClass> = {
  // --- generation_runs core state ---
  runCreate: "CORE_STATE",
  runStatusTransition: "CORE_STATE",      // failRun / markRunRecovering / completeRun / cancelRun / claimRunForResume
  documentOwnership: "CORE_STATE",        // acquireGenerationLock / adoptRunOwnership / releaseDocumentGeneration
  documentVersionWrite: "CORE_STATE",     // createDocumentVersion
  // --- provider response identity (restart-safe reuse) ---
  providerResponseIdentity: "CORE_STATE", // setProviderState — run.provider_response_id
  stageResponseRecord: "CORE_STATE",      // recordStageResponse — dedup index
  providerTerminalDiagnostics: "CORE_STATE", // updateProviderCheck terminal / updateStageResponseStatus terminal
  // --- provider status history (intermediate polls) ---
  providerPollStatus: "TELEMETRY",        // updateProviderCheck onStatus tick
  stageResponseStatus: "TELEMETRY",       // updateStageResponseStatus non-terminal
  // --- accounting ---
  providerUsage: "ACCOUNTING",            // setProviderUsage / setStageResponseUsage
  usageLedgerRow: "ACCOUNTING",           // logs/openai-usage.jsonl
  // --- observability only ---
  stageProgress: "TELEMETRY",             // markStageStarted / markStageCompleted
  heartbeat: "TELEMETRY",                 // heartbeatRun — a missed beat only
                                          // hastens recovery detection (fail-safe direction)
  consoleEvent: "TELEMETRY",
} as const;

/** Whitelisted envelope keys. Anything else is dropped silently. */
const EVENT_FIELDS = new Set([
  "event", "timestamp", "level",
  "requestId",
  "generationId", "generationRunId", "attemptSeq", "oldAttemptSeq", "newAttemptSeq",
  "documentId", "applicationId", "studentId", "actorId",
  "stage", "stageIndex", "status", "code", "errorCode", "errorClass", "reason", "detail",
  "durationMs",
  "provider", "model", "providerResponseId",
  "retryNumber", "recoveryCount",
  "reusedCheckpoint", "reusedProviderResponse", "requestKind",
  "inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens",
  "costUsd", "usageStatus",
  "buildId", "missing", "versionId", "versionNumber", "via",
  "fingerprint", "stages", "operation", "resumeRunId", "blockReasons",
  // CV / lifecycle (ids + counts only — never values)
  "fileSize", "mimeType", "strategy", "coverage", "sections", "rawTextLength",
  "fallbackUsed", "attempts", "removedCvItems",
  "documentType", "university",
]);

const MAX_STR = 300;

function sanitizeValue(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (Array.isArray(v)) return v.slice(0, 20).map(sanitizeValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined || typeof val === "function") continue;
      out[k] = sanitizeValue(val);
    }
    return out;
  }
  return v === undefined ? null : v;
}

/**
 * Emit one structured telemetry event. Never throws, never logs
 * non-whitelisted keys. `fields` may include any subset of the
 * envelope; `event` is the only required key.
 */
export function emitEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: EventLevel = "info",
): void {
  try {
    const out: Record<string, unknown> = {
      event,
      timestamp: new Date().toISOString(),
      level,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (!EVENT_FIELDS.has(k)) continue;
      out[k] = sanitizeValue(v);
    }
    const line = JSON.stringify(out);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    // Telemetry must never crash the product. Last-resort write.
    try { console.error(`{"event":"telemetry_emit_failed","level":"error"}`); } catch { /* give up */ }
  }
}

/** Stable internal codes used across persistence/observability. */
export const OBSERVABILITY_ERROR_CODES = {
  STATE_PERSISTENCE_FAILED: "GENERATION_STATE_PERSISTENCE_FAILED",
  CHECKPOINT_PERSISTENCE_FAILED: "GENERATION_CHECKPOINT_PERSISTENCE_FAILED",
} as const;
