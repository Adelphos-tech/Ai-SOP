// ============================================================
// 9-SECTION INTAKE TYPES + COMPLETION LOGIC
// ============================================================
// Defines the canonical 9-section intake structure and
// calculates completion status for each section.
// ============================================================

export interface IntakeSectionDef {
  id: number;
  slug: string;
  label: string;
  optional: boolean;
  description: string;
}

export const INTAKE_SECTIONS: IntakeSectionDef[] = [
  { id: 1, slug: "student-details", label: "Student Details", optional: false, description: "Personal information and academic history." },
  { id: 2, slug: "field-motivation", label: "Field Motivation", optional: true, description: "Why did you choose this field of study?" },
  { id: 3, slug: "academics-projects", label: "Academics & Projects", optional: false, description: "Projects, subjects learned, and skills." },
  { id: 4, slug: "work-experience", label: "Work Experience", optional: false, description: "Internships, jobs, and research roles." },
  { id: 5, slug: "masters-motivation", label: "Master's Motivation", optional: false, description: "Why pursue a master's in this field now?" },
  { id: 6, slug: "country-questions", label: "Country Questions", optional: false, description: "Country-specific motivation and post-study plans." },
  { id: 7, slug: "subject-requirements", label: "Subject Requirements", optional: true, description: "Program-specific requirements and prerequisites." },
  { id: 8, slug: "university-requirements", label: "Program / University Info", optional: true, description: "Official source URL and reusable program context. Document-specific writing requirements are collected per document." },
  { id: 9, slug: "career-goals", label: "Career Goals", optional: false, description: "Short-term and long-term career objectives." },
];

export type SectionStatus = "complete" | "incomplete" | "missing" | "optional" | "optional-skipped";

export interface SectionCompletion {
  sectionId: number;
  slug: string;
  label: string;
  status: SectionStatus;
  optional: boolean;
  /** Canonical field paths that are missing, e.g. ["nationality"] —
   * lets UIs name the exact gap instead of looping the section. */
  missingFields: string[];
}

/**
 * Calculate completion status for all 9 sections based on profile data.
 * Profile data is the flexible JSON stored in students.profile_data.
 */
export function calculateIntakeCompletion(profile: any, application?: any): SectionCompletion[] {
  const p = profile || {};
  const app = application || {};

  return INTAKE_SECTIONS.map(section => {
    let filled = false;
    const missingFields: string[] = [];

    switch (section.id) {
      case 1: { // Student Details
        if (!p.personalData?.firstName) missingFields.push("first name");
        if (!p.personalData?.lastName) missingFields.push("last name");
        if (!p.personalData?.nationality) missingFields.push("nationality");
        if (!p.personalData?.currentCountry) missingFields.push("current country");
        if (!(Array.isArray(p.education) && p.education.length > 0)) missingFields.push("education history");
        filled = missingFields.length === 0;
        break;
      }
      case 2: // Field Motivation (optional)
        filled = !!(p.fieldMotivation && String(p.fieldMotivation).trim().length > 0);
        break;
      case 3: // Academics & Projects
        const hasSkills = p.skills && Object.values(p.skills).some(
          (arr: any) => Array.isArray(arr) && arr.length > 0
        );
        filled = !!(
          (Array.isArray(p.projects) && p.projects.length > 0) ||
          (Array.isArray(p.subjects) && p.subjects.length > 0) ||
          hasSkills
        );
        break;
      case 4: // Work Experience
        filled = !!(
          (Array.isArray(p.experience) && p.experience.length > 0) ||
          p.noWorkExperience === true
        );
        break;
      case 5: // Master's Motivation
        filled = !!(
          p.mastersMotivation &&
          (p.mastersMotivation.whyNow || p.mastersMotivation.whyField || p.mastersMotivation.academicMotivation)
        );
        break;
      case 6: // Country Questions
        filled = !!(
          p.countryQuestionnaire &&
          p.countryQuestionnaire.countryCode &&
          p.countryQuestionnaire.answers &&
          Object.keys(p.countryQuestionnaire.answers).length > 0
        );
        break;
      case 7: // Subject Requirements (optional)
        filled = !!(
          p.subjectRequirements &&
          (Array.isArray(p.subjectRequirements.notes) && p.subjectRequirements.notes.length > 0)
        );
        break;
      case 8: // University Requirements (optional)
        filled = !!(
          app.universityRequirements ||
          (p.universityRequirements && Object.keys(p.universityRequirements).length > 0)
        );
        break;
      case 9: // Career Goals
        filled = !!(
          p.careerGoals &&
          (p.careerGoals.shortTerm?.role || p.careerGoals.shortTerm?.industry ||
           p.careerGoals.longTerm?.vision || p.careerGoals.longTerm?.goals)
        );
        break;
    }

    let status: SectionStatus;
    if (section.optional) {
      status = filled ? "complete" : "optional";
    } else {
      status = filled ? "complete" : "missing";
    }

    return {
      sectionId: section.id,
      slug: section.slug,
      label: section.label,
      status,
      optional: section.optional,
      missingFields,
    };
  });
}

/**
 * Get a summary of profile readiness for the generation gate.
 */
export function getProfileReadiness(profile: any, application?: any): {
  sections: SectionCompletion[];
  requiredComplete: number;
  requiredTotal: number;
  optionalComplete: number;
  optionalTotal: number;
  canGenerate: boolean;
  weakAreas: string[];
} {
  const sections = calculateIntakeCompletion(profile, application);
  const required = sections.filter(s => !s.optional);
  const optional = sections.filter(s => s.optional);

  const requiredComplete = required.filter(s => s.status === "complete").length;
  const optionalComplete = optional.filter(s => s.status === "complete").length;

  // Can generate if all required sections are complete
  const canGenerate = required.every(s => s.status === "complete");

  const weakAreas = sections
    .filter(s => s.status === "missing")
    .map(s => s.label);

  return {
    sections,
    requiredComplete,
    requiredTotal: required.length,
    optionalComplete,
    optionalTotal: optional.length,
    canGenerate,
    weakAreas,
  };
}
