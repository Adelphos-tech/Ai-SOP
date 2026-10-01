// ============================================================
// AFFINDA -> D-VIVID CANONICAL BENCHMARK ADAPTER
// ============================================================
// Maps Affinda ResumeData (v3 documentType=Resume Parser) into the
// existing ResumeCandidate Zod schema — enough to judge canonical
// compatibility. NOT a production mapper.
//
// Also emits a field-coverage report:
//   MAP DIRECTLY / NEED TRANSFORMATION / NO CURRENT D-VIVID SLOT
// ============================================================

import {
  ResumeCandidateSchema,
  type ResumeCandidate,
} from "../../src/lib/application/resume-candidate.schema";

// ---- small helpers ------------------------------------------------------

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function first<T>(arr: T[] | undefined): T | undefined {
  return Array.isArray(arr) && arr.length ? arr[0] : undefined;
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => s(x)).filter(Boolean);
}
/** Affinda date objects: {startDate, endDate, completionDate, isCurrent, rawText} */
function yearOf(dateStr: unknown): string {
  const t = s(dateStr);
  const m = t.match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}
/** "2022-07-01" -> "Jul 2022"; passthrough when only a year. */
function monthYear(dateStr: unknown): string {
  const t = s(dateStr);
  if (!t) return "";
  const m = t.match(/^(\d{4})-(\d{2})/);
  if (!m) return t;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mi = Math.min(11, Math.max(0, parseInt(m[2], 10) - 1));
  return `${MONTHS[mi]} ${m[1]}`;
}
/** unwrap a possibly-wrapped v3 value ({parsed|value|raw}) or plain value */
function unwrap(v: any): any {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("parsed" in v) return v.parsed;
    if ("value" in v) return v.value;
    if ("raw" in v) return v.raw;
  }
  return v;
}

// ---- skills bucketing (same buckets as ParsedCV) -------------------------

const PROGRAMMING_RE =
  /python|java(script)?|typescript|\bc\+\+|\bc#|\bgo(lang)?\b|\brust\b|ruby|php|swift|kotlin|scala|\br\b|matlab|sql|html|css|bash|shell|perl|dart|lua|julia/i;
const TOOLS_RE =
  /git(hub|lab)?|bitbucket|jira|confluence|docker|kubernetes|jenkins|aws|azure|gcp|heroku|vercel|mysql|postgres|mongo|redis|elastic|kafka|nginx|vscode|eclipse/i;
const SOFTWARE_RE =
  /tableau|power ?bi|excel|figma|sketch|photoshop|illustrator|jupyter|rstudio|spss|stata|\bsas\b|autocad|solidworks|simulink|ansys|autodesk|ms office|word|powerpoint/i;
const SOFT_RE =
  /leadership|communication|team ?work|problem.?solving|critical thinking|time management|project management|presentation|public speaking|negotiation|mentor|collaborat|adaptab|creativ|decision|strategic planning|conflict/i;

function bucketSkill(name: string): keyof ResumeCandidate["skills"] {
  if (PROGRAMMING_RE.test(name)) return "programming";
  if (TOOLS_RE.test(name)) return "tools";
  if (SOFTWARE_RE.test(name)) return "software";
  if (SOFT_RE.test(name)) return "soft";
  return "technical"; // default bucket for domain/technical skills
}

// ---- main adapter --------------------------------------------------------

export interface AdapterResult {
  candidate: ResumeCandidate;
  zodOk: boolean;
  zodErrors: string[];
  /** vendor fields that have no current D-Vivid slot (with counts) */
  unmapped: Record<string, number>;
}

export function mapAffindaToCandidate(data: any): AdapterResult {
  const d = data ?? {};
  const unmapped: Record<string, number> = {};

  const location = unwrap(d.location) || {};
  const name = unwrap(d.name) || {};
  const websites = strArr(d.websites);
  const linkedin =
    s(unwrap(d.linkedin)) ||
    websites.find((w) => /linkedin\.com/i.test(w)) ||
    "";
  const github = websites.find((w) => /github\.com/i.test(w)) || "";

  const candidate: ResumeCandidate = {
    personalData: {
      fullName: s(name.raw) || undefined,
      firstName: s(name.first) || undefined,
      lastName: s(name.last) || undefined,
      email: s(first(d.emails)) || undefined,
      phone:
        s(unwrap(first<any>(d.phoneNumberDetails)?.formattedNumber)) ||
        s(first(d.phoneNumbers)) ||
        undefined,
      currentCity: s(location.city) || s(location.formatted) || undefined,
      currentCountry: s(location.country) || undefined,
      nationality: s(unwrap(d.nationality)) || undefined,
      linkedin: linkedin || undefined,
      github: github || undefined,
    },
    education: [],
    experience: [],
    projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [], languages: [] },
    certifications: [],
    achievements: [],
    warnings: [],
  };

  // --- education ---
  for (const e of Array.isArray(d.education) ? d.education : []) {
    const acc = unwrap(e.accreditation) || {};
    const dates = unwrap(e.dates) || {};
    const grade = unwrap(e.grade) || {};
    candidate.education.push({
      institution: s(e.organization) || undefined,
      degree: s(acc.education) || s(acc.inputStr) || undefined,
      fieldOfStudy:
        (Array.isArray(acc.fieldsOfStudy) ? s(acc.fieldsOfStudy[0]) : s(acc.fieldsOfStudy)) ||
        s(acc.educationLevel) || undefined,
      gpa: s(grade.value) || undefined,
      maxGpa: undefined, // Affinda grade.metric carries scale name, not max value
      startYear: yearOf(dates.startDate) || undefined,
      endYear:
        yearOf(dates.endDate) ||
        yearOf(dates.completionDate) ||
        undefined,
      source: dates.rawText ? { text: s(dates.rawText) } : undefined,
    });
  }

  // --- experience ---
  for (const w of Array.isArray(d.workExperience) ? d.workExperience : []) {
    const dates = unwrap(w.dates) || {};
    const loc = unwrap(w.location) || {};
    candidate.experience.push({
      organization: s(w.organization) || undefined,
      role: s(w.jobTitle) || undefined,
      location: s(loc.formatted) || s(loc.city) || undefined,
      startDate: monthYear(dates.startDate) || s(dates.rawText) || undefined,
      endDate: dates.isCurrent
        ? "Present"
        : monthYear(dates.endDate) || undefined,
      bullets: s(w.jobDescription)
        ? s(w.jobDescription)
            .split(/\n+/)
            .map((b) => b.replace(/^[\s•\-*]+/, "").trim())
            .filter(Boolean)
        : undefined,
      source: dates.rawText ? { text: s(dates.rawText) } : undefined,
    });
  }

  // --- skills ---
  for (const sk of Array.isArray(d.skills) ? d.skills : []) {
    const nm = s(sk?.name ?? sk);
    if (!nm) continue;
    const type = s(sk?.type).toLowerCase();
    if (type.includes("language")) {
      candidate.skills.languages.push(nm);
      continue;
    }
    candidate.skills[bucketSkill(nm)].push(nm);
  }
  for (const lang of strArr(d.languages)) {
    if (!candidate.skills.languages.includes(lang)) candidate.skills.languages.push(lang);
  }

  // --- certifications (string[] in ResumeData) ---
  candidate.certifications = strArr(d.certifications);

  // --- projects / achievements / publications via dedicated arrays or sections ---
  const sections: any[] = Array.isArray(d.sections) ? d.sections : [];

  // projects: dedicated array if present (newer schema), else PROJECTS section
  if (Array.isArray(d.projects) && d.projects.length) {
    for (const p of d.projects) {
      if (typeof p === "string") {
        candidate.projects.push({ name: p });
      } else {
        candidate.projects.push({
          name: s(p.name) || s(p.title) || undefined,
          description: s(p.description) || undefined,
          technologies: s(p.technologies) || undefined,
        });
      }
    }
  } else {
    for (const sec of sections) {
      if (/project/i.test(s(sec.sectionType))) {
        for (const line of s(sec.text).split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
          candidate.projects.push({ name: line });
        }
      }
    }
  }

  // achievements: dedicated array else ACHIEVEMENT/AWARD sections
  if (Array.isArray(d.achievements) && d.achievements.length) {
    candidate.achievements = strArr(d.achievements);
  } else {
    for (const sec of sections) {
      if (/achiev|award|honor/i.test(s(sec.sectionType))) {
        for (const line of s(sec.text).split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
          candidate.achievements.push(line);
        }
      }
    }
  }

  // --- fields with NO current D-Vivid slot (counted, not dropped) ---
  if (Array.isArray(d.publications) && d.publications.length)
    unmapped["publications"] = d.publications.length;
  if (s(d.objective)) unmapped["objective"] = 1;
  if (s(d.summary)) unmapped["summary"] = 1;
  if (typeof d.totalYearsExperience === "number")
    unmapped["totalYearsExperience"] = 1;
  if (Array.isArray(d.referees) && d.referees.length)
    unmapped["referees"] = d.referees.length;
  if (Array.isArray(d.patents) && d.patents.length)
    unmapped["patents"] = d.patents.length;
  if (d.dateOfBirth) unmapped["dateOfBirth"] = 1;
  if (s(d.profession)) unmapped["profession"] = 1;
  if (s(d.headShot)) unmapped["headShot"] = 1;
  // sections that are not already consumed (volunteer, research, etc.)
  const consumedSec = /project|achiev|award|honor|education|experience|work|skill|certif|summary|objective|language|personal|contact|interest/i;
  const extraSections = sections.filter((x) => !consumedSec.test(s(x.sectionType)));
  if (extraSections.length) {
    unmapped["additionalSections"] = extraSections.length;
    for (const x of extraSections) {
      const t = s(x.sectionType) || "untitled";
      unmapped[`section:${t}`] = (unmapped[`section:${t}`] || 0) + 1;
    }
  }

  const check = ResumeCandidateSchema.safeParse(candidate);
  return {
    candidate: check.success ? check.data : candidate,
    zodOk: check.success,
    zodErrors: check.success ? [] : check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    unmapped,
  };
}

// ---- flattened summary for report ---------------------------------------

export interface AffindaSummary {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  educationCount: number;
  experienceCount: number;
  projectCount: number;
  skillCount: number;
  certificationCount: number;
  achievementCount: number;
  publicationCount: number;
  languageCount: number;
  volunteerOtherCount: number;
  isResumeProbability?: number;
  experiences: Array<{ role: string; org: string; dates: string }>;
  educations: Array<{ degree: string; inst: string; dates: string }>;
}

export function summarizeAffinda(data: any, result: AdapterResult): AffindaSummary {
  const d = data ?? {};
  const c = result.candidate;
  const pubs = Array.isArray(d.publications) ? d.publications.length : 0;
  const extraSec = result.unmapped["additionalSections"] || 0;
  return {
    name: c.personalData?.fullName || `${c.personalData?.firstName || ""} ${c.personalData?.lastName || ""}`.trim(),
    email: c.personalData?.email || "",
    phone: c.personalData?.phone || "",
    location: [c.personalData?.currentCity, c.personalData?.currentCountry].filter(Boolean).join(", "),
    linkedin: c.personalData?.linkedin || "",
    educationCount: c.education.length,
    experienceCount: c.experience.length,
    projectCount: c.projects.length,
    skillCount:
      c.skills.technical.length + c.skills.programming.length +
      c.skills.tools.length + c.skills.software.length +
      c.skills.domain.length + c.skills.soft.length,
    certificationCount: c.certifications.length,
    achievementCount: c.achievements.length,
    publicationCount: pubs,
    languageCount: c.skills.languages.length,
    volunteerOtherCount: extraSec,
    isResumeProbability: d.isResumeProbability,
    experiences: c.experience.map((e) => ({
      role: e.role || "?",
      org: e.organization || "?",
      dates: `${e.startDate || "?"} - ${e.endDate || "?"}`,
    })),
    educations: c.education.map((e) => ({
      degree: e.degree || "?",
      inst: e.institution || "?",
      dates: `${e.startYear || "?"} - ${e.endYear || "?"}`,
    })),
  };
}

// ============================================================
// FIELD-LEVEL MAPPING REPORT (static audit of the adapter)
// ============================================================

export const FIELD_MAPPING_REPORT: Array<{
  affindaField: string;
  dvividSlot: string;
  status: "MAP DIRECTLY" | "NEED TRANSFORMATION" | "NO CURRENT D-VIVID SLOT";
}> = [
  { affindaField: "name.raw/first/last", dvividSlot: "personalData.fullName/firstName/lastName", status: "MAP DIRECTLY" },
  { affindaField: "emails[0]", dvividSlot: "personalData.email", status: "MAP DIRECTLY" },
  { affindaField: "phoneNumberDetails[0].formattedNumber", dvividSlot: "personalData.phone", status: "MAP DIRECTLY" },
  { affindaField: "location.city/country", dvividSlot: "personalData.currentCity/currentCountry", status: "MAP DIRECTLY" },
  { affindaField: "linkedin / websites[]", dvividSlot: "personalData.linkedin/github", status: "NEED TRANSFORMATION" },
  { affindaField: "education[].organization", dvividSlot: "education[].institution", status: "MAP DIRECTLY" },
  { affindaField: "education[].accreditation.education", dvividSlot: "education[].degree", status: "MAP DIRECTLY" },
  { affindaField: "education[].accreditation.fieldsOfStudy", dvividSlot: "education[].fieldOfStudy", status: "NEED TRANSFORMATION" },
  { affindaField: "education[].dates.startDate/endDate (ISO)", dvividSlot: "education[].startYear/endYear", status: "NEED TRANSFORMATION" },
  { affindaField: "education[].grade.value/metric", dvividSlot: "education[].gpa/maxGpa", status: "NEED TRANSFORMATION" },
  { affindaField: "workExperience[].organization/jobTitle", dvividSlot: "experience[].organization/role", status: "MAP DIRECTLY" },
  { affindaField: "workExperience[].dates.startDate/endDate/isCurrent", dvividSlot: "experience[].startDate/endDate", status: "NEED TRANSFORMATION" },
  { affindaField: "workExperience[].jobDescription", dvividSlot: "experience[].bullets", status: "NEED TRANSFORMATION" },
  { affindaField: "workExperience[].employmentType/occupation", dvividSlot: "experience[].type", status: "NEED TRANSFORMATION" },
  { affindaField: "skills[].name (+type taxonomy)", dvividSlot: "skills.{technical,programming,tools,software,domain,soft}", status: "NEED TRANSFORMATION" },
  { affindaField: "languages[] / languageCodes[]", dvividSlot: "skills.languages (candidate only; ParsedCV has NO slot)", status: "NEED TRANSFORMATION" },
  { affindaField: "certifications[]", dvividSlot: "certifications", status: "MAP DIRECTLY" },
  { affindaField: "projects[] / PROJECTS section", dvividSlot: "projects[]", status: "NEED TRANSFORMATION" },
  { affindaField: "achievements / ACHIEVEMENTS section", dvividSlot: "achievements", status: "NEED TRANSFORMATION" },
  { affindaField: "publications[]", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "sections[] (volunteer/research/other)", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "objective / summary", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "totalYearsExperience", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "referees[]", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "dateOfBirth / headShot / profession", dvividSlot: "(none)", status: "NO CURRENT D-VIVID SLOT" },
  { affindaField: "isResumeProbability", dvividSlot: "(validation signal, not a field)", status: "NO CURRENT D-VIVID SLOT" },
];
