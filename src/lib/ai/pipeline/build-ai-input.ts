import { StudentProfile } from "@/types";

export interface AiInput {
  personal: {
    firstName: string;
    lastName: string;
    nationality: string;
    currentCity: string;
    currentCountry: string;
    languages: string;
  };
  education: Array<{
    level: string;
    institution: string;
    degree: string;
    specialization: string;
    startYear: string;
    endYear: string;
    percentage: string;
    cgpa: string;
    cgpaScale: string;
    status: string;
  }>;
  englishProficiency: {
    testType: string;
    status: string;
    overallScore: string;
    listening: string;
    reading: string;
    writing: string;
    speaking: string;
  };
  experience: Array<{
    type: string;
    organization: string;
    role: string;
    startDate: string;
    endDate: string;
    currentlyWorking: boolean;
    location: string;
    responsibilities: string;
    keyAchievements: string;
    skillsLearned: string;
    keyLearning: string;
    relevanceToMasters: string;
  }>;
  projects: Array<{
    name: string;
    type: string;
    description: string;
    studentRole: string;
    technologies: string;
    objective: string;
    methods: string;
    outcome: string;
    challenges: string;
    whatLearned: string;
    whyChosen: string;
  }>;
  skills: {
    technical: string[];
    tools: string[];
    software: string[];
    programming: string[];
    domain: string[];
    soft: string[];
  };
  research: Array<{
    topic: string;
    institution: string;
    role: string;
    description: string;
    outcome: string;
  }>;
  publications: Array<{
    title: string;
    venue: string;
    status: string;
    year: string;
  }>;
  achievements: Array<{
    type: string;
    title: string;
    description: string;
    year: string;
  }>;
  application: {
    targetCountry: string;
    targetUniversity: string;
    targetProgram: string;
    degreeLevel: string;
    intake: string;
    intakeYear: string;
    wordRequirement: string;
    minWords: string;
    maxWords: string;
    maxCharacters: string;
    sopQuestion: string;
  };
  careerGoals: {
    whyField: string;
    whyProgram: string;
    shortTermGoals: string;
    longTermGoals: string;
    desiredRole: string;
    industries: string;
    returnHomeCountry: string;
    returnPlans: string;
  };
  personalStory: {
    motivation: string;
    influencingExperience: string;
    challenges: string;
    proudOf: string;
    qualities: string;
    leadershipExample: string;
    teamworkExample: string;
    outsideAcademics: string;
    communityService: string;
    familyBackground: string;
  };
  writingPreferences: {
    level: string;
    tone: string;
    personalization: string;
    technicalDetail: string;
    openingStyle: string;
    sopLength: string;
    customMinWords: string;
    customMaxWords: string;
  };
  projectClarifications: Array<{
    id: string;
    category: string;
    canonicalText: string;
    context: {
      domain: string;
      eventType: string;
      challenge: string;
      response: string;
    };
    source: string;
    approvalStatus: string;
    benchmarkOnly: boolean;
  }>;
}

export function buildAiInput(profile: StudentProfile): AiInput {
  const p = profile;
  return {
    personal: {
      firstName: p.personalDetails.firstName,
      lastName: p.personalDetails.lastName,
      nationality: p.personalDetails?.nationality || "",
      currentCity: p.personalDetails?.currentCity || "",
      currentCountry: p.personalDetails?.currentCountry || "",
      languages: p.personalDetails?.languages || "",
    },
    education: (p.education || []).map(e => ({
      level: e.level, institution: e.institution, degree: e.degree,
      specialization: e.specialization, startYear: e.startYear, endYear: e.endYear,
      percentage: e.percentage, cgpa: e.cgpa, cgpaScale: e.cgpaScale, status: e.status,
    })),
    englishProficiency: {
      testType: p.englishProficiency.testType,
      status: p.englishProficiency?.status || "",
      overallScore: p.englishProficiency.overallScore,
      listening: p.englishProficiency?.listening || "",
      reading: p.englishProficiency?.reading || "",
      writing: p.englishProficiency.writing,
      speaking: p.englishProficiency?.speaking || "",
    },
    experience: (p.experience || []).map(e => ({
      type: e.type, organization: e.organization, role: e.role,
      startDate: e.startDate, endDate: e.endDate, currentlyWorking: e.currentlyWorking,
      location: e.location, responsibilities: e.responsibilities,
      keyAchievements: e.keyAchievements, skillsLearned: e.skillsLearned,
      keyLearning: (e as any).keyLearning || "",
      relevanceToMasters: (e as any).relevanceToMasters || "",
    })),
    projects: (p.projects || []).map(pr => ({
      name: pr.name, type: pr.type, description: pr.description,
      studentRole: pr.studentRole, technologies: pr.technologies,
      outcome: pr.outcome, whatLearned: pr.whatLearned,
      objective: (pr as any).objective || "",
      methods: (pr as any).methods || "",
      challenges: (pr as any).challenges || "",
      whyChosen: (pr as any).whyChosen || "",
    })),
    skills: (p as any).skills || { technical: [], tools: [], software: [], programming: [], domain: [], soft: [] },
    research: (p.research || []).map(r => ({
      topic: r.topic, institution: r.institution, role: r.role,
      description: r.description, outcome: r.outcome,
    })),
    publications: (p.publications || []).map(pub => ({
      title: pub.title, venue: pub.venue, status: pub.status, year: pub.year,
    })),
    achievements: (p.achievements || []).map(a => ({
      type: a.type, title: a.title, description: a.description, year: a.year,
    })),
    application: {
      targetCountry: p.application?.targetCountry || "",
      targetUniversity: p.application?.targetUniversity || "",
      targetProgram: p.application?.targetProgram || "",
      degreeLevel: p.application?.degreeLevel || "",
      intake: p.application?.intake || "", intakeYear: p.application?.intakeYear || "",
      wordRequirement: p.application?.wordRequirement || "",
      minWords: p.application?.minWords, maxWords: p.application?.maxWords,
      maxCharacters: p.application?.maxCharacters, sopQuestion: p.application?.sopQuestion || "",
    },
    careerGoals: {
      whyField: p.careerGoals.whyField, whyProgram: p.careerGoals.whyProgram,
      shortTermGoals: p.careerGoals.shortTermGoals, longTermGoals: p.careerGoals.longTermGoals,
      desiredRole: p.careerGoals?.desiredRole || "", industries: p.careerGoals?.industries || "",
      returnHomeCountry: p.careerGoals?.returnHomeCountry || "", returnPlans: p.careerGoals?.returnPlans || "",
    },
    personalStory: {
      motivation: p.personalStory.motivation, influencingExperience: p.personalStory?.influencingExperience || "",
      challenges: p.personalStory.challenges, proudOf: p.personalStory?.proudOf || "",
      qualities: p.personalStory?.qualities || "", leadershipExample: p.personalStory?.leadershipExample || "",
      teamworkExample: p.personalStory?.teamworkExample || "", outsideAcademics: p.personalStory?.outsideAcademics || "",
      communityService: p.personalStory?.communityService || "", familyBackground: p.personalStory?.familyBackground || "",
    },
    writingPreferences: {
      level: p.writingPreferences?.sopWritingProfile?.level || "Natural Professional",
      tone: p.writingPreferences?.sopWritingProfile?.tone || "Professional & Personal",
      personalization: p.writingPreferences?.sopWritingProfile?.personalization || "Balanced",
      technicalDetail: p.writingPreferences?.sopWritingProfile?.technicalDetail || "Medium",
      openingStyle: p.writingPreferences?.sopWritingProfile?.openingStyle || "Let AI Choose Best Opening",
      sopLength: p.writingPreferences?.sopWritingProfile?.sopLength || "900-1100",
      customMinWords: p.writingPreferences?.sopWritingProfile?.customMinWords,
      customMaxWords: p.writingPreferences?.sopWritingProfile?.customMaxWords,
    },
    projectClarifications: (p.projectClarifications || []).map((pc: any) => ({
      id: pc.id || "",
      category: pc.category || "",
      canonicalText: pc.canonicalText || "",
      context: pc.context || {},
      source: pc.source || "",
      approvalStatus: pc.approvalStatus || "",
      benchmarkOnly: pc.benchmarkOnly || false,
    })),
  };
}

export function getWordRange(input: AiInput): { min: number; max: number } {
  const app = input.application;
  if (app.wordRequirement === "Known" && app.minWords) {
    return {
      min: parseInt(app.minWords) || 800,
      max: parseInt(app.maxWords) || 1100,
    };
  }
  const wp = input.writingPreferences;
  switch (wp.sopLength) {
    case "500-700": return { min: 500, max: 700 };
    case "700-900": return { min: 700, max: 900 };
    case "900-1100": return { min: 900, max: 1100 };
    case "Custom":
      return {
        min: parseInt(wp.customMinWords) || 800,
        max: parseInt(wp.customMaxWords) || 1100,
      };
    default: return { min: 900, max: 1100 };
  }
}
