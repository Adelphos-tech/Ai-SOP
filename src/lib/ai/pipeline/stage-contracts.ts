// ============================================================
// STAGE CONTRACT REGISTRY
// ============================================================
// Single source of truth for each stage's output contract.
// Not model-generated — stamped onto parsed output in application
// code so future parsers can identify which contract produced a
// stored checkpoint.
// ============================================================

export type StageContractId =
  | "planner-v1"
  | "writer-v1"
  | "quality-reviewer-v2"
  | "language-calibrator-v2"
  | "finalizer-v1"
  | "fact-reviewer-v2";

export const STAGE_CONTRACT_VERSIONS: Record<string, StageContractId> = {
  planner: "planner-v1",
  writer: "writer-v1",
  qualityReviewer: "quality-reviewer-v2",   // compact: verifiedClaimIds, advisory fields optional
  languageCalibrator: "language-calibrator-v2", // compact: rewrittenText omittable
  finalizer: "finalizer-v1",
  factReviewer: "fact-reviewer-v2",          // compact: totals derived server-side
};

/**
 * Normalize harmless representation differences in a parsed stage
 * output BEFORE strict validation. Only safe, lossless transforms —
 * never reinterpret unknown values.
 *
 * factReviewer: `claim` is the canonical text field; some model
 * outputs use `text` instead (documented alias in FactClaim).
 * Copy `text`→`claim` when `claim` is absent so validators and
 * downstream consumers see one consistent shape.
 */
export function normalizeStageOutput(stage: string, raw: unknown): Record<string, any> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw as Record<string, any>; // non-object — schema will reject it
  }
  const output = raw as Record<string, any>;
  if (stage === "factReviewer" && Array.isArray(output.components)) {
    for (const comp of output.components) {
      if (Array.isArray(comp?.claims)) {
        for (const cl of comp.claims) {
          if (cl && typeof cl === "object" && typeof cl.claim !== "string" && typeof cl.text === "string") {
            cl.claim = cl.text;
          }
        }
      }
    }
  }
  if (stage === "factReviewer" && output.blockingReason === undefined) {
    output.blockingReason = null;
  }
  return output;
}
