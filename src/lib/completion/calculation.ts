import { StudentProfile, SectionInfo, SectionStatus } from "@/types";

function hasValue(s: string | undefined | null): boolean {
  return !!s && s.trim().length > 0;
}

function checkFields(fields: (string | undefined | null)[]): { filled: number; total: number } {
  const total = fields.length;
  const filled = fields.filter(hasValue).length;
  return { filled, total };
}

export function getSectionStatus(filled: number, total: number): SectionStatus {
  if (filled === 0) return "not-started";
  if (filled === total) return "complete";
  if (filled >= total * 0.5) return "in-progress";
  return "missing";
}

export function calculateSections(profile: StudentProfile): SectionInfo[] {
  const sections: SectionInfo[] = [];

  // Personal Details
  const pd = profile.personalDetails;
  const pdCheck = checkFields([pd.firstName, pd.lastName, pd.dateOfBirth, pd.nationality, pd.currentCity, pd.currentCountry]);
  sections.push({
    id: "personal", label: "Personal Details",
    status: getSectionStatus(pdCheck.filled, pdCheck.total),
    completionPct: Math.round((pdCheck.filled / pdCheck.total) * 100),
  });

  // Education
  const eduCount = profile.education.length;
  const eduFilled = profile.education.filter(e => hasValue(e.level) && hasValue(e.institution) && hasValue(e.degree)).length;
  const eduStatus = eduCount === 0 ? "not-started" : eduFilled === eduCount ? "complete" : "in-progress";
  sections.push({
    id: "education", label: "Education",
    status: eduStatus as SectionStatus,
    completionPct: eduCount === 0 ? 0 : Math.round((eduFilled / eduCount) * 100),
  });

  // English Proficiency
  const ep = profile.englishProficiency;
  const epCheck = checkFields([ep.testType, ep.testType === "None" ? "done" : ep.overallScore]);
  sections.push({
    id: "english", label: "English Proficiency",
    status: getSectionStatus(epCheck.filled, epCheck.total),
    completionPct: Math.round((epCheck.filled / epCheck.total) * 100),
  });

  // Writing Preferences
  const wp = profile.writingPreferences.sopWritingProfile;
  const wpCheck = checkFields([wp.level, wp.tone, wp.openingStyle, wp.sopLength]);
  sections.push({
    id: "preferences", label: "SOP Preferences",
    status: getSectionStatus(wpCheck.filled, wpCheck.total),
    completionPct: Math.round((wpCheck.filled / wpCheck.total) * 100),
  });

  // Experience
  const expCount = profile.experience.length;
  const expStatus = expCount === 0 ? "not-started" : "complete";
  sections.push({
    id: "experience", label: "Experience",
    status: expStatus as SectionStatus,
    completionPct: expCount > 0 ? 100 : 0,
  });

  // Projects & Research
  const projCount = profile.projects.length + profile.research.length + profile.publications.length;
  const projStatus = projCount === 0 ? "not-started" : "complete";
  sections.push({
    id: "projects", label: "Projects & Research",
    status: projStatus as SectionStatus,
    completionPct: projCount > 0 ? 100 : 0,
  });

  // Achievements
  const achCount = profile.achievements.length;
  sections.push({
    id: "achievements", label: "Achievements",
    status: achCount === 0 ? "not-started" : "complete",
    completionPct: achCount > 0 ? 100 : 0,
  });

  // Course & University
  const app = profile.application;
  const appCheck = checkFields([app.targetCountry, app.targetUniversity, app.targetProgram, app.degreeLevel]);
  sections.push({
    id: "application", label: "Course & University",
    status: getSectionStatus(appCheck.filled, appCheck.total),
    completionPct: Math.round((appCheck.filled / appCheck.total) * 100),
  });

  // Career Goals
  const cg = profile.careerGoals;
  const cgCheck = checkFields([cg.whyField, cg.whyProgram, cg.shortTermGoals, cg.longTermGoals]);
  sections.push({
    id: "career", label: "Career Goals",
    status: getSectionStatus(cgCheck.filled, cgCheck.total),
    completionPct: Math.round((cgCheck.filled / cgCheck.total) * 100),
  });

  // Personal Story
  const ps = profile.personalStory;
  const psCheck = checkFields([ps.motivation, ps.challenges, ps.proudOf, ps.qualities]);
  sections.push({
    id: "personal-story", label: "Personal Story",
    status: getSectionStatus(psCheck.filled, psCheck.total),
    completionPct: Math.round((psCheck.filled / psCheck.total) * 100),
  });

  // Documents
  const docCount = profile.documents.length;
  sections.push({
    id: "documents", label: "Documents",
    status: docCount === 0 ? "not-started" : "complete",
    completionPct: docCount > 0 ? 100 : 0,
  });

  return sections;
}

export function calculateOverallCompletion(sections: SectionInfo[]): number {
  if (sections.length === 0) return 0;
  const total = sections.reduce((sum, s) => sum + s.completionPct, 0);
  return Math.round(total / sections.length);
}

export function getRequiredItemsRemaining(sections: SectionInfo[]): number {
  return sections.filter(s => s.status === "not-started" || s.status === "missing").length;
}

export function getCompletedSections(sections: SectionInfo[]): number {
  return sections.filter(s => s.status === "complete").length;
}
