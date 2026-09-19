// ============================================================
// PLANNER — canonical structural schema (planner-v1)
// ============================================================
// Structural floor: componentPlans[] with componentId.
// All other fields optional-typed — the pipeline reads
// studentEvidenceIds/programEvidenceIds/facultyEvidenceIds
// (canonical) and tolerates legacy primaryEvidenceIds/
// secondaryEvidenceIds.
// ============================================================

import { z } from "zod";
import { componentArray, componentId, looseObject } from "./common";

export const PlannerComponentPlanSchema = looseObject({
  componentId,
  officialPrompt: z.string().optional(),
  requiredTopics: z.array(z.string()).optional(),
  studentEvidenceIds: z.array(z.string()).optional(),
  programEvidenceIds: z.array(z.string()).optional(),
  facultyEvidenceIds: z.array(z.string()).optional(),
  planningNotes: z.string().optional(),
  factsToOmit: z.array(z.string()).optional(),
  missingInformation: z.array(z.string()).optional(),
  narrativeStrategy: z.string().optional(),
  // Legacy names — tolerated for older checkpoints/outputs.
  primaryEvidenceIds: z.array(z.string()).optional(),
  secondaryEvidenceIds: z.array(z.string()).optional(),
});

export const PlannerOutputSchema = looseObject({
  componentPlans: componentArray(PlannerComponentPlanSchema),
});

export type PlannerOutputZ = z.infer<typeof PlannerOutputSchema>;
