// ============================================================
// AI Writing Studio — detection report aggregation (pure, no I/O)
// Collapses per-detector sentence findings onto UNIQUE document
// sentences: one entry per sentence, listing every detector that
// flagged it with that detector's own score. Counts are against the
// document's real sentence total — never a sum across detectors.
// No composite percentage is ever computed.
// ============================================================

import type { DetectionResult, DetectorId, DetectorScore, FlaggedPassage } from "./types";
import { resolvePassageRange, segmentDocumentSentences } from "./segmentation";

export interface DetectorFlag {
  detector: DetectorId;
  scorePercent?: number;
  isAI?: boolean;
}

export interface SentenceFinding {
  /** Document sentence index, or null when the flagged range does not
   *  coincide with a segmented sentence (kept by its own range). */
  sentenceIndex: number | null;
  start: number;
  end: number;
  text: string;
  detectors: DetectorFlag[];
}

export interface ReportAggregate {
  totalSentences: number;
  flaggedSentences: number;
  findings: SentenceFinding[];
  /** Detectors that returned a score but no sentence-level evidence. */
  documentLevelOnly: DetectorId[];
}

export function aggregateFindings(content: string, passages: FlaggedPassage[], scores: DetectorScore[] = []): ReportAggregate {
  const sentences = segmentDocumentSentences(content);
  const groups = new Map<string, SentenceFinding>();
  for (const p of passages) {
    const range = resolvePassageRange(content, p);
    if (!range) continue; // text no longer present — never re-anchored by guesswork
    const s = sentences.find(x => range.start < x.end && range.end > x.start);
    const key = s ? `s${s.index}` : `r${range.start}:${range.end}`;
    const g = groups.get(key) ?? {
      sentenceIndex: s?.index ?? null,
      start: s?.start ?? range.start,
      end: s?.end ?? range.end,
      text: s?.text ?? p.text,
      detectors: [],
    };
    const prev = g.detectors.find(d => d.detector === p.detector);
    if (!prev) g.detectors.push({ detector: p.detector, scorePercent: p.scorePercent, isAI: p.isAI });
    else if ((p.scorePercent ?? -1) > (prev.scorePercent ?? -1)) prev.scorePercent = p.scorePercent;
    groups.set(key, g);
  }
  const findings = [...groups.values()].sort((a, b) => a.start - b.start);
  const withSentences = new Set(passages.map(p => p.detector));
  return {
    totalSentences: sentences.length,
    flaggedSentences: findings.length,
    findings,
    documentLevelOnly: scores
      .filter(s => s.status === "SCORED" && !withSentences.has(s.detector))
      .map(s => s.detector),
  };
}

/** A detector's own verdict: its classification label when present,
 *  otherwise its AI-probability score against 50%. Null = no verdict. */
export function detectorVerdict(s: DetectorScore): "AI" | "HUMAN" | "MIXED" | null {
  if (s.status !== "SCORED") return null;
  const c = (s.classification ?? "").toUpperCase();
  if (c.includes("MIXED")) return "MIXED";
  if (c.includes("AI")) return "AI";
  if (c.includes("HUMAN")) return "HUMAN";
  if (s.scoreMeaning === "AI_PROBABILITY_PERCENT" && typeof s.scorePercent === "number") {
    return s.scorePercent >= 50 ? "AI" : "HUMAN";
  }
  return null;
}

/** A stored report run (client-side history). */
export interface ReportRun {
  id: string;
  checkedAt: string;
  versionId: string;
  contentHash: string;
  detectors: DetectorId[];
  detection: DetectionResult;
}

// ---------- compact badge helpers (pure, unit-tested) ----------

/** The one detector score a compact badge may show: Reilaa first
 *  (Ryne's own standalone detector — same provider family as the
 *  rewrite's Beast Mode score), then the first other detector with a
 *  genuine numeric score. Errors, unconfigured detectors and
 *  scoreless responses yield null — a badge is never invented. */
export function primaryScore(scores: DetectorScore[], detectorIds?: string[]): DetectorScore | null {
  const pool = scores.filter(s =>
    s.status === "SCORED" && typeof s.scorePercent === "number" &&
    (!detectorIds || detectorIds.includes(s.detector)));
  return pool.find(s => s.detector === "REILAA") ?? pool[0] ?? null;
}

/** Latest stored run matching the exact version content — hash
 *  anchored, so a score from an older version is never shown as
 *  current. Returns the badge-eligible score or null. */
export function latestVersionScore(runs: ReportRun[], contentHash: string): DetectorScore | null {
  const match = runs
    .filter(r => r.contentHash === contentHash)
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  return match ? primaryScore(match.detection.scores, match.detectors) : null;
}

/** Worst (highest) Beast Mode score across sections — conservative
 *  single number for the badge; undefined when no section scored.
 *  This is the provider's unnamed-detector score of the rewrite,
 *  never conflated with a named-detector result. */
export function beastModeBadge(sections: { aiScore?: number }[]): number | undefined {
  const nums = sections.map(s => s.aiScore).filter((n): n is number => typeof n === "number");
  return nums.length ? Math.max(...nums) : undefined;
}

// ---------- sentence-fix staging (Brick 2) ----------

export interface SpanEdit { start: number; end: number; replacement: string }

/** Apply staged sentence replacements to the base document by their
 *  resolved {start,end} offsets only — never by re-searching text, so
 *  duplicate sentences can never hit the wrong instance. Edits are
 *  applied in descending start order; overlapping or out-of-bounds
 *  spans are rejected before any change is made. */
export function applySpanEdits(
  base: string,
  edits: SpanEdit[],
): { ok: true; content: string } | { ok: false; error: string } {
  for (const e of edits) {
    if (!Number.isInteger(e.start) || !Number.isInteger(e.end) ||
        e.start < 0 || e.end < e.start || e.end > base.length) {
      return { ok: false, error: "Staged fix has an invalid span — reload and stage it again." };
    }
  }
  const asc = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < asc.length; i++) {
    if (asc[i].start < asc[i - 1].end) {
      return { ok: false, error: "Staged fixes overlap — discard one and try again." };
    }
  }
  let out = base;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return { ok: true, content: out };
}

/** A stored run no longer describes the displayed version — every
 *  offset and score in it is stale, so fix/save actions must not run. */
export function isReportOutdated(run: { contentHash: string } | null | undefined, contentHash: string): boolean {
  return !!run && run.contentHash !== contentHash;
}

/** ≥80% of unique sentences flagged — a full-document humanize is a
 *  better next action than fixing sentences one by one. */
export function mostlyFlagged(agg: ReportAggregate | null | undefined): boolean {
  return !!agg && agg.totalSentences > 0 && agg.flaggedSentences / agg.totalSentences >= 0.8;
}
