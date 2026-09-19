// ============================================================
// STAGE OUTPUT SCHEMA REGISTRY
// ============================================================
// Single structural source of truth for all six AI stages.
// Flow: JSON.parse → normalizeStageOutput → schema.safeParse →
// domain validation (unchanged, in pipeline).
// ============================================================

import { z } from "zod";
import { PlannerOutputSchema } from "./planner.schema";
import { WriterOutputSchema } from "./writer.schema";
import { QualityReviewerOutputSchema } from "./quality-reviewer.schema";
import { LanguageCalibratorOutputSchema } from "./language-calibrator.schema";
import { FinalizerOutputSchema } from "./finalizer.schema";
import { FactReviewerOutputSchema } from "./fact-reviewer.schema";

export const STAGE_OUTPUT_SCHEMAS = {
  planner: PlannerOutputSchema,
  writer: WriterOutputSchema,
  qualityReviewer: QualityReviewerOutputSchema,
  languageCalibrator: LanguageCalibratorOutputSchema,
  finalizer: FinalizerOutputSchema,
  factReviewer: FactReviewerOutputSchema,
} as const;

export type StageSchemaName = keyof typeof STAGE_OUTPUT_SCHEMAS;

export {
  PlannerOutputSchema,
  WriterOutputSchema,
  QualityReviewerOutputSchema,
  LanguageCalibratorOutputSchema,
  FinalizerOutputSchema,
  FactReviewerOutputSchema,
};
