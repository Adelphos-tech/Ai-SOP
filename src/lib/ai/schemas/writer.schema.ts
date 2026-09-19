// ============================================================
// WRITER — canonical structural schema (writer-v1)
// ============================================================
// Structural floor: responses[] with componentId + non-empty text.
// Claim metadata fields are optional-typed (the claim extractor
// tolerates missing fields — generates claimIds, defaults arrays).
// Closed-world evidence validation stays in
// validateWriterEvidenceReferences (domain, not structural).
// ============================================================

import { z } from "zod";
import { componentArray, componentId, looseObject, nonEmptyText } from "./common";

export const WriterClaimSchema = looseObject({
  claimId: z.string().optional(),
  claim: z.string().optional(),
  text: z.string().optional(),
  claimType: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  supportMode: z.string().optional(),
});

export const WriterResponseSchema = looseObject({
  componentId,
  text: nonEmptyText,
  title: z.string().optional(),
  usedEvidenceIds: z.array(z.string()).optional(),
  factualClaims: z.array(WriterClaimSchema).optional(),
});

export const WriterOutputSchema = looseObject({
  responses: componentArray(WriterResponseSchema),
});

export type WriterOutputZ = z.infer<typeof WriterOutputSchema>;
