// ============================================================
// RESUME CANDIDATE — Docling-path intermediate schema
// ============================================================
// This is a PARSED CANDIDATE, not the canonical student profile.
// Every field may be absent — no invented defaults.
// Field-level provenance (source text + page) and confidence are
// used by the review UI and never persisted to canonical profile.
// ============================================================

import { z } from "zod";

export const DoclingBlockSchema = z.object({
  type: z.string(), // text | section_header | title | list_item | table_row | ...
  text: z.string(),
  page: z.number().int().nullable().optional(),
  order: z.number().int(),
  bbox: z.array(z.number()).length(4).nullable().optional(),
  level: z.number().int().nullable().optional(),
});

export const ParsedDocumentSchema = z.object({
  pages: z.number().int().optional(),
  ocrUsed: z.boolean().optional(),
  durationMs: z.number().optional(),
  blocks: z.array(DoclingBlockSchema),
  engine: z.literal("docling").optional(),
  doclingVersion: z.string().optional(),
  sourceHash: z.string().optional(),
});
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;
export type DoclingBlock = z.infer<typeof DoclingBlockSchema>;

export const ConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ProvenanceSchema = z.object({
  text: z.string(), // source text the value was extracted from
  page: z.number().int().nullable().optional(),
  blockOrders: z.array(z.number().int()).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export function withProvenance<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).extend({
    confidence: ConfidenceSchema.optional(),
    source: ProvenanceSchema.optional(),
  });
}

export const CandidateEducationSchema = withProvenance({
  institution: z.string().optional(),
  degree: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  gpa: z.string().optional(),
  maxGpa: z.string().optional(),
  startYear: z.string().optional(),
  endYear: z.string().optional(),
});

export const CandidateExperienceSchema = withProvenance({
  organization: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  bullets: z.array(z.string()).optional(),
});

export const CandidateProjectSchema = withProvenance({
  name: z.string().optional(),
  role: z.string().optional(),
  description: z.string().optional(),
  technologies: z.string().optional(),
});

export const ResumeCandidateSchema = z.object({
  personalData: withProvenance({
    fullName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    nationality: z.string().optional(),
    currentCity: z.string().optional(),
    currentCountry: z.string().optional(),
    linkedin: z.string().optional(),
    github: z.string().optional(),
  }).optional(),
  education: z.array(CandidateEducationSchema).default([]),
  experience: z.array(CandidateExperienceSchema).default([]),
  projects: z.array(CandidateProjectSchema).default([]),
  skills: z.object({
    technical: z.array(z.string()).default([]),
    programming: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    software: z.array(z.string()).default([]),
    domain: z.array(z.string()).default([]),
    soft: z.array(z.string()).default([]),
    languages: z.array(z.string()).default([]),
  }).default({}),
  certifications: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ResumeCandidate = z.infer<typeof ResumeCandidateSchema>;
