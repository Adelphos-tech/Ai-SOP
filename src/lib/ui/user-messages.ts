// ============================================================
// USER MESSAGE CATALOG — human-readable error/notice layer.
//
// Every frontend-facing error must answer:
//   1. What happened?
//   2. What should the consultant do next?
//
// Internal codes are NEVER the headline. They live in
// technicalCode for support diagnostics only.
// ============================================================

export type MessageSeverity = "INFO" | "WARNING" | "ERROR" | "ACTION_REQUIRED";

export interface UserMessage {
  severity: MessageSeverity;
  title: string;
  description: string;
  actionLabel?: string;
  actionType?: "RETRY" | "EDIT" | "UPLOAD" | "REFRESH" | "CONTACT_SUPPORT" | "NONE";
  technicalCode?: string;
}

const CATALOG: Record<string, Omit<UserMessage, "technicalCode">> = {
  // ---- CV / resume import ----
  CV_EXTRACTION_FAILED: {
    severity: "ERROR",
    title: "We couldn't read this resume",
    description: "Try uploading a clearer PDF or DOCX, or enter the applicant information manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CV_EXTRACTION_EMPTY: {
    severity: "ERROR",
    title: "This file appears to be empty",
    description: "We couldn't find any text in this file. Upload a searchable PDF or DOCX, or fill in the details manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  IMAGE_ONLY_PDF: {
    severity: "ERROR",
    title: "This PDF looks like a scanned image",
    description: "Automatic text extraction didn't find readable content. Upload a searchable PDF or DOCX, or enter the details manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CORRUPT_OR_UNREADABLE_PDF: {
    severity: "ERROR",
    title: "This PDF can't be opened",
    description: "The file may be corrupted or password-protected. Export it again as a new PDF or DOCX and retry.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  INSUFFICIENT_TEXT: {
    severity: "ERROR",
    title: "Not enough resume text found",
    description: "This file has very little readable content. Upload the full resume, or enter the details manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CV_OCR_EXTRACTION_FAILED: {
    severity: "ERROR",
    title: "We couldn't read the scanned resume",
    description: "The scan may be too low-quality or a format we can't process. Try a clearer scan or a text PDF/DOCX.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CV_OCR_LIMIT_EXCEEDED: {
    severity: "ERROR",
    title: "This file is too large to scan",
    description: "Large scanned documents can't be processed. Upload a smaller file or enter the details manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CV_FILE_INVALID: {
    severity: "ERROR",
    title: "This file type isn't supported",
    description: "Upload a PDF or DOCX resume, or enter the applicant information manually.",
    actionLabel: "Upload a different file",
    actionType: "UPLOAD",
  },
  CV_PARSE_BUSY: {
    severity: "WARNING",
    title: "The resume service is busy",
    description: "Too many uploads are being processed right now. Wait a moment and try again.",
    actionLabel: "Try again",
    actionType: "RETRY",
  },
  FILE_TOO_LARGE: {
    severity: "ERROR",
    title: "This file is too large",
    description: "Upload a file under 10 MB.",
    actionLabel: "Upload a smaller file",
    actionType: "UPLOAD",
  },
  RATE_LIMITED: {
    severity: "WARNING",
    title: "Too many attempts",
    description: "Please wait a moment before trying again.",
    actionLabel: "Try again",
    actionType: "RETRY",
  },

  // ---- Generation ----
  GENERATION_BLOCKED: {
    severity: "ACTION_REQUIRED",
    title: "We need a little more information",
    description: "Review the missing details below and try again once they're filled in.",
    actionLabel: "Review intake",
    actionType: "EDIT",
  },
  GENERATION_ALREADY_IN_PROGRESS: {
    severity: "INFO",
    title: "Generation already running",
    description: "This document is already being generated. You can leave this page — progress continues in the background.",
    actionType: "NONE",
  },
  SCHEMA_MIGRATION_REQUIRED: {
    severity: "ERROR",
    title: "Generation is temporarily unavailable",
    description: "The application is being updated. Please try again in a few minutes, or contact support if this persists.",
    actionLabel: "Try again",
    actionType: "RETRY",
  },
  PROVIDER_INVALID_REQUEST: {
    severity: "ERROR",
    title: "We couldn't start this generation",
    description: "A configuration problem prevented generation from starting. Contact support if this persists.",
    actionType: "CONTACT_SUPPORT",
  },
  PROVIDER_RATE_LIMIT: {
    severity: "WARNING",
    title: "The writing service is busy",
    description: "Generation is temporarily rate-limited. Wait a minute and try again — your work is saved.",
    actionLabel: "Try again",
    actionType: "RETRY",
  },
  STAGE_TIMEOUT: {
    severity: "WARNING",
    title: "A generation step timed out",
    description: "One step took too long. Completed steps are saved — retry to continue from where it stopped.",
    actionLabel: "Retry generation",
    actionType: "RETRY",
  },
  CONTENT_JSON_INVALID: {
    severity: "ERROR",
    title: "The draft couldn't be assembled",
    description: "The generated content didn't pass a format check. Retry — completed steps are saved and won't be re-billed.",
    actionLabel: "Retry generation",
    actionType: "RETRY",
  },
  GENERATION_STATE_PERSISTENCE_FAILED: {
    severity: "ERROR",
    title: "Generation progress couldn't be saved",
    description: "A storage error interrupted the run. Retry — your intake and documents are safe.",
    actionLabel: "Retry generation",
    actionType: "RETRY",
  },
  RENDER_BUSY: {
    severity: "WARNING",
    title: "The renderer is busy",
    description: "Another operation is in progress. Wait a moment and try again.",
    actionLabel: "Try again",
    actionType: "RETRY",
  },

  // ---- Documents / requirements ----
  PAGE_LIMIT_WARNING: {
    severity: "WARNING",
    title: "This document is longer than the requested page limit",
    description: "You can shorten it before final export, or keep it — previews are always available.",
    actionType: "EDIT",
  },
  WRITING_REQUIREMENT_TYPE_MISMATCH: {
    severity: "ACTION_REQUIRED",
    title: "This requirement is for a different document type",
    description: "Choose a requirement that matches this document, or add a custom prompt instead.",
    actionLabel: "Edit document",
    actionType: "EDIT",
  },
  PROFILE_CHANGED: {
    severity: "ACTION_REQUIRED",
    title: "This profile was updated elsewhere",
    description: "Someone saved changes while you were editing. Refresh to see the latest version before saving yours.",
    actionLabel: "Refresh",
    actionType: "REFRESH",
  },
};

const FALLBACK: Omit<UserMessage, "technicalCode"> = {
  severity: "ERROR",
  title: "Something went wrong",
  description: "We couldn't complete that action. Please try again — if it keeps happening, contact support.",
  actionLabel: "Try again",
  actionType: "RETRY",
};

/**
 * Resolve a stable internal error code to consultant-facing copy.
 * Unknown codes get a safe generic message — internals never leak.
 */
export function getUserMessage(code: string | null | undefined): UserMessage {
  const entry = code ? CATALOG[code] : undefined;
  const base = entry || FALLBACK;
  return { ...base, technicalCode: code || undefined };
}

/** True when the code resolves to a real catalog entry. */
export function isKnownErrorCode(code: string | null | undefined): boolean {
  return !!code && code in CATALOG;
}
