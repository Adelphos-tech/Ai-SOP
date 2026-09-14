/**
 * @file render-lifecycle-types.ts
 * @description
 * Type definitions for the render-aware finalization lifecycle.
 *
 * The render lifecycle has two deterministic (non-AI) render passes:
 *   1. PRE-FINAL RENDER — between Language Calibrator (stage 4) and Finalizer (stage 5)
 *   2. FINAL RENDER — after Final Fact Reviewer (stage 6)
 *
 * Both use the SAME RenderProfile (immutable during the attempt).
 * Neither makes OpenAI calls.
 */

import { RenderProfile } from "./render-profile";
import { DocumentPageValidation } from "./page-validator";

/* ------------------------------------------------------------------ */
/* Per-component render feedback                                       */
/* ------------------------------------------------------------------ */

export type RenderStatus =
  | "PASS"
  | "RENDER_OVERFLOW"
  | "RENDER_ENGINE_ERROR"
  | "NOT_APPLICABLE";

export interface RenderFeedbackComponent {
  componentId: string;
  label: string;
  actualPages: number;
  maxPages: number | null;
  status: RenderStatus;
  wordCount: number;
  characterCount: number;
  renderProfileId: string;
  /** Phase 14: Render pressure metrics (actual physical layout geometry) */
  contentHeightPx?: number;
  availableHeightPx?: number;
  overflowHeightPx?: number;
  overflowRatio?: number;
}

export interface RenderFeedback {
  components: RenderFeedbackComponent[];
  combinedActualPages: number;
  combinedMaxPages: number | null;
  combinedStatus: RenderStatus;
  renderProfileId: string;
  renderProfileVersion: string;
}

/* ------------------------------------------------------------------ */
/* Render lifecycle result                                             */
/* ------------------------------------------------------------------ */

export interface RenderLifecycleComponent {
  componentId: string;
  label: string;
  preFinalPages: number;
  finalPages: number;
  maxPages: number | null;
  preFinalStatus: RenderStatus;
  finalStatus: RenderStatus;
  preFinalWords: number;
  finalWords: number;
  preFinalCharacters: number;
  finalCharacters: number;
}

export interface RenderDeltaAnalytics {
  componentId: string;
  wordReductionPercent: number;
  characterReductionPercent: number;
  pageReduction: number;
}

export interface RenderLifecycleResult {
  profileId: string;
  profileVersion: string;
  profileImmutable: boolean;
  preFinal: {
    components: RenderFeedbackComponent[];
    combinedActualPages: number;
    combinedMaxPages: number | null;
    combinedStatus: RenderStatus;
  };
  final: {
    components: RenderFeedbackComponent[];
    combinedActualPages: number;
    combinedMaxPages: number | null;
    combinedStatus: RenderStatus;
  };
  componentComparison: RenderLifecycleComponent[];
  deltaAnalytics: RenderDeltaAnalytics[];
  hasOverflowPreFinal: boolean;
  hasOverflowFinal: boolean;
  anyCompressionAttempted: boolean;
}

/* ------------------------------------------------------------------ */
/* Fact ID references for Finalizer                                    */
/* ------------------------------------------------------------------ */

export interface FinalizerFactReferences {
  studentFactIds: string[];
  programSourceIds: string[];
  facultySourceIds: string[];
  applicationSpecificFactIds: string[];
}

/* ------------------------------------------------------------------ */
/* Extended Finalizer input                                            */
/* ------------------------------------------------------------------ */

export interface FinalizerRenderInput {
  renderFeedback: RenderFeedback | null;
  factReferences: FinalizerFactReferences | null;
  qualityReviewFindings: any | null;
}
