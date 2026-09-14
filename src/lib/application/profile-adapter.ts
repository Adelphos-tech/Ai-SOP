// ============================================================
// PROFILE ADAPTER
// Phase SOP-AI-33
// ============================================================
// Bridges the persistent StudentProfileData (flexible JSON)
// to the StudentProfile format expected by the pipeline.
// ============================================================

import { StudentProfileData } from "./application-types";
import { StudentProfile } from "@/types";

/**
 * Convert persistent StudentProfileData to the StudentProfile
 * format expected by the six-stage pipeline.
 *
 * The persistent profile may have different field names and
 * structure. This adapter normalizes them.
 */
export function adaptProfile(
  student: any,
  profileData: StudentProfileData | null,
): StudentProfile {
  const anyProfile = (profileData || {}) as any;

  // Extract fields from the persistent profile format
  // Canonical (intake) keys are primary; legacy keys are fallbacks
  // for compatibility with profiles created before the 9-section intake.
  // Legacy data is only used where canonical data is absent — never overwrites.
  const personalData = anyProfile.personalData || {};
  const legacyPersonalDetails = anyProfile.personalDetails || {};
  const education = anyProfile.education || [];
  const englishTesting = anyProfile.englishTesting || {};
  const legacyEnglishProficiency = anyProfile.englishProficiency || {};
  const experience = anyProfile.experience || [];
  const projects = anyProfile.projects || [];
  const achievements = anyProfile.achievements || [];
  const careerGoals = anyProfile.careerGoals || {};
  const personalStory = anyProfile.personalStory || {};
  const preferences = anyProfile.preferences || {};
  const writingPreferences = anyProfile.writingPreferences || {};

  // Build the StudentProfile — cast through unknown to avoid strict type issues
  // with optional fields that the pipeline doesn't require
  const profile: any = {
    personalDetails: {
      firstName: personalData.firstName || legacyPersonalDetails.firstName || student?.firstName || "",
      middleName: personalData.middleName || legacyPersonalDetails.middleName || "",
      lastName: personalData.lastName || legacyPersonalDetails.lastName || student?.lastName || "",
      dateOfBirth: personalData.dateOfBirth || legacyPersonalDetails.dateOfBirth || "",
      gender: personalData.gender || legacyPersonalDetails.gender || "",
      nationality: personalData.nationality || legacyPersonalDetails.nationality || "",
      currentCity: personalData.currentCity || legacyPersonalDetails.currentCity || "",
      currentCountry: personalData.currentCountry || legacyPersonalDetails.currentCountry || "",
      languages: personalData.languages || legacyPersonalDetails.languages || "",
    },
    education: education.map((e: any) => ({
      id: e.id || "",
      level: e.level || "",
      institution: e.institution || "",
      degree: e.degree || "",
      specialization: e.specialization || "",
      startYear: e.startYear || "",
      endYear: e.endYear || "",
      percentage: e.percentage || "",
      cgpa: e.cgpa || "",
      cgpaScale: e.cgpaScale || "",
      status: e.status || "",
    })),
    englishProficiency: {
      testType: englishTesting.testType || legacyEnglishProficiency.testType || "",
      status: englishTesting.status || legacyEnglishProficiency.status || "",
      overallScore: englishTesting.overallScore || legacyEnglishProficiency.overallScore || "",
      listening: englishTesting.listening || legacyEnglishProficiency.listening || "",
      reading: englishTesting.reading || legacyEnglishProficiency.reading || "",
      writing: englishTesting.writing || legacyEnglishProficiency.writing || "",
      speaking: englishTesting.speaking || legacyEnglishProficiency.speaking || "",
    },
    writingPreferences: {
      actualEnglishProficiency: {
        testType: englishTesting.testType || legacyEnglishProficiency.testType || "",
        status: englishTesting.status || legacyEnglishProficiency.status || "",
        overallScore: englishTesting.overallScore || legacyEnglishProficiency.overallScore || "",
        listening: englishTesting.listening || legacyEnglishProficiency.listening || "",
        reading: englishTesting.reading || legacyEnglishProficiency.reading || "",
        writing: englishTesting.writing || legacyEnglishProficiency.writing || "",
        speaking: englishTesting.speaking || legacyEnglishProficiency.speaking || "",
      },
      sopWritingProfile: {
        level: writingPreferences.level || preferences.level || "Natural Professional",
        tone: writingPreferences.tone || preferences.tone || "Professional & Personal",
        personalization: writingPreferences.personalization || preferences.personalization || "Balanced",
        technicalDetail: writingPreferences.technicalDetail || preferences.technicalDetail || "Medium",
        openingStyle: writingPreferences.openingStyle || preferences.openingStyle || "Let AI Choose Best Opening",
        sopLength: writingPreferences.sopLength || preferences.sopLength || "900-1100",
        customMinWords: writingPreferences.customMinWords || preferences.customMinWords || "",
        customMaxWords: writingPreferences.customMaxWords || preferences.customMaxWords || "",
      },
    },
    experience: experience.map((e: any) => ({
      id: e.id || "",
      type: e.type || "",
      organization: e.organization || "",
      role: e.role || "",
      startDate: e.startDate || "",
      endDate: e.endDate || "",
      currentlyWorking: e.currentlyWorking || false,
      location: e.location || "",
      responsibilities: e.responsibilities || "",
      keyAchievements: e.keyAchievements || e.achievements || "",
      skillsLearned: e.skillsLearned || e.skillsUsed || "",
      keyLearning: e.keyLearning || "",
      relevanceToMasters: e.relevanceToMasters || "",
    })),
    projects: projects.map((p: any) => ({
      id: p.id || "",
      name: p.name || "",
      type: p.type || "",
      description: p.description || "",
      studentRole: p.studentRole || p.role || "",
      technologies: p.technologies || "",
      objective: p.objective || "",
      methods: p.methods || "",
      outcome: p.outcome || "",
      challenges: p.challenges || "",
      whatLearned: p.whatLearned || "",
      whyChosen: p.whyChosen || "",
    })),
    research: (anyProfile.research || []).map((r: any) => ({
      topic: r.topic || "",
      institution: r.institution || "",
      role: r.role || "",
      description: r.description || "",
      outcome: r.outcome || "",
    })),
    publications: (anyProfile.publications || []).map((p: any) => ({
      title: p.title || "",
      venue: p.venue || "",
      status: p.status || "",
      year: p.year || "",
    })),
    achievements: achievements.map((a: any) => ({
      id: a.id || "",
      type: a.type || "",
      title: a.title || "",
      description: a.description || "",
      year: a.year || "",
    })),
    application: {
      targetCountry: anyProfile.application?.targetCountry || "",
      targetUniversity: anyProfile.application?.targetUniversity || "",
      targetProgram: anyProfile.application?.targetProgram || "",
      degreeLevel: anyProfile.application?.degreeLevel || "",
      intake: anyProfile.application?.intake || "",
      intakeYear: anyProfile.application?.intakeYear || "",
      wordRequirement: anyProfile.application?.wordRequirement || "",
      minWords: anyProfile.application?.minWords || "",
      maxWords: anyProfile.application?.maxWords || "",
      maxCharacters: anyProfile.application?.maxCharacters || "",
      sopQuestion: anyProfile.application?.sopQuestion || "",
      aiPolicyAttestation: anyProfile.application?.aiPolicyAttestation || "",
      officialRequirementsUrl: anyProfile.application?.officialRequirementsUrl || "",
      officialAiPolicyUrl: anyProfile.application?.officialAiPolicyUrl || "",
    },
    careerGoals: {
      whyField: careerGoals.whyField || "",
      whyProgram: careerGoals.whyProgram || "",
      shortTermGoals: careerGoals.shortTermGoals || "",
      longTermGoals: careerGoals.longTermGoals || "",
      desiredRole: careerGoals.desiredRole || "",
      industries: careerGoals.industries || "",
      returnHomeCountry: careerGoals.returnHomeCountry || "",
      returnPlans: careerGoals.returnPlans || "",
    },
    personalStory: {
      motivation: personalStory.motivation || "",
      influencingExperience: personalStory.influencingExperience || "",
      challenges: personalStory.challenges || "",
      proudOf: personalStory.proudOf || "",
      qualities: personalStory.qualities || "",
      leadershipExample: personalStory.leadershipExample || "",
      teamworkExample: personalStory.teamworkExample || "",
      outsideAcademics: personalStory.outsideAcademics || "",
      communityService: personalStory.communityService || "",
      familyBackground: personalStory.familyBackground || "",
    },
    documents: [],
    factSheetApproval: {
      approved: anyProfile.factSheetApproval?.approved || false,
      approvedAt: anyProfile.factSheetApproval?.approvedAt || "",
      requirementsConfirmed: anyProfile.factSheetApproval?.requirementsConfirmed,
    },
    projectClarifications: anyProfile.projectClarifications || [],
    // ===== Phase UI-9SECTION: New structured intake fields =====
    // These are passed through to the pipeline as structured evidence.
    // The adapter also maps them to legacy fields for backward compatibility.
    fieldMotivation: anyProfile.fieldMotivation || "",
    mastersMotivation: anyProfile.mastersMotivation || {},
    countryQuestionnaire: anyProfile.countryQuestionnaire || {},
    subjects: anyProfile.subjects || [],
    skills: anyProfile.skills || {},
    subjectRequirements: anyProfile.subjectRequirements || {},
    universityRequirements: anyProfile.universityRequirements || {},
  };

  // ===== Map new structured fields to legacy fields for backward compatibility =====
  // Field motivation → personalStory.motivation (if personalStory.motivation is empty)
  if (!profile.personalStory.motivation && anyProfile.fieldMotivation) {
    profile.personalStory.motivation = anyProfile.fieldMotivation;
  }

  // Master's motivation → careerGoals.whyProgram (if empty)
  const mm = anyProfile.mastersMotivation || {};
  if (!profile.careerGoals.whyProgram) {
    profile.careerGoals.whyProgram = mm.whyField || mm.whyNow || "";
  }

  // Career goals short-term/long-term structured → legacy fields
  const cg = anyProfile.careerGoals || {};
  if (cg.shortTerm) {
    if (!profile.careerGoals.shortTermGoals) {
      profile.careerGoals.shortTermGoals = [cg.shortTerm.role, cg.shortTerm.industry].filter(Boolean).join(" — ");
    }
    if (!profile.careerGoals.desiredRole) {
      profile.careerGoals.desiredRole = cg.shortTerm.role || "";
    }
    if (!profile.careerGoals.industries) {
      profile.careerGoals.industries = cg.shortTerm.industry || "";
    }
  }
  if (cg.longTerm) {
    if (!profile.careerGoals.longTermGoals) {
      profile.careerGoals.longTermGoals = [cg.longTerm.vision, cg.longTerm.goals].filter(Boolean).join(" — ");
    }
    if (!profile.careerGoals.returnPlans) {
      profile.careerGoals.returnPlans = cg.longTerm.homeCountryPlans || "";
    }
  }

  // Preserve structured career goals for the pipeline (separate short-term/long-term)
  (profile as any).careerGoalsStructured = {
    shortTerm: cg.shortTerm || {},
    longTerm: cg.longTerm || {},
  };

  return profile as StudentProfile;
}
