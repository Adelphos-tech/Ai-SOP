// ============================================================
// FINALIZER — canonical structural schema (finalizer-v1)
// ============================================================
// Claim metadata keys (retainedClaimIds / removedClaimIds /
// repairClaims) must be PRESENT as arrays — that invariant was
// enforced by parseStage and is structural.
//
// The non-empty-metadata rule for non-FREEZE actions is a DOMAIN
// check requiring action-plan context — it stays in parseStage /
// validateFinalizerClaims, not here.
// ============================================================

import { z } from "zod";
import { componentArray, componentId, stageObject, nonEmptyText } from "./common";

export const FinalizerResponseSchema = stageObject({
  componentId,
  text: nonEmptyText,
  retainedClaimIds: z.array(z.string()),
  removedClaimIds: z.array(z.string()),
  // Element shape is domain-validated (topicId/evidence allowlists) —
  // structurally only array-ness is required (same as before).
  repairClaims: z.array(z.unknown()),
});

export const FinalizerOutputSchema = stageObject({
  responses: componentArray(FinalizerResponseSchema),
});

export type FinalizerOutputZ = z.infer<typeof FinalizerOutputSchema>;
