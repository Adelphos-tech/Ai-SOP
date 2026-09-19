// ============================================================
// FACT REVIEWER — canonical structural schema (fact-reviewer-v2)
// ============================================================
// Compact contract: model omits derived totals; server computes
// them via deriveFactReviewTotals. Legacy outputs WITH totals are
// still accepted (validated when present).
//
// blockingReason: may be absent, null, or string → normalized to
// null when absent (normalizeStageOutput also handles this).
//
// claim: canonical text field; `text` is a tolerated legacy alias —
// normalized into `claim` by normalizeStageOutput before this runs,
// and also by the transform here for callers that skip the
// normalizer (validateFactReviewOutput).
// ============================================================

import { z } from "zod";
import { componentArray, componentId, stageObject, optionalCount } from "./common";

export const FACT_CLASSIFICATIONS = [
  "SUPPORTED_STUDENT_FACT",
  "SUPPORTED_PROGRAM_FACT",
  "SUPPORTED_FACULTY_FACT",
  "INTERPRETIVE_ELABORATION",
  "ALTERED_FACT",
  "INVENTED_FACT",
  "AMBIGUOUS",
] as const;

export const FACT_SEVERITIES = ["INFO", "WARNING", "BLOCKING"] as const;

export const FactClaimSchema = stageObject({
  // `text` alias tolerated; normalized to `claim` upstream.
  claim: z.string().optional(),
  text: z.string().optional(),
  classification: z.enum(FACT_CLASSIFICATIONS),
  supportingFactIds: z.array(z.string()),
  // Unused downstream — optional (compact contract drops it).
  supportingSourceIds: z.array(z.string()).optional(),
  severity: z.enum(FACT_SEVERITIES),
}).superRefine((cl, ctx) => {
  if (typeof cl.claim !== "string" && typeof cl.text !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "claim or text must be a string" });
  }
}).transform(cl => ({ ...cl, claim: cl.claim ?? cl.text! }));

export const FactReviewComponentSchema = stageObject({
  componentId,
  pass: z.boolean(),
  claims: z.array(FactClaimSchema),
  // Derived server-side — model may omit.
  inventedCount: optionalCount,
  alteredCount: optionalCount,
  elaborationCount: optionalCount,
  ambiguousCount: optionalCount,
});

export const FactReviewerOutputSchema = stageObject({
  components: componentArray(FactReviewComponentSchema),
  // Derived server-side by deriveFactReviewTotals — optional; if the
  // model emits them anyway they must be valid non-negative ints.
  totalInventedFacts: optionalCount,
  totalAlteredFacts: optionalCount,
  totalInterpretiveElaborations: optionalCount,
  totalAmbiguousClaims: optionalCount,
  overallPass: z.boolean(),
  // null | string | omitted → output type is string | null.
  blockingReason: z
    .string()
    .nullable()
    .optional()
    .transform(v => v ?? null),
});

export type FactReviewerOutputZ = z.infer<typeof FactReviewerOutputSchema>;
export type FactClaimZ = z.infer<typeof FactClaimSchema>;
export type FactReviewComponentZ = z.infer<typeof FactReviewComponentSchema>;
