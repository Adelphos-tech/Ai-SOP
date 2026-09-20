// ============================================================
// CV CANDIDATE SANITY CHECKS
// ============================================================
// Deterministic guards applied to a parsed ResumeCandidate before
// it reaches review. Never silently "fixes" values — drops provably
// bogus fields, flags LOW confidence, dedupes normalized records.
// ============================================================

import type { ResumeCandidate, Confidence } from "./resume-candidate.schema";

// Location-only words that must never be an institution/organization
const LOCATION_WORDS = new Set([
  "india", "indian", "ahmedabad", "gujarat", "mumbai", "delhi", "bangalore",
  "bengaluru", "hyderabad", "pune", "chennai", "kolkata", "usa", "uk",
  "united states", "united kingdom", "germany", "canada", "australia",
  "remote", "online",
]);

const MAX_REASONABLE_EDU = 8;
const MAX_INSTITUTION_LEN = 120;

function norm(s: string | undefined): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isLocationOnly(s: string | undefined): boolean {
  const n = norm(s).replace(/[.,;]+$/, "");
  return LOCATION_WORDS.has(n);
}

function isSentenceLike(s: string | undefined): boolean {
  if (!s) return false;
  return s.length > MAX_INSTITUTION_LEN || (s.match(/\s/g) || []).length > 12;
}

function yearOf(s: string | undefined): number | null {
  const m = (s || "").match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(it => {
    const k = key(it);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Apply deterministic sanity rules. Mutates a copy — returns
 * { candidate, warnings }.
 */
export function sanitizeCandidate(candidate: ResumeCandidate): ResumeCandidate {
  const warnings: string[] = [...(candidate.warnings || [])];

  // ===== EDUCATION =====
  let education = candidate.education.map(e => ({ ...e }));
  education = education.filter(e => {
    // A bare location word is never an institution — drop the field,
    // and drop the whole record if it has no other real content.
    if (e.institution && isLocationOnly(e.institution)) {
      warnings.push(`Rejected institution "${e.institution}" (location-only value)`);
      e.institution = undefined;
      e.confidence = "LOW";
    }
    if (e.institution && isSentenceLike(e.institution)) {
      warnings.push(`Rejected institution (sentence-length text)`);
      e.institution = undefined;
      e.confidence = "LOW";
    }
    const hasContent = !!(e.institution || e.degree || e.fieldOfStudy || e.gpa);
    return hasContent;
  });
  education = dedupe(education, e =>
    norm(`${e.institution}|${e.degree}|${e.startYear}|${e.endYear}`));
  if (education.length > MAX_REASONABLE_EDU) {
    warnings.push(`Unusually high education count (${education.length}) — review carefully`);
    education.forEach(e => { if (e.confidence === "HIGH") e.confidence = "MEDIUM"; });
  }
  education = education.map(e => {
    const s = yearOf(e.startYear), g = yearOf(e.endYear);
    if (s && g && s > g) {
      warnings.push(`Impossible education dates: ${e.startYear} > ${e.endYear}`);
      return { ...e, confidence: "LOW" as Confidence };
    }
    const gpa = parseFloat(e.gpa || ""), max = parseFloat(e.maxGpa || "");
    if (!isNaN(gpa) && !isNaN(max) && gpa > max) {
      warnings.push(`GPA ${e.gpa} exceeds scale ${e.maxGpa}`);
      return { ...e, confidence: "LOW" as Confidence };
    }
    return e;
  });

  // ===== EXPERIENCE =====
  let experience = candidate.experience.map(e => ({ ...e }));
  experience = experience.filter(e => {
    if (e.organization && isLocationOnly(e.organization)) {
      warnings.push(`Rejected organization "${e.organization}" (location-only value)`);
      e.organization = undefined;
      e.confidence = "LOW";
    }
    return !!(e.organization || e.role);
  });
  experience = dedupe(experience, e =>
    norm(`${e.organization}|${e.role}|${e.startDate}|${e.endDate}`));

  // ===== PROJECTS =====
  let projects = candidate.projects.map(p => ({ ...p }));
  projects = projects.filter(p => !!p.name && !isSentenceLike(p.name));
  projects = dedupe(projects, p => norm(p.name));

  // ===== SKILLS / CERTS / ACHIEVEMENTS =====
  const cleanList = (xs: string[]) =>
    Array.from(new Set(xs.map(s => s.trim()).filter(s => s.length > 0 && s.length < 160)));

  const skills = {
    technical: cleanList(candidate.skills.technical || []),
    programming: cleanList(candidate.skills.programming || []),
    tools: cleanList(candidate.skills.tools || []),
    software: cleanList(candidate.skills.software || []),
    domain: cleanList(candidate.skills.domain || []),
    soft: cleanList(candidate.skills.soft || []),
    languages: cleanList(candidate.skills.languages || []),
  };

  return {
    ...candidate,
    education,
    experience,
    projects,
    skills,
    certifications: cleanList(candidate.certifications || []),
    achievements: cleanList(candidate.achievements || []),
    warnings,
  };
}
