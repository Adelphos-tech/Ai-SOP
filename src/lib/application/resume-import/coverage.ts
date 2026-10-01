/**
 * @file resume-import/coverage.ts
 * Deterministic structural coverage evaluation for resume candidates.
 * NO AI scoring — counts and presence only.
 */
import type { ParsedCV } from "../cv-parser";
import type { ResumeCoverage, ResumeCoverageStatus, ResumeParseCandidate } from "./types";
import { chooseBestCandidateDetailed } from "./diagnostics";

const PERSONAL_SIGNAL_FIELDS = [
  "fullName", "firstName", "lastName", "email", "phone", "linkedin",
] as const;

function skillsTotal(skills: ParsedCV["skills"] | undefined): number {
  return Object.values(skills || {}).reduce(
    (n: number, b: any) => n + (Array.isArray(b) ? b.length : 0), 0,
  );
}

export function evaluateCoverage(parsed: ParsedCV | null | undefined, rawTextLength: number): ResumeCoverage {
  const p = parsed?.personalData || ({} as NonNullable<ParsedCV["personalData"]>);
  const personalFields = PERSONAL_SIGNAL_FIELDS.filter(
    (f) => typeof (p as any)[f] === "string" && String((p as any)[f]).trim().length > 0,
  ).length;
  const educationCount = parsed?.education?.length || 0;
  const experienceCount = parsed?.experience?.length || 0;
  const projectsCount = parsed?.projects?.length || 0;
  const skillsCount = skillsTotal(parsed?.skills);
  const certificationsCount = parsed?.certifications?.length || 0;
  const achievementsCount = parsed?.achievements?.length || 0;
  const sectionCount =
    (educationCount > 0 ? 1 : 0) +
    (experienceCount > 0 ? 1 : 0) +
    (projectsCount > 0 ? 1 : 0) +
    (skillsCount > 0 ? 1 : 0) +
    (certificationsCount > 0 ? 1 : 0) +
    (achievementsCount > 0 ? 1 : 0);

  let status: ResumeCoverageStatus;
  if (rawTextLength <= 0) {
    status = "UNREADABLE";
  } else if (sectionCount >= 2 && personalFields >= 1) {
    status = "GOOD";
  } else if (sectionCount >= 1 || personalFields >= 2) {
    status = "PARTIAL";
  } else {
    status = "EXTRACTION_ONLY";
  }

  return {
    status,
    personalFields,
    educationCount,
    experienceCount,
    projectsCount,
    skillsCount,
    certificationsCount,
    achievementsCount,
    sectionCount,
  };
}

/**
 * Legacy coverage score — kept for reporting/debug output. Candidate
 * SELECTION no longer uses it: raw item counts let an over-segmenting
 * parser beat a cleaner one. Ranking now lives in diagnostics.ts
 * (plausibility-aware).
 */
export function coverageRank(c: ResumeCoverage): number {
  const tier = { GOOD: 3, PARTIAL: 2, EXTRACTION_ONLY: 1, UNREADABLE: 0 }[c.status];
  return (
    tier * 1_000_000 +
    c.sectionCount * 10_000 +
    (c.educationCount + c.experienceCount + c.projectsCount + c.skillsCount +
      c.certificationsCount + c.achievementsCount) * 100 +
    c.personalFields * 10
  );
}

export function chooseBestCandidate(candidates: ResumeParseCandidate[]): ResumeParseCandidate | null {
  // Delegates to the plausibility comparator; returns the single
  // canonical winner (strategy order is the final tie-breaker).
  return chooseBestCandidateDetailed(candidates).best;
}
