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
  // The score's semantics belong to the detector that PRODUCED it — on a
  // fallback run that is res.source, not the requested tool.
  const sourceDescriptor = listDetectorDescriptors().find(d => d.ryneTool === res.source)
    ?? descriptor;

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

  if (typeof res.aiScore !== "number" && !res.classification) {
    return {
      detector: requested ?? "REILAA",
      status: "ERROR",
      error: {
        detector: requested ?? "REILAA",
        code: "PROVIDER_ERROR",
        message: "Provider returned no score or classification",
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
    scoreMeaning: sourceDescriptor?.scoreMeaning,
    granularity,
    lastCheckedAt: checkedAt,
    note: res.fallback
      ? `Requested ${res.fallback.from}; result produced by ${res.fallback.to} — displayed under that provider's semantics.`
      : descriptor?.note,
  };
}

/** Per-sentence AI probability as a percent, from the documented or
 *  observed provider fields (GPTZero: aiProbability 0-100). */
function sentencePercent(s: Record<string, unknown>): number | undefined {
  for (const k of ["aiProbability", "score", "ai_probability"]) {
    if (typeof s[k] === "number" && Number.isFinite(s[k])) return s[k] as number;
  }
  if (typeof s.generated_prob === "number") return (s.generated_prob as number) * 100;
  return undefined;
}

/**
 * Map sentence-level findings to flagged passages by resolving each
 * provider-supplied sentence against the document with safe unique
 * matching. Only sentences the provider itself marks as AI are
 * flagged: an explicit isAI verdict, or — when no verdict exists —
 * a per-sentence probability of at least 50%. A sentence with
 * neither is not a finding: providers often list every sentence,
 * and unflagged ones must not be counted. When verdict and
 * probability conflict, the provider's explicit verdict wins.
 * Sentences that cannot be
 * resolved unambiguously are dropped — never anchored by guesswork.
 * Document-level responses produce no passages.
 */
export function mapSentenceFindings(
  content: string,
  detector: DetectorId,
  res: RyneAiScoreResponse,
): FlaggedPassage[] {
  const sentences = res.details?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) return [];
  const passages: FlaggedPassage[] = [];
  const seen = new Set<string>();
  sentences.forEach((s, i) => {
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!text) return;
    const isAI = typeof s.isAI === "boolean" ? s.isAI : undefined;
    const scorePercent = sentencePercent(s);
    if (isAI !== true && scorePercent === undefined) return;   // no verdict, no score → not a finding
    if (isAI === false || (isAI === undefined && scorePercent! < 50)) return;
    const range = resolvePassageRange(content, { start: -1, end: -1, text });
    if (!range) return; // ambiguous or absent → never fabricate an anchor
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) return; // provider listed the same sentence twice
    seen.add(key);
    passages.push({
      id: `${detector.toLowerCase()}-${i}`,
      detector,
      start: range.start,
      end: range.end,
      text,
      // Only assign a per-sentence score when the provider returned one.
      scorePercent,
      isAI,
      explanation: typeof s.explanation === "string" ? s.explanation : undefined,
    });
  });
  return passages;
}
