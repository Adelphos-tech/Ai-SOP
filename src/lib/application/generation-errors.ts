/**
 * @file generation-errors.ts
 * Central generation-failure classification. Single source of truth for:
 *   raw internal error → failure class → stable client code → friendly
 *   message → recovery policy.
 *
 * The frontend/status endpoint must NEVER surface raw strings like
 * "STAGE_TIMEOUT:factReviewer", "invalid_enum_value", or provider 4xx/5xx
 * bodies — everything normalizes through here.
 */

export type GenerationFailureClass =
  | "TRANSIENT_PROVIDER"      // provider hiccup — safe to retry/resume
  | "TECHNICAL_RECOVERABLE"   // pipeline-internal, resumable from checkpoint
  | "TECHNICAL_FATAL"         // cannot self-recover
  | "DATA_MISSING"            // genuinely missing applicant information
  | "CONTENT_WARNING"         // produced draft has content flags
  | "QUALITY_WARNING"         // quality advisories — draft exists
  | "COMPLIANCE_WARNING"      // word/page/format advisories — draft exists
  | "USER_ACTION_REQUIRED"    // consultant must act (e.g. conflict, blocked)
  | "INTERNAL";               // pipeline invariant bug — generic message

export interface NormalizedGenerationError {
  /** Stable client code — the ONLY code the UI should branch on. */
  code: string;
  class: GenerationFailureClass;
  /** Consultant-facing copy — no stage names, no provider jargon. */
  userMessage: string;
  /** A retry/resume can plausibly succeed. */
  recoverable: boolean;
  /** A provider response may still be running — hold for auto-resume. */
  resumable: boolean;
}

const DEFAULT: NormalizedGenerationError = {
  code: "GENERATION_INTERNAL_ERROR",
  class: "INTERNAL",
  userMessage: "Generation stopped because of an internal error. Your completed work is saved — retry continues from the last successful step.",
  recoverable: true,
  resumable: false,
};

interface Rule {
  match: RegExp;
  out: Partial<NormalizedGenerationError> & Pick<NormalizedGenerationError, "code" | "userMessage">;
}

const RULES: Rule[] = [
  // --- resumable provider slowness -------------------------------------
  {
    match: /^STAGE_TIMEOUT/,
    out: {
      code: "GENERATION_PROVIDER_DELAY",
      class: "TRANSIENT_PROVIDER",
      userMessage: "Generation is taking longer than expected. D-Vivid is recovering automatically — your completed steps are saved.",
      recoverable: true,
      resumable: true, // provider response may still be in_progress
    },
  },
  {
    match: /^GENERATION_TIME_LIMIT/,
    out: {
      code: "GENERATION_TIME_LIMIT",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "Generation exceeded the maximum allowed time. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },

  // --- persistence / state safety --------------------------------------
  // A CORE_STATE write failed — generation halted on purpose so no
  // second paid provider request can be created blindly. Resumable:
  // recovery re-reads durable state instead of re-creating work.
  {
    match: /^GENERATION_STATE_PERSISTENCE_FAILED/,
    out: {
      code: "GENERATION_STATE_PERSISTENCE_FAILED",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "Generation paused because progress could not be saved safely. Completed steps are preserved — retry resumes without repeating paid work.",
      recoverable: true,
      resumable: true,
    },
  },
  {
    match: /^GENERATION_CHECKPOINT_PERSISTENCE_FAILED/,
    out: {
      code: "GENERATION_CHECKPOINT_PERSISTENCE_FAILED",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "Generation paused because a completed step could not be saved. Retry resumes without repeating paid work.",
      recoverable: true,
      resumable: true,
    },
  },
  {
    match: /SCHEMA_MIGRATION_REQUIRED/,
    out: {
      code: "SCHEMA_MIGRATION_REQUIRED",
      class: "INTERNAL",
      userMessage: "Generation is temporarily unavailable because the application database requires an update.",
      recoverable: false,
      resumable: false,
    },
  },
  {
    match: /RUN_SUPERSEDED|GENERATION_SUPERSEDED|SUPERSEDED_BY_NEWER_RUN|GenerationSupersededError/,
    out: {
      code: "GENERATION_SUPERSEDED",
      class: "USER_ACTION_REQUIRED",
      userMessage: "A newer generation run now owns this document.",
      recoverable: false,
      resumable: false,
    },
  },
  {
    match: /GENERATION_NOT_RESUMABLE/,
    out: {
      code: "GENERATION_NOT_RESUMABLE",
      class: "USER_ACTION_REQUIRED",
      userMessage: "This generation run is no longer active — it was cancelled, completed, or superseded.",
      recoverable: false,
      resumable: false,
    },
  },

  // --- transient provider / transport ----------------------------------
  {
    match: /^PROVIDER_INVALID_REQUEST/,
    out: {
      code: "PROVIDER_INVALID_REQUEST",
      class: "INTERNAL",
      userMessage: "Generation stopped because of an internal error. Your completed work has been saved — retry continues from the last successful step.",
      recoverable: true,
      resumable: false,
    },
  },
  {
    match: /^PROVIDER_QUOTA/,
    out: {
      code: "PROVIDER_QUOTA",
      class: "TECHNICAL_FATAL",
      userMessage: "The AI service quota is exhausted. Please contact the administrator.",
      recoverable: false,
      resumable: false,
    },
  },
  {
    match: /^PROVIDER_(RATE_LIMIT|429)/,
    out: {
      code: "GENERATION_PROVIDER_DELAY",
      class: "TRANSIENT_PROVIDER",
      userMessage: "The AI service is rate-limited right now. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },
  {
    match: /^PROVIDER_(FAILED|POLL_FAILED|EMPTY_OUTPUT|SERVER_ERROR|NETWORK_ERROR|5\d\d)/,
    out: {
      code: "GENERATION_PROVIDER_DELAY",
      class: "TRANSIENT_PROVIDER",
      userMessage: "The AI service is temporarily unavailable. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },
  {
    match: /PROVIDER_(MAX_OUTPUT_TOKENS|INCOMPLETE)|Provider incomplete/i,
    out: {
      code: "GENERATION_PROVIDER_TRUNCATED",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "The AI response ended early. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },
  {
    match: /PROVIDER_CONTENT_FILTER/,
    out: {
      code: "GENERATION_CONTENT_FILTERED",
      class: "USER_ACTION_REQUIRED",
      userMessage: "The AI provider's safety filter blocked part of this document. Review the applicant information and try again.",
      recoverable: false,
      resumable: false,
    },
  },

  // --- model output contract deviations --------------------------------
  {
    match: /CONTENT_JSON_INVALID|CONTENT_SCHEMA_INVALID|AI_STAGE_SCHEMA_INVALID|EMPTY_CONTENT|FINALIZER_METADATA_INCOMPLETE/,
    out: {
      code: "GENERATION_STAGE_RECOVERY_REQUIRED",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "A processing step produced an unexpected format. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },

  // --- internal invariants — never name the check to the consultant ----
  {
    match: /STAGE_ORDER_VIOLATION|CHECKPOINT_INTEGRITY|STALE_CHECKPOINT|TECHNICAL_RETRY_LIMIT|RUN_NOT_ACTIVE|ATTEMPT_LOCKED|USAGE_RECORD_MISMATCH|INVALID_USAGE_RECORD|MULTIPLE_USAGE_RECORDS|LATE_USAGE_CALLBACK|INCOMPLETE_STAGE_CHAIN/,
    out: {
      code: "GENERATION_INTERNAL_ERROR",
      class: "INTERNAL",
      userMessage: "Generation stopped because of an internal error. Your completed work has been saved — retry continues from the last successful step.",
      recoverable: true,
      resumable: false,
    },
  },

  // --- domain / data ----------------------------------------------------
  {
    match: /MISSING_REQUIRED_STUDENT_INFORMATION|GENERATION_BLOCKED|GENERATION_CONTRACT_REQUIRED/,
    out: {
      code: "GENERATION_INPUT_INCOMPLETE",
      class: "DATA_MISSING",
      userMessage: "Some required applicant information is missing. Complete the flagged fields and try again.",
      recoverable: false,
      resumable: false,
    },
  },
  {
    match: /GENERATION_ALREADY_IN_PROGRESS|generation_lock_conflict/,
    out: {
      code: "GENERATION_ALREADY_IN_PROGRESS",
      class: "USER_ACTION_REQUIRED",
      userMessage: "A generation is already running for this document.",
      recoverable: false,
      resumable: false,
    },
  },
  {
    match: /FACT_REVIEWER_OUTPUT_INVALID/,
    out: {
      code: "GENERATION_STAGE_RECOVERY_REQUIRED",
      class: "TECHNICAL_RECOVERABLE",
      userMessage: "The final verification produced an unexpected result. Completed steps are saved — retry continues where it stopped.",
      recoverable: true,
      resumable: false,
    },
  },
  {
    match: /GENERATION_CANCELLED/,
    out: {
      code: "GENERATION_CANCELLED",
      class: "USER_ACTION_REQUIRED",
      userMessage: "Generation was cancelled.",
      recoverable: false,
      resumable: false,
    },
  },
];

/** Classify a raw internal error string/code into a normalized error. */
export function classifyGenerationError(raw: string | undefined | null): NormalizedGenerationError {
  const msg = raw || "";
  for (const rule of RULES) {
    if (rule.match.test(msg)) return { ...DEFAULT, ...rule.out, code: rule.out.code };
  }
  return { ...DEFAULT };
}
