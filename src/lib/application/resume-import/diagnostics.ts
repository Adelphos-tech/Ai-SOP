/**
 * @file resume-import/diagnostics.ts
 * Deterministic plausibility diagnostics for resume parse candidates.
 *
 * Replaces "more records = better" ranking: a parser that emits 21
 * malformed education records must lose to a parser that emits 2
 * coherent ones. All signals are structural (shape, syntax, counts) —
 * NO AI/LLM judgement, no content logging.
 */
import type { ParsedCV, ParsedEducation, ParsedExperience } from "../cv-parser";
import type { ResumeParseCandidate } from "./types";

// ============================================================
// DIAGNOSTICS MODEL
// ============================================================

export interface ResumeCandidateDiagnostics {
  strategy?: string;

  /** Count of present contact fields that pass their validator (0–6). */
  personalCompleteness: number;
  invalidContactCount: number;

  educationCount: number;
  plausibleEducationCount: number;
  duplicateEducationCount: number;
  malformedEducationCount: number;

  experienceCount: number;
  plausibleExperienceCount: number;
  duplicateExperienceCount: number;
  malformedExperienceCount: number;

  skillsCount: number;
  uniqueSkillCount: number;
  suspiciousSkillCount: number;

  certificationCount: number;
  projectCount: number;
  publicationCount: number;
  achievementCount: number;
  languageCount: number;

  dateParseIssues: number;
  crossSectionPollutionCount: number;

  rawTextLength: number;
  /** Sections with at least one plausible/valid item — the "usable
   *  structural sections" component of ranking. */
  structuredCoverage: number;

  /** Deterministic composite rank — higher wins; ties fall to strategy order. */
  qualityRank: number;
}

// ============================================================
// NORMALIZATION / CLASSIFIERS (structural only)
// ============================================================

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\u2022\u25CF\u25AA•·◦‣⁃*>\-\–\—]/g, " ")
    .replace(/[^a-z0-9@.+#&' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|www\.)\S+|\b\S+\.(com|org|net|edu|in|io|dev)\b/i;
const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;
const SECTION_HEADINGS = new Set([
  "education", "academic qualifications", "qualifications", "experience",
  "work experience", "employment", "work history", "professional experience",
  "skills", "technical skills", "projects", "certifications", "licenses",
  "achievements", "awards", "summary", "objective", "profile", "references",
  "interests", "hobbies", "languages", "publications", "declaration",
  "personal details", "contact", "volunteer experience", "research",
]);
const DEGREE_TOKENS = /^(b\.?tech|b\.?e\.?|b\.?sc|b\.?a\.?|bachelor|master|m\.?tech|m\.?sc|m\.?a\.?|mba|ph\.?d|doctorate|diploma|pharm\.?\s?d|10th|12th|high school|intermediate|sslc|hsc)\b/i;
const INSTITUTION_WORDS = /\b(university|college|institute|school|academy|polytechnic|vidyalaya)\b/i;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE_RE = new RegExp(
  `^\\s*((${MONTHS})[a-z]*\\.?\\s*)?\\d{4}\\s*([-–—/to]+\\s*((${MONTHS})[a-z]*\\.?\\s*)?\\d{4}|present|current|now)?\\s*$` +
  `|^\\s*\\d{1,2}[/\\-.]\\d{4}(\\s*[-–—]\\s*\\d{1,2}[/\\-.]\\d{4})?\\s*$` +
  `|^\\s*(present|current)\\s*$`, "i");

function isEmail(s: string): boolean { return EMAIL_RE.test(s.trim()); }
function isUrl(s: string): boolean { return URL_RE.test(s.trim()); }
function isPhone(s: string): boolean {
  const t = s.trim();
  return PHONE_RE.test(t) && (t.match(/\d/g) || []).length >= 7;
}
function isSectionHeading(s: string): boolean {
  return SECTION_HEADINGS.has(norm(s));
}
function isDateOnly(s: string): boolean { return DATE_RE.test(s.trim()); }
function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }
/** Long bullet prose — not a field value. */
function isSentenceLike(s: string): boolean {
  const t = s.trim();
  return t.length > 100 || wordCount(t) > 12 || (t.length > 60 && /[.;]$/.test(t));
}
/** A value that is structurally meaningful in a labelled field. */
function isMeaningful(s: string | undefined): boolean {
  if (!s || !s.trim()) return false;
  const t = s.trim();
  if (isEmail(t) || isPhone(t) || isUrl(t) || isSectionHeading(t) || isSentenceLike(t)) return false;
  return true;
}
function isPollution(s: string | undefined): boolean {
  if (!s || !s.trim()) return false;
  const t = s.trim();
  return isEmail(t) || isPhone(t) || isUrl(t) || isSectionHeading(t);
}

// ============================================================
// CONTACT PLAUSIBILITY
// ============================================================

function contactValidity(p: ParsedCV["personalData"] | undefined) {
  const pd = p || {};
  let valid = 0;
  let invalid = 0;
  const nameOk = (v?: string) => {
    if (!v || !v.trim()) return undefined;
    const t = v.trim();
    const ok = t.length <= 40 && wordCount(t) <= 5 &&
      !isEmail(t) && !isUrl(t) && !isPhone(t) && !isSectionHeading(t) && !isSentenceLike(t);
    ok ? valid++ : invalid++;
    return ok;
  };
  nameOk(pd.firstName);
  nameOk(pd.lastName);
  if (pd.email?.trim()) (isEmail(pd.email.trim()) ? valid++ : invalid++);
  if (pd.phone?.trim()) (isPhone(pd.phone.trim()) ? valid++ : invalid++);
  if (pd.linkedin?.trim()) {
    const t = pd.linkedin.trim();
    (isSentenceLike(t) || isEmail(t) || (!/linkedin/i.test(t) && /\s/.test(t)) ? invalid++ : valid++);
  }
  const locOk = (v?: string) => {
    if (!v || !v.trim()) return;
    const t = v.trim();
    (isDateOnly(t) || isSentenceLike(t) || isSectionHeading(t)) ? invalid++ : valid++;
  };
  locOk(pd.currentCity);
  locOk(pd.currentCountry);
  return { valid, invalid };
}

// ============================================================
// DATE COHERENCE
// ============================================================

/** Parse "Mon YYYY" / "MM/YYYY" / "YYYY" / Present → comparable number. */
function parseDateToken(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (/^(present|current|now|till date|ongoing)$/.test(t)) return 999999;
  const monthYear = t.match(new RegExp(`(${MONTHS})[a-z]*\\.?\\s*(\\d{4})`, "i"));
  if (monthYear) {
    const mi = MONTHS.split("|").findIndex(m => monthYear[1].toLowerCase().startsWith(m));
    return parseInt(monthYear[2], 10) * 100 + (mi >= 0 ? mi + 1 : 0);
  }
  const numMonth = t.match(/^(\d{1,2})[/\-.](\d{4})$/);
  if (numMonth) {
    const m = parseInt(numMonth[1], 10);
    if (m < 1 || m > 12) return -1; // impossible month
    return parseInt(numMonth[2], 10) * 100 + m;
  }
  const year = t.match(/^\d{4}$/);
  if (year) return parseInt(t, 10) * 100;
  return null; // unparsed — allowed, not penalized
}

function dateIssues(start: string | undefined, end: string | undefined, currentlyWorking?: boolean): number {
  let issues = 0;
  const s = parseDateToken(start);
  const e = parseDateToken(end);
  if (s === -1 || e === -1) issues++;
  if (s !== null && s > 0 && e !== null && e > 0 && e < s && !currentlyWorking) issues++;
  return issues;
}

// ============================================================
// SECTION PLAUSIBILITY
// ============================================================

function educationSignals(e: ParsedEducation) {
  const fields = [e.institution, e.degree, e.specialization, e.startYear, e.endYear, e.cgpa];
  const populated = fields.filter(f => f && String(f).trim());
  const meaningful = populated.filter(f => isMeaningful(String(f)));
  const polluted = populated.filter(f => isPollution(String(f)));
  // Date-only records ("2020", "2021-2022" as the only content) are fake.
  const dateOnly = populated.length > 0 &&
    populated.every(f => isDateOnly(String(f)) || /^\d{1,2}(\.\d+)?\s*(%|cgpa|gpa)?$/i.test(String(f).trim()));
  const plausible = meaningful.length >= 2 && !dateOnly;
  const malformed = !plausible;
  return { plausible, malformed, polluted: polluted.length, dateOnly };
}

function experienceSignals(e: ParsedExperience) {
  const fields = [e.organization, e.role, e.location, e.startDate, e.endDate, e.responsibilities];
  const populated = fields.filter(f => f && String(f).trim());
  const meaningfulAnchor = isMeaningful(e.organization) || isMeaningful(e.role);
  const hasBullets = isMeaningful(e.responsibilities);
  const polluted = populated.filter(f => isPollution(String(f)));
  const dateOnly = populated.length > 0 &&
    !meaningfulAnchor && !hasBullets &&
    populated.every(f => isDateOnly(String(f)));
  // organization text that is actually a responsibility bullet (sentence) is malformed
  const orgIsBullet = !!e.organization && isSentenceLike(e.organization);
  const plausible = (meaningfulAnchor && !orgIsBullet) ||
    (!meaningfulAnchor && hasBullets && !orgIsBullet && populated.length > 1);
  return { plausible, malformed: !plausible, polluted: polluted.length, dateOnly };
}

function skillSuspicious(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return isEmail(t) || isPhone(t) || isUrl(t) || isSectionHeading(t) ||
    isDateOnly(t) || DEGREE_TOKENS.test(t) || t.length > 80 || wordCount(t) > 10;
}

function dupCount<T>(items: T[], keyOf: (x: T) => string): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    if (seen.has(k)) dupes++;
    else seen.add(k);
  }
  return dupes;
}

// ============================================================
// PUBLIC API
// ============================================================

const TIER = { GOOD: 4, PARTIAL: 3, EXTRACTION_ONLY: 2, UNREADABLE: 1 } as const;

export function computeCandidateDiagnostics(
  parsed: ParsedCV | null | undefined,
  coverageStatus?: string,
): ResumeCandidateDiagnostics {
  const p: any = parsed || {};
  const contact = contactValidity(p.personalData);

  const edu = Array.isArray(p.education) ? p.education as ParsedEducation[] : [];
  const eduSig = edu.map(educationSignals);
  const exp = Array.isArray(p.experience) ? p.experience as ParsedExperience[] : [];
  const expSig = exp.map(experienceSignals);

  const skillTokens: string[] = Object.values(p.skills || {}).flat().filter((s: any) => typeof s === "string");
  const uniqueSkills = new Set(skillTokens.map(norm).filter(Boolean));
  const suspiciousSkills = skillTokens.filter(skillSuspicious).length;

  const certifications = Array.isArray(p.certifications) ? p.certifications : [];
  const projects = Array.isArray(p.projects) ? p.projects : [];
  const achievements = Array.isArray(p.achievements) ? p.achievements : [];
  const publications = Array.isArray(p.publications) ? p.publications : [];
  const languages = Array.isArray(p.languages) ? p.languages : [];

  const plausibleEdu = eduSig.filter(s => s.plausible).length;
  const plausibleExp = expSig.filter(s => s.plausible).length;
  const dupEdu = dupCount(edu, e => norm(`${e.institution}|${e.degree}|${e.endYear}`));
  const dupExp = dupCount(exp, e => norm(`${e.organization}|${e.role}|${e.startDate}`));
  const malformedEdu = eduSig.filter(s => s.malformed).length;
  const malformedExp = expSig.filter(s => s.malformed).length;

  let dateIssueCount = 0;
  for (const e of edu) dateIssueCount += dateIssues(e.startYear, e.endYear);
  for (const e of exp) dateIssueCount += dateIssues(e.startDate, e.endDate, e.currentlyWorking);

  // Cross-section pollution: contact fields inside section records,
  // education-institution strings parked as employers, degree keywords
  // stored as skills, section headings inside record fields.
  let pollution = eduSig.reduce((n, s) => n + s.polluted, 0) + expSig.reduce((n, s) => n + s.polluted, 0);
  for (const e of exp) {
    if (e.organization && INSTITUTION_WORDS.test(e.organization) && (!e.role || DEGREE_TOKENS.test(e.role))) pollution++;
  }
  pollution += skillTokens.filter(s => DEGREE_TOKENS.test(s.trim())).length;

  const structuredCoverage =
    (plausibleEdu > 0 ? 1 : 0) + (plausibleExp > 0 ? 1 : 0) +
    (projects.length > 0 ? 1 : 0) + (uniqueSkills.size > 0 ? 1 : 0) +
    (certifications.length > 0 ? 1 : 0) + (achievements.length > 0 ? 1 : 0) +
    (publications.length > 0 ? 1 : 0) + (languages.length > 0 ? 1 : 0);

  const tier = TIER[(coverageStatus || "UNREADABLE") as keyof typeof TIER] ?? 0;

  const qualityRank =
    tier * 1_000_000 +
    structuredCoverage * 100_000 +
    (plausibleEdu + plausibleExp + projects.length + certifications.length +
      achievements.length + publications.length + languages.length +
      Math.min(uniqueSkills.size, 40)) * 1_000 +
    contact.valid * 500 -
    malformedEdu * 2_000 - malformedExp * 2_000 -
    dupEdu * 1_500 - dupExp * 1_500 -
    suspiciousSkills * 50 -
    contact.invalid * 400 -
    pollution * 300 -
    dateIssueCount * 100;

  return {
    personalCompleteness: contact.valid,
    invalidContactCount: contact.invalid,
    educationCount: edu.length,
    plausibleEducationCount: plausibleEdu,
    duplicateEducationCount: dupEdu,
    malformedEducationCount: malformedEdu,
    experienceCount: exp.length,
    plausibleExperienceCount: plausibleExp,
    duplicateExperienceCount: dupExp,
    malformedExperienceCount: malformedExp,
    skillsCount: skillTokens.length,
    uniqueSkillCount: uniqueSkills.size,
    suspiciousSkillCount: suspiciousSkills,
    certificationCount: certifications.length,
    projectCount: projects.length,
    publicationCount: publications.length,
    achievementCount: achievements.length,
    languageCount: languages.length,
    dateParseIssues: dateIssueCount,
    crossSectionPollutionCount: pollution,
    rawTextLength: p.rawTextLength || 0,
    structuredCoverage,
    qualityRank,
  };
}

/**
 * Choose the best candidate by deterministic plausibility.
 * Order of comparison:
 *   A. coverage tier (UNREADABLE can never win)
 *   B. usable structural sections
 *   C. plausible record counts
 *   D. contact validity
 *   E. malformed/duplicate/pollution/date penalties
 *   F. earlier strategy order = weak empirical prior (ties only)
 */
export function chooseBestCandidateDetailed(candidates: ResumeParseCandidate[]): {
  best: ResumeParseCandidate | null;
  diagnostics: Array<{ strategy: string } & ResumeCandidateDiagnostics>;
  winnerReasons: string[];
} {
  let best: ResumeParseCandidate | null = null;
  let bestDiag: ResumeCandidateDiagnostics | null = null;
  const diagnostics: Array<{ strategy: string } & ResumeCandidateDiagnostics> = [];

  for (const c of candidates) {
    const dd = computeCandidateDiagnostics(c.parsed, c.coverage.status);
    diagnostics.push({ strategy: c.sourceStrategy, ...dd });
    (c as any).candidateDiagnostics = dd;
    // Strictly greater — first candidate in strategy order wins ties
    // (format prior is the FINAL tie-breaker, never the driver).
    if (!best || dd.qualityRank > bestDiag!.qualityRank) {
      best = c;
      bestDiag = dd;
    }
  }

  const winnerReasons: string[] = [];
  if (best && bestDiag) {
    for (const d of diagnostics) {
      if (d.strategy === best.sourceStrategy) continue;
      if (d.qualityRank === bestDiag.qualityRank) {
        winnerReasons.push(`PRIOR_TIEBREAK_OVER_${d.strategy}`);
        continue;
      }
      const vs = d.strategy;
      if (bestDiag.plausibleEducationCount > d.plausibleEducationCount)
        winnerReasons.push(`MORE_PLAUSIBLE_EDUCATION(${bestDiag.plausibleEducationCount}v${d.plausibleEducationCount})_VS_${vs}`);
      if (bestDiag.malformedEducationCount < d.malformedEducationCount)
        winnerReasons.push(`FEWER_MALFORMED_EDUCATION(${bestDiag.malformedEducationCount}v${d.malformedEducationCount})_VS_${vs}`);
      if (bestDiag.plausibleExperienceCount > d.plausibleExperienceCount)
        winnerReasons.push(`MORE_PLAUSIBLE_EXPERIENCE(${bestDiag.plausibleExperienceCount}v${d.plausibleExperienceCount})_VS_${vs}`);
      if (bestDiag.malformedExperienceCount < d.malformedExperienceCount)
        winnerReasons.push(`FEWER_MALFORMED_EXPERIENCE(${bestDiag.malformedExperienceCount}v${d.malformedExperienceCount})_VS_${vs}`);
      if (bestDiag.duplicateEducationCount + bestDiag.duplicateExperienceCount <
          d.duplicateEducationCount + d.duplicateExperienceCount)
        winnerReasons.push(`FEWER_DUPLICATES(${bestDiag.duplicateEducationCount + bestDiag.duplicateExperienceCount}v${d.duplicateEducationCount + d.duplicateExperienceCount})_VS_${vs}`);
      if (bestDiag.invalidContactCount < d.invalidContactCount)
        winnerReasons.push(`VALID_CONTACT(${bestDiag.invalidContactCount}v${d.invalidContactCount})_VS_${vs}`);
      if (bestDiag.personalCompleteness > d.personalCompleteness)
        winnerReasons.push(`CONTACT_COMPLETENESS(${bestDiag.personalCompleteness}v${d.personalCompleteness})_VS_${vs}`);
      if (bestDiag.crossSectionPollutionCount < d.crossSectionPollutionCount)
        winnerReasons.push(`LESS_POLLUTION(${bestDiag.crossSectionPollutionCount}v${d.crossSectionPollutionCount})_VS_${vs}`);
      if (bestDiag.uniqueSkillCount > d.uniqueSkillCount)
        winnerReasons.push(`MORE_UNIQUE_SKILLS(${bestDiag.uniqueSkillCount}v${d.uniqueSkillCount})_VS_${vs}`);
      if (bestDiag.structuredCoverage > d.structuredCoverage)
        winnerReasons.push(`MORE_USABLE_SECTIONS(${bestDiag.structuredCoverage}v${d.structuredCoverage})_VS_${vs}`);
      // Winner lost a dimension but won overall — surface honestly.
      if (bestDiag.plausibleEducationCount < d.plausibleEducationCount)
        winnerReasons.push(`TRADEOFF_FEWER_PLAUSIBLE_EDUCATION(${bestDiag.plausibleEducationCount}v${d.plausibleEducationCount})_VS_${vs}`);
      if (bestDiag.plausibleExperienceCount < d.plausibleExperienceCount)
        winnerReasons.push(`TRADEOFF_FEWER_PLAUSIBLE_EXPERIENCE(${bestDiag.plausibleExperienceCount}v${d.plausibleExperienceCount})_VS_${vs}`);
    }
  }

  return { best, diagnostics, winnerReasons };
}

/** Whether a GOOD-coverage candidate is clean enough to stop the chain.
 *  A bloated/duplicated GOOD result must not short-circuit comparison. */
export function isCleanlyGood(diag: ResumeCandidateDiagnostics): boolean {
  return diag.malformedEducationCount === 0 &&
    diag.malformedExperienceCount === 0 &&
    diag.duplicateEducationCount === 0 &&
    diag.duplicateExperienceCount === 0 &&
    diag.crossSectionPollutionCount === 0 &&
    diag.invalidContactCount === 0 &&
    diag.plausibleEducationCount + diag.plausibleExperienceCount > 0;
}
