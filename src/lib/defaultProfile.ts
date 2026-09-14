import { StudentProfile } from "@/types";

export function createEmptyProfile(): StudentProfile {
  return {
    personalDetails: {
      firstName: "", middleName: "", lastName: "",
      dateOfBirth: "", gender: "", nationality: "",
      currentCity: "", currentCountry: "", languages: "",
    },
    education: [],
    englishProficiency: {
      testType: "", status: "Not Taken",
      overallScore: "", listening: "", reading: "", writing: "", speaking: "",
    },
    writingPreferences: {
      actualEnglishProficiency: {
        testType: "", status: "Not Taken",
        overallScore: "", listening: "", reading: "", writing: "", speaking: "",
      },
      sopWritingProfile: {
        level: "", tone: "", personalization: "",
        technicalDetail: "", openingStyle: "", sopLength: "",
        customMinWords: "", customMaxWords: "",
      },
    },
    experience: [],
    projects: [],
    research: [],
    publications: [],
    achievements: [],
    application: {
      targetCountry: "", targetUniversity: "", targetProgram: "",
      degreeLevel: "", intake: "", intakeYear: "",
      wordRequirement: "", minWords: "", maxWords: "", maxCharacters: "",
      sopQuestion: "", aiPolicyAttestation: "",
      officialRequirementsUrl: "", officialAiPolicyUrl: "",
    },
    careerGoals: {
      whyField: "", whyProgram: "", shortTermGoals: "", longTermGoals: "",
      desiredRole: "", industries: "",
      returnHomeCountry: "", returnPlans: "",
    },
    personalStory: {
      motivation: "", influencingExperience: "", challenges: "",
      proudOf: "", qualities: "", leadershipExample: "",
      teamworkExample: "", outsideAcademics: "",
      communityService: "", familyBackground: "",
    },
    documents: [],
    factSheetApproval: { approved: false, approvedAt: "" },
  };
}

export function createDemoProfile(): StudentProfile {
  const p = createEmptyProfile();
  p.personalDetails = {
    firstName: "Demo", middleName: "", lastName: "Student",
    dateOfBirth: "2001-05-15", gender: "Female",
    nationality: "Indian", currentCity: "Surat", currentCountry: "India",
    languages: "English, Hindi, Gujarati",
  };
  p.education = [{
    id: "edu1", level: "Bachelor's", institution: "Demo University",
    board: "Demo Board", degree: "B.Tech Computer Science",
    specialization: "Artificial Intelligence", startYear: "2019",
    endYear: "2023", percentage: "85", cgpa: "8.5", cgpaScale: "10",
    backlogs: "0", status: "Completed",
  }];
  p.englishProficiency = {
    testType: "IELTS", status: "Completed", overallScore: "7.0",
    listening: "7.5", reading: "7.0", writing: "6.5", speaking: "7.0",
  };
  p.writingPreferences.actualEnglishProficiency = { ...p.englishProficiency };
  p.writingPreferences.sopWritingProfile = {
    level: "Natural Professional", tone: "Professional & Personal",
    personalization: "Balanced", technicalDetail: "Medium",
    openingStyle: "Let AI Choose Best Opening", sopLength: "900-1100",
    customMinWords: "", customMaxWords: "",
  };
  p.experience = [{
    id: "exp1", type: "Internship", organization: "Demo Tech Corp",
    role: "Software Engineer Intern", startDate: "2022-06", endDate: "2022-08",
    currentlyWorking: false, location: "Bangalore, India",
    responsibilities: "Built REST APIs, worked on microservices architecture",
    keyAchievements: "Improved API response time by 30%",
    skillsLearned: "Node.js, Docker, Kubernetes, AWS",
  }];
  p.projects = [{
    id: "proj1", name: "Demo AI Chatbot", type: "Academic Project",
    description: "Built a chatbot using NLP for college admissions queries",
    studentRole: "Lead Developer", technologies: "Python, TensorFlow, Flask",
    outcome: "Deployed to production, serving 500+ students",
    whatLearned: "NLP fundamentals, model deployment, user experience design",
  }];
  p.application = {
    targetCountry: "USA", targetUniversity: "Demo State University",
    targetProgram: "MS in Computer Science", degreeLevel: "Master's",
    intake: "Fall", intakeYear: "2024", wordRequirement: "Known",
    minWords: "800", maxWords: "1000", maxCharacters: "", sopQuestion: "Why do you wish to pursue this program?",
    aiPolicyAttestation: "",
    officialRequirementsUrl: "", officialAiPolicyUrl: "",
  };
  p.careerGoals = {
    whyField: "Fascinated by AI and its real-world applications",
    whyProgram: "This program offers the perfect blend of theory and practice",
    shortTermGoals: "Work as an AI/ML engineer at a tech company",
    longTermGoals: "Lead AI research at a major tech firm",
    desiredRole: "AI/ML Engineer", industries: "Technology, Healthcare AI",
    returnHomeCountry: "Yes", returnPlans: "Apply AI skills to solve local problems",
  };
  return p;
}
