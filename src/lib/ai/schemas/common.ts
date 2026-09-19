// ============================================================
// Shared Zod helpers for AI stage output schemas
// ============================================================
// Structural validation ONLY — shape, types, enums, nullability.
// D-Vivid domain/safety rules (claim IDs, evidence allowlists,
// invented/altered fact policy, finalizer provenance) stay in the
// existing domain validators.
// ============================================================

import { z } from "zod";

/** Non-empty after trim — matches the legacy `text()` guard. No transform. */
export const nonEmptyText = z.string().refine(s => s.trim().length > 0, {
  message: "must be non-empty text",
});

/** componentId — required non-empty string. */
export const componentId = z.string().refine(s => s.trim().length > 0, {
  message: "componentId must be non-empty",
});

/**
 * Non-empty array of components with unique componentIds — the shared
 * "invalid component list" invariant every stage enforced in parseStage.
 */
export function componentArray<S extends z.ZodTypeAny>(item: S) {
  return z
    .array(item)
    .min(1, "component list must be non-empty")
    .superRefine((arr, ctx) => {
      const seen = new Set<string>();
      for (const item of arr) {
        const id = (item as any)?.componentId;
        if (typeof id === "string") {
          if (seen.has(id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate componentId "${id}"` });
          }
          seen.add(id);
        }
      }
    });
}

/**
 * Stage object — Zod default strip mode: harmless extra model fields
 * are ignored AND stripped from the canonical parsed output (never
 * rejected, but also never promoted into artifacts/checkpoints).
 * Safety-critical enum fields remain strict.
 * Safe because consumers re-parse the raw provider content; parseStage
 * output is only persisted to checkpoint/artifact files.
 */
export const stageObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape);

/** Optional non-negative integer (derived server-side when omitted). */
export const optionalCount = z.number().int().nonnegative().optional();
