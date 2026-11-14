// ============================================================
// AI Writing Review — Ryne API client (Brick 1B)
// Request/response mapping for the documented Ryne endpoints.
// NO live calls in Brick 1B — this maps provider JSON into our
// types so Brick 2 only has to add fetch + credential wiring.
//
// Documented endpoints (https://ryne.ai/api-docs):
//   POST /api/ai-score                      — detection
//   POST /api/humanizer/models/supernova    — rewriting
// ============================================================

import type { DetectorId, DetectorScore, FlaggedPassage } from "./types";
import { listDetectorDescriptors } from "./detectors";
import { resolvePassageRange } from "./segmentation";

/** `tool` header → registry detector. Verified from docs. */
const TOOL_TO_DETECTOR: Record<string, DetectorId> = Object.fromEntries(
  listDetectorDescriptors()
    .filter(d => d.ryneTool)
    .map(d => [d.ryneTool!, d.detector]),
);

/** Raw documented response of POST /api/ai-score. */
export interface RyneAiScoreResponse {
  /** Detector that actually produced the result — NOT necessarily the
   *  requested tool when a fallback ran. */
  source: string;
  /** For source=reilaa: uncalibrated model signal x100 — not an AI
   *  probability. Other providers use their own semantics. */
  aiScore?: number;
  classification?: string;
  color?: string;
  details?: {
    classification?: string;
    rawScore?: number;
    threshold?: number;
    scoreType?: string;
    granularity?: string;
    analysis?: Record<string, unknown>;
    /** Empty for document-level detectors (Reilaa). */
    sentences?: Array<{ text?: string; score?: number; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  fallback?: { from: string; to: string };
  error?: boolean;
  error_msg?: string;
}

/** Map a documented /api/ai-score response to DetectorScore.
 *  Returns an ERROR score for documented failure shapes — a failed
 *  detector is never reported as a 0% score. */
export function mapAiScoreResponse(
  requestedTool: string,
  res: RyneAiScoreResponse,
  checkedAt: string,
): DetectorScore {
  const requested = TOOL_TO_DETECTOR[requestedTool];
  const descriptor = listDetectorDescriptors().find(d => d.detector === requested);

  if (res.error || res.error_msg) {
    return {
      detector: requested ?? "REILAA",
      status: "ERROR",
      error: {
        detector: requested ?? "REILAA",
        code: "PROVIDER_ERROR",
        message: res.error_msg || "Provider returned an error",
        retryable: true,
      },
      note: "Check failed — a failed detector is not a 0% score.",
    };
  }

  const detector = requested
    ?? (Object.keys(TOOL_TO_DETECTOR).includes(res.source)
      ? TOOL_TO_DETECTOR[res.source] : "REILAA");

  const sentences = res.details?.sentences;
  const granularity =
    res.details?.granularity === "sentence" ||
    (Array.isArray(sentences) && sentences.length > 0)
      ? "SENTENCE"
      : "DOCUMENT";

  return {
    detector,
    status: "SCORED",
    scorePercent: typeof res.aiScore === "number" ? res.aiScore : undefined,
    classification: res.classification,
    source: res.source,
    fallback: res.fallback,
    scoreMeaning: descriptor?.scoreMeaning,
    granularity,
    lastCheckedAt: checkedAt,
    note: res.fallback
      ? `Requested ${res.fallback.from}; result produced by ${res.fallback.to} — displayed under that provider's semantics.`
      : descriptor?.note,
  };
}

/**
 * Map sentence-level findings to flagged passages by resolving each
 * provider-supplied sentence against the document with safe unique
 * matching. Sentences that cannot be resolved unambiguously are
 * dropped — never anchored by guesswork. Document-level responses
 * produce no passages.
 */
export function mapSentenceFindings(
  content: string,
  detector: DetectorId,
  res: RyneAiScoreResponse,
): FlaggedPassage[] {
  const sentences = res.details?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) return [];
  const passages: FlaggedPassage[] = [];
  sentences.forEach((s, i) => {
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!text) return;
    const range = resolvePassageRange(content, { start: -1, end: -1, text });
    if (!range) return; // ambiguous or absent → never fabricate an anchor
    passages.push({
      id: `${detector.toLowerCase()}-${i}`,
      detector,
      start: range.start,
      end: range.end,
      text,
      // Only assign a per-sentence score when the provider returned one.
      scorePercent: typeof s.score === "number" ? s.score : undefined,
      explanation: typeof s.explanation === "string" ? s.explanation : undefined,
    });
  });
  return passages;
}
