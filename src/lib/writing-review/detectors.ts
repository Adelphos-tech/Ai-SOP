// ============================================================
// AI Writing Review — detector registry (Brick 1B)
// Every detector reachable through Ryne's documented API is
// registered with its real integration path. Cards are built
// dynamically from this registry — no fabricated scores.
// ============================================================

import { createHash } from "crypto";
import type {
  AnalysisSummary,
  DetectorId,
  DetectorScore,
  RewriteProviderStatus,
} from "./types";

export interface DetectorDescriptor {
  detector: DetectorId;
  name: string;
  /** Supported way to reach this provider, if any. */
  integration: "RYNE_AI_SCORE" | "RYNE_BEAST_MODE" | "NONE";
  /** `tool` header value for POST https://ryne.ai/api/ai-score.
   *  "reilaa" is the documented default; omitting `tool` also works. */
  ryneTool?: string;
  /** What a real score means for this provider, per Ryne docs. */
  scoreMeaning: DetectorScore["scoreMeaning"];
  /** Reilaa-style document-level vs sentence-level evidence. */
  granularity: "DOCUMENT" | "SENTENCE" | "UNKNOWN";
  configured: boolean;
  note: string;
}

function ryneConfigured(): boolean {
  return Boolean(process.env.RYNE_API_KEY && process.env.RYNE_API_KEY.trim());
}

/**
 * Verified against https://ryne.ai/api-docs:
 * - POST /api/ai-score, body {text, user_id}; optional headers
 *   `tool` (reilaa default | gptzero | zerogpt | originality |
 *   quillbot | surfer) and `fallback-tool` (default zerogpt, or none).
 * - Reilaa: aiScore = uncalibrated model signal x100 (NOT an AI
 *   probability), classification HUMAN_ONLY/AI_ONLY, document-level
 *   only (details.sentences always empty).
 * - Other tools use their provider's semantics; MIXED possible.
 * - Ryne's own score is emitted only by the humanizer Beast Mode —
 *   there is no standalone Ryne detection endpoint.
 * - Turnitin: no documented endpoint → UNAVAILABLE.
 */
export function listDetectorDescriptors(): DetectorDescriptor[] {
  const ryne = ryneConfigured();
  const via = (tool: string, extra: string) => ryne
    ? `Connected via Ryne AI Score (tool: ${tool}). Run a check to fetch a genuine score.${extra}`
    : `Not connected — needs RYNE_API_KEY. Fetched via Ryne AI Score (tool: ${tool}).${extra}`;

  return [
    {
      detector: "RYNE_AI",
      name: "Ryne AI",
      integration: "RYNE_BEAST_MODE",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "DOCUMENT",
      configured: ryne,
      note: ryne
        ? "Score is emitted by Beast Mode after a Ryne rewrite; run a rewrite to get a Ryne score."
        : "Not connected — RYNE_API_KEY is not configured. Ryne emits a score only after a humanizer run (Beast Mode).",
    },
    {
      detector: "TURNITIN",
      name: "Turnitin",
      integration: "NONE",
      scoreMeaning: undefined,
      granularity: "UNKNOWN",
      configured: false,
      note: "Unavailable — Turnitin has no supported API integration for this workspace.",
    },
    {
      detector: "GPTZERO",
      name: "GPTZero",
      integration: "RYNE_AI_SCORE",
      ryneTool: "gptzero",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "UNKNOWN",
      configured: ryne,
      note: via("gptzero", ""),
    },
    {
      detector: "ZEROGPT",
      name: "ZeroGPT",
      integration: "RYNE_AI_SCORE",
      ryneTool: "zerogpt",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "UNKNOWN",
      configured: ryne,
      note: via("zerogpt", ""),
    },
    {
      detector: "REILAA",
      name: "Reilaa",
      integration: "RYNE_AI_SCORE",
      ryneTool: "reilaa",
      scoreMeaning: "RAW_MODEL_SIGNAL_PERCENT",
      granularity: "DOCUMENT",
      configured: ryne,
      note: via("reilaa", " Document-level signal only — no sentence findings."),
    },
    {
      detector: "ORIGINALITY",
      name: "Originality.ai",
      integration: "RYNE_AI_SCORE",
      ryneTool: "originality",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "UNKNOWN",
      configured: ryne,
      note: via("originality", ""),
    },
    {
      detector: "QUILLBOT",
      name: "QuillBot",
      integration: "RYNE_AI_SCORE",
      ryneTool: "quillbot",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "UNKNOWN",
      configured: ryne,
      note: via("quillbot", ""),
    },
    {
      detector: "SURFER",
      name: "Surfer",
      integration: "RYNE_AI_SCORE",
      ryneTool: "surfer",
      scoreMeaning: "AI_PROBABILITY_PERCENT",
      granularity: "UNKNOWN",
      configured: ryne,
      note: via("surfer", ""),
    },
  ];
}

/** Current card states. Brick 1B: no provider calls — every real card
 *  is NOT_CONNECTED or UNAVAILABLE until Brick 2 wires the checks. */
export function listDetectorStatuses(): DetectorScore[] {
  return listDetectorDescriptors().map(d => ({
    detector: d.detector,
    status: d.integration === "NONE" ? "UNAVAILABLE" : d.configured ? "PENDING" : "NOT_CONNECTED",
    scoreMeaning: d.scoreMeaning,
    granularity: d.granularity === "UNKNOWN" ? undefined : d.granularity,
    note: d.note,
  }));
}

export function ryneRewriteStatus(): RewriteProviderStatus {
  const configured = ryneConfigured();
  return {
    id: "ryne-humanizer",
    name: "Ryne AI Humanizer",
    configured,
    supportedModes: ["balanced", "titan"],
    note: configured
      ? "Connected. Rewrites are billed to prepaid Ryne credits."
      : "Not connected — RYNE_API_KEY is not configured.",
  };
}

/** sha256-16 content hash — staleness is a plain hash compare against
 *  the hash of the version the check ran on. */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** Counts by state — never a composite score. */
export function buildAnalysisSummary(scores: DetectorScore[], checkedAt?: string): AnalysisSummary {
  const summary: AnalysisSummary = {
    checkedAt, total: scores.length, scored: 0, pending: 0,
    notConnected: 0, unavailable: 0, failed: 0,
    documentLevel: [], sentenceLevel: [],
  };
  for (const s of scores) {
    switch (s.status) {
      case "SCORED":
        summary.scored++;
        if (s.granularity === "SENTENCE") summary.sentenceLevel.push(s.detector);
        else summary.documentLevel.push(s.detector);
        break;
      case "PENDING": summary.pending++; break;
      case "NOT_CONNECTED": summary.notConnected++; break;
      case "UNAVAILABLE": summary.unavailable++; break;
      case "ERROR": summary.failed++; break;
    }
  }
  return summary;
}
