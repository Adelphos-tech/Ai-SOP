// ============================================================
// AI Writing Review — local-only demo fixture
// Powers ?demo=1 on the review page so the interface can be
// exercised without provider credentials or paid API calls.
// HARD GATE: never usable in production builds, never returned
// by the API routes — client-side only.
// ============================================================

import type { DetectionResult, DetectorScore, FlaggedPassage } from "./types";
import { segmentDocumentSentences } from "./segmentation";
import { computeContentHash } from "./detectors";

/** Sentences that read as AI-ish; resolved to real offsets at runtime
 *  so nothing is fabricated — only literal text already in the doc
 *  can be flagged. */
const DEMO_FLAGGED_SNIPPETS = [
  "The rapidly evolving technological landscape has profoundly shaped my academic aspirations",
  "Pursuing a master's degree in Germany will provide me with the opportunity to gain in-depth knowledge",
  "In the long term, I aim to contribute to the development of innovative and sustainable technology solutions",
];

// Every string/number in this file is SIMULATED — fixtures are
// labeled in the UI and never stored to the database.
const DEMO_EXPLANATIONS: Record<number, string> = {
  0: "Sentence follows a generic AI-typical pattern: abstract landscape framing with no concrete detail.",
  1: "Catalogue phrasing ('gain in-depth knowledge, work with cutting-edge technologies') is common in generated SOPs.",
  2: "Closing statement uses a broad positive-impact formula without specific evidence.",
};

const DEMO_SUGGESTIONS: Record<number, string> = {
  0: "Advances in software engineering over the last few years have made me want to take my studies further, which is why I am applying to graduate programs in Germany.",
  1: "A master's degree in Germany would let me study these areas in depth, work with current technologies, and learn inside a strong academic environment.",
  2: "Over time, I want to help build technology solutions that are practical and sustainable, and I hope my work benefits the communities I come from.",
};

export function isDemoModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function buildDemoDetection(
  content: string,
  versionId: string,
): { result: DetectionResult; suggestions: Record<string, string> } | null {
  if (!isDemoModeAllowed()) return null;

  const sentences = segmentDocumentSentences(content);
  const passages: FlaggedPassage[] = [];
  const suggestions: Record<string, string> = {};

  DEMO_FLAGGED_SNIPPETS.forEach((snippet, i) => {
    const s = sentences.find(x => x.text.startsWith(snippet));
    if (!s) return;
    const id = `demo-${i}`;
    passages.push({
      id,
      detector: "REILAA",
      start: s.start,
      end: s.end,
      text: s.text,
      scorePercent: [71, 69, 64][i],
      explanation: `[Simulated] ${DEMO_EXPLANATIONS[i]}`,
    });
    suggestions[id] = DEMO_SUGGESTIONS[i];
  });

  const scores: DetectorScore[] = [
    {
      detector: "REILAA",
      status: "SCORED",
      scorePercent: 69,
      classification: "MIXED",
      scoreMeaning: "RAW_MODEL_SIGNAL_PERCENT",
      granularity: "SENTENCE",
      lastCheckedAt: new Date().toISOString(),
      note: "Simulated fixture — NOT a real Reilaa result.",
    },
    {
      detector: "RYNE_AI",
      status: "PENDING",
      note: "Simulated fixture — Ryne emits a score only after a rewrite run.",
    },
  ];

  return {
    result: {
      baseVersionId: versionId,
      contentHash: computeContentHash(content),
      checkedAt: new Date().toISOString(),
      scores,
      passages,
    },
    suggestions,
  };
}
