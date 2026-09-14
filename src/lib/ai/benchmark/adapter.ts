import { StudentProfile } from "@/types";

interface BenchmarkCase {
  case_id: string;
  benchmark_type: string;
  source_document_id: string;
  student_facts: any;
  application: any;
  student_answers: any;
  reference: {
    human_written_sop: string;
  };
}

const BENCHMARK_CONTROL = {
  level: "Natural Professional",
  tone: "Professional & Personal",
  personalization: "Balanced",
  technicalDetail: "Medium",
  openingStyle: "Let AI Choose Best Opening",
  sopLength: "900-1100",
  customMinWords: "",
  customMaxWords: "",
};

export function adaptBenchmarkToProfile(benchmarkCase: any): { profile: StudentProfile; referenceSop: string } {
  const c = benchmarkCase as BenchmarkCase;
  const sf = c.student_facts;
  const app = c.application;
  const sa = c.student_answers;

  const education = (sf.education || []).map((e: any, i: number) => ({
    id: `edu-${i}`,
    level: e.level || "",
    institution: e.institution || "",
    board: "",
    degree: e.degree || e.level || "",
    specialization: e.specialization || "",
    startYear: e.start_year || "",
    endYear: e.end_year || "",
    percentage: e.percentage || e.higher_secondary_percentile || "",
    cgpa: e.cgpa || "",
    cgpaScale: e.cgpa_scale || "",
    backlogs: "",
    status: "Completed" as const,
  }));

  const experience = [
    ...(sf.internships || []).map((intern: any, i: number) => ({
      id: `intern-${i}`,
      type: "Internship" as any,
      organization: intern.company || "",
      role: intern.role || "",
      startDate: intern.start_date || "",
      endDate: intern.end_date || "",
      currentlyWorking: false,
      location: intern.location || "",
      responsibilities: intern.work || "",
      keyAchievements: intern.achievements || "",
      skillsLearned: intern.technologies || "",
    })),
    ...(sf.work_experience || []).map((w: any, i: number) => ({
      id: `work-${i}`,
      type: "Work Experience" as any,
      organization: w.company || "",
      role: w.role || "",
      startDate: w.start_date || "",
      endDate: w.end_date || "",
      currentlyWorking: false,
      location: w.location || "",
      responsibilities: w.work || w.responsibilities || "",
      keyAchievements: w.achievements || "",
      skillsLearned: w.technologies || "",
    })),
  ];

  const projects = (sf.projects || []).map((p: any, i: number) => ({
    id: `proj-${i}`,
    name: p.name || "",
    type: p.type || "Project",
    description: p.description || "",
    studentRole: p.role || "",
    technologies: p.technologies || "",
    outcome: p.outcome || "",
    whatLearned: p.what_learned || "",
  }));

  const research = (sf.research || []).map((r: any, i: number) => ({
    id: `res-${i}`,
    topic: typeof r === "string" ? r : (r.topic || ""),
    institution: typeof r === "string" ? "" : (r.institution || ""),
    role: typeof r === "string" ? "" : (r.role || ""),
    description: typeof r === "string" ? r : (r.description || ""),
    outcome: typeof r === "string" ? "" : (r.outcome || ""),
  }));

  const publications = (sf.publications || []).map((p: any, i: number) => ({
    id: `pub-${i}`,
    title: p.title || "",
    venue: p.venue || "",
    status: p.status || "Published",
    year: p.year || "",
  }));

  const achievements = [
    ...(sf.achievements || []).map((a: any, i: number) => ({
      id: `ach-${i}`,
      type: "Achievement" as any,
      title: typeof a === "string" ? a : (a.title || ""),
      description: typeof a === "string" ? "" : (a.description || ""),
      year: typeof a === "string" ? "" : (a.year || ""),
    })),
    ...(sf.certifications || []).map((cert: any, i: number) => ({
      id: `cert-${i}`,
      type: "Certification" as any,
      title: typeof cert === "string" ? cert : (cert.title || String(cert)),
      description: "",
      year: "",
    })),
  ];

  const englishTest = sf.english_test || {};
  const englishProficiency = {
    testType: englishTest.test || englishTest.type || "",
    status: (englishTest.test ? "Completed" : "Not Taken") as any,
    overallScore: englishTest.overall || englishTest.score || "",
    listening: englishTest.listening || "",
    reading: englishTest.reading || "",
    writing: englishTest.writing || "",
    speaking: englishTest.speaking || "",
  };

  const wordRequirement = app.word_limit && app.word_limit > 0 ? "Known" : "Unknown";
  const minWords = app.word_limit && app.word_limit > 0 ? String(app.word_limit) : "";
  const maxWords = app.word_limit && app.word_limit > 0 ? String(Math.round(app.word_limit * 1.1)) : "";

  const careerGoals = {
    whyField: sa.motivation || "",
    whyProgram: sa.why_program || "",
    shortTermGoals: sa.short_term_goal || "",
    longTermGoals: sa.long_term_goal || "",
    desiredRole: "",
    industries: "",
    returnHomeCountry: "",
    returnPlans: "",
  };

  const personalStory = {
    motivation: sa.motivation || "",
    influencingExperience: "",
    challenges: "",
    proudOf: "",
    qualities: sa.personality || "",
    leadershipExample: sa.leadership || "",
    teamworkExample: "",
    outsideAcademics: sa.extracurricular || "",
    communityService: "",
    familyBackground: "",
  };

  const skills = sf.skills || {};
  const skillsStr = typeof skills === "object"
    ? Object.values(skills).flat().join(", ")
    : String(skills);

  const profile = {
    personalDetails: {
      firstName: "Benchmark",
      lastName: c.case_id,
      middleName: "",
      dateOfBirth: "",
      nationality: "Indian",
      currentCity: "",
      currentCountry: "India",
      languages: skillsStr,
      gender: "",
    },
    education,
    englishProficiency,
    writingPreferences: {
      actualEnglishProficiency: {
        testType: englishProficiency.testType,
        status: englishProficiency.status,
        overallScore: englishProficiency.overallScore,
        listening: englishProficiency.listening,
        reading: englishProficiency.reading,
        writing: englishProficiency.writing,
        speaking: englishProficiency.speaking,
      },
      sopWritingProfile: { ...BENCHMARK_CONTROL } as any,
    },
    experience,
    projects,
    research,
    publications,
    achievements,
    application: {
      targetCountry: app.country || "",
      targetUniversity: app.target_university || "",
      targetProgram: app.target_course || "",
      degreeLevel: "",
      intake: "",
      intakeYear: "",
      wordRequirement,
      minWords,
      maxWords,
      maxCharacters: "",
      sopQuestion: "",
      aiPolicyAttestation: "",
      officialRequirementsUrl: "",
      officialAiPolicyUrl: "",
    },
    careerGoals,
    personalStory,
    documents: [],
    factSheetApproval: {
      approved: true,
      approvedAt: new Date().toISOString(),
    },
  };

  return { profile: profile as StudentProfile, referenceSop: c.reference?.human_written_sop || "" };
}

// Reference leakage check — checks for reference-specific KEYS, not content words
export function checkReferenceLeakage(profile: StudentProfile): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  const serialized = JSON.stringify(profile);

  // Check for reference-specific JSON keys (not content words)
  if (serialized.includes('"human_written_sop"')) issues.push("human_written_sop key found in payload");
  if (serialized.includes('"reference":')) issues.push("reference key found in payload");
  if (serialized.includes('"provenance"')) issues.push("provenance key found in payload");
  if (serialized.includes('"source_document_id"')) issues.push("source_document_id key found in payload");
  if (serialized.includes('"benchmark_type"')) issues.push("benchmark_type key found in payload");

  return { pass: issues.length === 0, issues };
}
