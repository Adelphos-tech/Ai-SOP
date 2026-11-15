// ============================================================
// AI Writing Review — provider-agnostic types (Brick 1)
// Detection and rewriting are delivered by pluggable providers.
// Detector scores are never fabricated: a provider that is not
// connected reports NOT_CONNECTED/UNAVAILABLE, never a number.
// ============================================================

/** Detectors surfaced on the dashboard. Turnitin has no supported
 *  integration path; it is registered so its card can be honest. */
export type DetectorId =
  | "RYNE_AI"
  | "TURNITIN"
  | "GPTZERO"
  | "ZEROGPT"
  | "REILAA"
  | "ORIGINALITY"
  | "QUILLBOT"
  | "SURFER";

export type DetectorStatusKind =
  | "NOT_CONNECTED"  // integration path exists, credentials/config missing
  | "UNAVAILABLE"    // no supported API path exists for this provider
  | "PENDING"        // a check was requested but no result yet
  | "SCORED"         // a genuine provider response was received
  | "ERROR";         // provider call failed

/** Score semantics: what the numeric field actually means, per the
 *  provider's documentation — never reinterpreted as another metric. */
export type ScoreMeaning =
  | "AI_PROBABILITY_PERCENT"   // probability the text is AI-written, 0-100
  | "RAW_MODEL_SIGNAL_PERCENT" // Reilaa: uncalibrated signal x100, not a probability
  | "CLASSIFICATION_ONLY";     // provider returned a label, no numeric score

export interface ProviderError {
  detector: DetectorId;
  code: string;
  message: string;
  retryable: boolean;
}

export interface DetectionRequest {
  documentId: string;
  versionId: string;
  content: string;
  /** Detectors to query; defaults to all configured registry entries. */
  detectors?: DetectorId[];
}

export interface DetectorScore {
  detector: DetectorId;
  status: DetectorStatusKind;
  /** Genuine provider signal only — present iff status === "SCORED". */
  scorePercent?: number;
  /** What scorePercent/classification mean for this provider. */
  scoreMeaning?: ScoreMeaning;
  /** Provider's own label (e.g. "HUMAN_ONLY", "AI_ONLY", "MIXED"). */
  classification?: string;
  /** Which detector actually produced the result (Ryne `source`
 *  field), when a fallback ran it differs from `detector`. */
  source?: string;
  /** Requested vs actual provider, per Ryne's `fallback` object. */
  fallback?: { from: string; to: string };
  /** Reilaa-style document-level vs sentence-level evidence. */
  granularity?: "DOCUMENT" | "SENTENCE";
  lastCheckedAt?: string;
  /** Provider error detail when status === "ERROR". */
  error?: ProviderError;
  /** Honest explanation shown in the card ("Not connected — needs RYNE_API_KEY"). */
  note?: string;
}

/** A flagged region of the document, anchored by character offsets
 *  into the version content it was produced from. Never match by
 *  global text search — ranges only. */
export interface FlaggedPassage {
  id: string;
  detector: DetectorId;
  start: number; // inclusive, UTF-16 code units into version content
  end: number;   // exclusive
  /** The text slice at [start,end) when the check ran. */
  text: string;
  scorePercent?: number;
  explanation?: string;
}

export interface DetectionResult {
  /** Version the passages were computed against. */
  baseVersionId: string;
  /** sha256-16 of the content checked — staleness is hash-compare. */
  contentHash: string;
  checkedAt: string;
  scores: DetectorScore[];
  passages: FlaggedPassage[];
}

export interface RewriteProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  supportedModes: string[];
  note?: string;
}

export interface RewriteSuggestion {
  passageId: string;
  rewrittenText: string;
  provider: string;
  mode?: string;
}

export type RevisionStatus = "APPROVED" | "REJECTED" | "EDITED";

/** A consultant decision on one flagged passage. Manual edits count
 *  as EDITED and keep the suggestion text for the history tab. */
export interface DocumentRevision {
  id: string;
  passageId: string;
  passageStart: number;
  passageEnd: number;
  originalText: string;
  suggestionText: string;
  /** Final text applied when status is EDITED. */
  editedText?: string;
  status: RevisionStatus;
  /** True once the revision's text has actually been written into the
   *  draft — prevents bulk apply from replaying an applied revision. */
  applied?: boolean;
  createdAt: string;
  decidedAt?: string;
}

/** Honest summary of a check run — counts by state, never an
 *  invented composite score. No overall percentage exists unless a
 *  provider documents one. */
export interface AnalysisSummary {
  checkedAt?: string;
  total: number;
  scored: number;
  pending: number;
  notConnected: number;
  unavailable: number;
  failed: number;
  /** Detectors that returned a document-level score only. */
  documentLevel: DetectorId[];
  /** Detectors that returned sentence-level findings. */
  sentenceLevel: DetectorId[];
}
