// ============================================================
// LANGUAGE CALIBRATOR — canonical structural schema
// (language-calibrator-v2, compact contract)
// ============================================================
// CRITICAL null-vs-omitted semantics preserved:
//   rewrittenText omitted (undefined) → claim preserved verbatim
//   rewrittenText = null              → claim dropped → domain
//                                       violation downstream
// `.nullish()` permits BOTH and preserves the distinction — it does
// NOT collapse the states.
// ============================================================

import { z } from "zod";
import { componentArray, componentId, stageObject, nonEmptyText } from "./common";

export const ClaimMapEntrySchema = stageObject({
  claimId: z.string().optional(),
  // null is preserved (means "dropped") — NOT collapsed to undefined.
  rewrittenText: z.string().nullish(),
});

export const LanguageCalibratorResponseSchema = stageObject({
  componentId,
  text: nonEmptyText,
  claimMap: z.array(ClaimMapEntrySchema).optional(),
});

export const LanguageCalibratorOutputSchema = stageObject({
  responses: componentArray(LanguageCalibratorResponseSchema),
});

export type LanguageCalibratorOutputZ = z.infer<typeof LanguageCalibratorOutputSchema>;
