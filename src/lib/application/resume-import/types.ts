/**
 * @file resume-import/types.ts
 * Normalized candidate model + coverage classification for the resilient
 * CV import pipeline. Every parser strategy must produce THIS shape —
 * no vendor/library-specific objects cross the boundary.
 */
import { z } from "zod";
import type { ParsedCV } from "../cv-parser";

// ============================================================
// STRATEGY IDENTITY / PROVENANCE
// ============================================================

export const RESUME_STRATEGY_IDS = [
  "MAMMOTH_SEMANTIC",    // mammoth text extraction + legacy semantic parser
  "DOCLING_MAPPER",      // docling blocks -> cv-mapper-docling
  "TEXT_EXTRACTION",     // raw text only, no semantic structure
  "OCR_TEXT_EXTRACTION", // free local OCR (rapidocr) — image-only fallback only
] as const;
export type ResumeStrategyId = (typeof RESUME_STRATEGY_IDS)[number];

export const RESUME_COVERAGE_STATUSES = [
  "GOOD",
  "PARTIAL",
  "EXTRACTION_ONLY",
  "UNREADABLE",
] as const;
export type ResumeCoverageStatus = (typeof RESUME_COVERAGE_STATUSES)[number];

export const RESUME_PARSE_STATES = [
  "PARSED",
  "PARSED_WITH_WARNINGS",
  "PARTIAL_PARSE",
  "EXTRACTION_ONLY",
  "FAILED_FILE",
] as const;
export type ResumeParseState = (typeof RESUME_PARSE_STATES)[number];

// ============================================================
// NORMALIZED CANDIDATE (Zod — single boundary shape)
// ============================================================

/** Safe, content-free diagnostics — never include resume text. */
export const ResumeDiagnosticsSchema = z.object({
  rawTextLength: z.number().int().nonnegative(),
  blockCount: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  engine: z.string().optional(),
  mapperVersion: z.string().optional(),
});
export type ResumeDiagnostics = z.infer<typeof ResumeDiagnosticsSchema>;

export const ResumeCoverageSchema = z.object({
  status: z.enum(RESUME_COVERAGE_STATUSES),
  /** deterministic structural signals — never AI-judged */
  personalFields: z.number().int().nonnegative(),
  educationCount: z.number().int().nonnegative(),
  experienceCount: z.number().int().nonnegative(),
  projectsCount: z.number().int().nonnegative(),
  skillsCount: z.number().int().nonnegative(),
  certificationsCount: z.number().int().nonnegative(),
  achievementsCount: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
});
export type ResumeCoverage = z.infer<typeof ResumeCoverageSchema>;

/**
 * The single normalized output of every parser strategy.
 * `parsed` is the existing ParsedCV domain shape (may be sparse for
 * PARTIAL / EXTRACTION_ONLY candidates).
 */
export const ResumeParseCandidateSchema = z.object({
  sourceStrategy: z.enum(RESUME_STRATEGY_IDS),
  coverage: ResumeCoverageSchema,
  diagnostics: ResumeDiagnosticsSchema,
  /** raw extracted document text — available even when structure is weak */
  rawText: z.string(),
  /** structured parse — may be empty for EXTRACTION_ONLY */
  parsed: z.any(),
  warnings: z.array(z.string()),
});
export interface ResumeParseCandidate
  extends Omit<z.infer<typeof ResumeParseCandidateSchema>, "parsed"> {
  parsed: ParsedCV;
  /** Deterministic plausibility diagnostics — populated during
   *  candidate comparison (resume-import/diagnostics.ts). */
  candidateDiagnostics?: import("./diagnostics").ResumeCandidateDiagnostics;
}

// ============================================================
// STRATEGY CONTRACT
// ============================================================

export interface ResumeParserStrategy {
  id: ResumeStrategyId;
  /** Per-strategy timeout — one stuck parser must not stall the upload. */
  timeoutMs: number;
  /**
   * Produce a normalized candidate or throw a typed CVParseFailure.
   * Throwing is a strategy-level failure — the orchestrator continues
   * to the next strategy.
   */
  parse(buffer: Buffer, filename: string, mimeType: string): Promise<ResumeParseCandidate>;
}

// ============================================================
// PIPELINE RESULT (what the route returns to the UI)
// ============================================================

export interface ResumeImportResult {
  state: ResumeParseState;
  candidate: ResumeParseCandidate;
  /** All strategies that produced candidates — audit trail */
  attempts: Array<{
    strategy: ResumeStrategyId;
    status: "OK" | "FAILED" | "TIMEOUT";
    coverage?: ResumeCoverageStatus;
    durationMs: number;
    errorCode?: string;
  }>;
  fallbackUsed: boolean;
  /** Why the winner won — count-based reason codes, no CV content. */
  winnerReasons?: string[];
  /** Per-candidate structural diagnostics (counts only). */
  candidateDiagnostics?: Array<
    { strategy: ResumeStrategyId } &
    import("./diagnostics").ResumeCandidateDiagnostics
  >;
  /** Sections present only in non-winning candidates — advisory for
   *  future review/merge; the winner is always a single canonical
   *  candidate (no Frankenstein merge). */
  secondaryOnlySections?: string[];
  /** True when the winning candidate came from local OCR of an
   *  image-only/scanned file — consultants must see this provenance. */
  ocrRecovered?: boolean;
  ocrEngine?: string;
}
