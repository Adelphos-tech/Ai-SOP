/**
 * Evidence Mapping Test — Canonical Profile → AI Evidence
 *
 * Tests that every canonical intake field reaches the AI evidence
 * model through adaptProfile() → buildAiInput() / buildEvidenceLedger().
 *
 * NO OpenAI calls are made.
 *
 * Run: npx tsx tests/evidence-mapping-test.ts
 */

import { adaptProfile } from "@/lib/application/profile-adapter";
import { buildAiInput } from "@/lib/ai/pipeline/build-ai-input";
import { buildEvidenceLedger } from "@/lib/ai/evidence-ledger";
import { buildApplicationEvidenceBundle } from "@/lib/ai/application-evidence-bundle";

// ============================================================
// SYNTHETIC RICH PROFILE (canonical intake shape)
// ============================================================
const canonicalProfile = {
  personalData: {
    firstName: "Test",
    lastName: "Student",
    nationality: "Indian",
    currentCity: "Mumbai",
    currentCountry: "India",
  },
  education: [
    {
      id: "edu-1",
      level: "Bachelor's",
      institution: "IIT Bombay",
      degree: "B.Tech",
      specialization: "Computer Science",
      startYear: "2020",
      endYear: "2024",
      cgpa: "8.5",
      cgpaScale: "10",
      percentage: "",
      backlogs: "0",
      status: "Completed",
    },
  ],
  englishTesting: {
    testType: "IELTS",
    status: "Taken",
    overallScore: "7.5",
    listening: "8",
    reading: "7.5",
    writing: "7",
    speaking: "7.5",
  },
  experience: [
    {
      id: "exp-1",
      type: "Internship",
      organization: "Google",
      role: "Software Engineer Intern",
      location: "Bangalore",
      startDate: "2023-06",
      endDate: "2023-08",
      currentlyWorking: false,
      responsibilities: "Built REST APIs for internal tooling",
      achievements: "Improved API latency by 40%",
      skillsUsed: "Go, Kubernetes, gRPC",
      keyLearning: "Learned distributed systems design",
      relevanceToMasters: "Directly relevant to MS in distributed systems",
    },
  ],
  projects: [
    {
      id: "proj-1",
      name: "Smart Attendance System",
      type: "Academic",
      description: "Automated attendance tracking",
      role: "Backend Developer",
      objective: "Reduce manual attendance recording",
      methods: "Designed REST APIs and database workflow",
      technologies: "Java, MySQL",
      outcome: "Working prototype",
      challenges: "Handling concurrent updates",
      whatLearned: "Database transaction isolation",
      whyChosen: "Required for DB course",
    },
    {
      id: "proj-2",
      name: "ML Sentiment Analyzer",
      type: "Personal",
      description: "NLP-based sentiment analysis",
      role: "Solo Developer",
      objective: "Classify product reviews",
      methods: "Fine-tuned BERT model",
      technologies: "Python, PyTorch",
      outcome: "92% accuracy",
      challenges: "Limited training data",
      whatLearned: "Transfer learning techniques",
      whyChosen: "Interest in NLP",
    },
  ],
  achievements: [
    {
      id: "ach-1",
      type: "Award",
      title: "Best Project Award",
      description: "First place at hackathon",
      year: "2023",
    },
    {
      id: "ach-2",
      type: "Certification",
      title: "AWS Certified Developer",
      description: "Associate level certification",
      year: "2023",
    },
  ],
  skills: {
    technical: ["Machine Learning", "Data Analysis"],
    tools: ["Git", "JIRA"],
    software: ["MATLAB"],
    programming: ["Java", "MySQL", "Flutter"],
    domain: ["Financial Modeling"],
    soft: ["Leadership", "Communication"],
  },
  careerGoals: {
    shortTerm: {
      role: "Software Engineer at a FAANG company",
      industry: "Technology",
      responsibilities: "Build scalable backend systems",
      location: "USA",
    },
    longTerm: {
      vision: "Lead engineering at a tech startup",
      goals: "Become a VP of Engineering",
      impact: "Create products used by millions",
      homeCountryPlans: "Return to India to start a company",
    },
  },
  fieldMotivation: "I first became interested in CS when I built a website in high school.",
  mastersMotivation: {
    whyField: "Want to deepen my CS knowledge",
    whyNow: "Ready after 2 years of industry experience",
    skillGaps: "Need advanced ML and distributed systems knowledge",
    academicMotivation: "Want to do research in NLP",
    professionalMotivation: "Want to move into ML engineering",
    expectedLearning: "Advanced ML, distributed systems",
    careerSupport: "Will help me reach VP of Engineering",
  },
};

// ============================================================
// RUN ADAPTER + EVIDENCE CONSTRUCTION
// ============================================================
const student: any = { id: "test-student", firstName: "Test", lastName: "Student" };
const adapted = adaptProfile(student, canonicalProfile as any);
const aiInput = buildAiInput(adapted);
const bundle = buildApplicationEvidenceBundle({
  profile: adapted,
  programContextText: "",
  facultyAlignment: [],
});
const ledger = bundle.ledger;

// ============================================================
// ASSERTIONS
// ============================================================
let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

function evidenceContains(substr: string): boolean {
  return bundle.studentFactsText.includes(substr) ||
    ledger.studentFacts.some(e => e.canonicalText.includes(substr));
}

function aiInputContains(substr: string): boolean {
  return JSON.stringify(aiInput).includes(substr);
}

console.log("\n=== CANONICAL PROJECTS ===");
check("Canonical projects", aiInput.projects.length === 2, `got ${aiInput.projects.length}`);
check("Project role", aiInput.projects[0].studentRole === "Backend Developer", `got "${aiInput.projects[0].studentRole}"`);
check("Project objective", aiInput.projects[0].objective === "Reduce manual attendance recording", `got "${aiInput.projects[0].objective}"`);
check("Project methods", aiInput.projects[0].methods === "Designed REST APIs and database workflow", `got "${aiInput.projects[0].methods}"`);
check("Project technologies", aiInput.projects[0].technologies === "Java, MySQL", `got "${aiInput.projects[0].technologies}"`);
check("Project outcome", aiInput.projects[0].outcome === "Working prototype", `got "${aiInput.projects[0].outcome}"`);

console.log("\n=== SKILLS ===");
check("Skills present in AiInput", !!aiInput.skills, "skills field missing");
check("Programming skills — Java", aiInput.skills?.programming?.includes("Java") === true, "Java not found");
check("Programming skills — MySQL", aiInput.skills?.programming?.includes("MySQL") === true, "MySQL not found");
check("Programming skills — Flutter", aiInput.skills?.programming?.includes("Flutter") === true, "Flutter not found");
check("Skills in evidence ledger", evidenceContains("Java") || evidenceContains("SKILLS"), "skills not in evidence");

console.log("\n=== EDUCATION ===");
check("Education institution", aiInput.education[0].institution === "IIT Bombay", `got "${aiInput.education[0].institution}"`);
check("Education degree", aiInput.education[0].degree === "B.Tech", `got "${aiInput.education[0].degree}"`);
check("Education specialization", aiInput.education[0].specialization === "Computer Science", `got "${aiInput.education[0].specialization}"`);
check("Education CGPA", aiInput.education[0].cgpa === "8.5", `got "${aiInput.education[0].cgpa}"`);
check("Education CGPA scale", aiInput.education[0].cgpaScale === "10", `got "${aiInput.education[0].cgpaScale}"`);
check("Education start year", aiInput.education[0].startYear === "2020", `got "${aiInput.education[0].startYear}"`);
check("Education end year", aiInput.education[0].endYear === "2024", `got "${aiInput.education[0].endYear}"`);

console.log("\n=== EXPERIENCE ===");
check("Experience organization", aiInput.experience[0].organization === "Google", `got "${aiInput.experience[0].organization}"`);
check("Experience role", aiInput.experience[0].role === "Software Engineer Intern", `got "${aiInput.experience[0].role}"`);
check("Experience responsibilities", aiInput.experience[0].responsibilities === "Built REST APIs for internal tooling", `got "${aiInput.experience[0].responsibilities}"`);
check("Experience achievements → keyAchievements", aiInput.experience[0].keyAchievements === "Improved API latency by 40%", `got "${aiInput.experience[0].keyAchievements}"`);
check("Experience skillsUsed → skillsLearned", aiInput.experience[0].skillsLearned === "Go, Kubernetes, gRPC", `got "${aiInput.experience[0].skillsLearned}"`);
check("Experience keyLearning", (aiInput.experience[0] as any).keyLearning === "Learned distributed systems design", `got "${(aiInput.experience[0] as any).keyLearning}"`);
check("Experience relevanceToMasters", (aiInput.experience[0] as any).relevanceToMasters === "Directly relevant to MS in distributed systems", `got "${(aiInput.experience[0] as any).relevanceToMasters}"`);

console.log("\n=== ACHIEVEMENTS / CERTIFICATIONS ===");
check("Achievements present", aiInput.achievements.length === 2, `got ${aiInput.achievements.length}`);
check("Award achievement", aiInput.achievements[0].title === "Best Project Award", `got "${aiInput.achievements[0].title}"`);
check("Certification as achievement", aiInput.achievements[1].type === "Certification" && aiInput.achievements[1].title === "AWS Certified Developer", `got type="${aiInput.achievements[1].type}" title="${aiInput.achievements[1].title}"`);
check("Certification in evidence", evidenceContains("AWS Certified Developer"), "certification not in evidence");

console.log("\n=== CAREER GOALS ===");
check("Short-term goal — desiredRole", aiInput.careerGoals.desiredRole === "Software Engineer at a FAANG company", `got "${aiInput.careerGoals.desiredRole}"`);
check("Short-term goal — industries", aiInput.careerGoals.industries === "Technology", `got "${aiInput.careerGoals.industries}"`);
check("Short-term goal — in shortTermGoals", aiInput.careerGoals.shortTermGoals.includes("Software Engineer"), `got "${aiInput.careerGoals.shortTermGoals}"`);
check("Long-term goal — in longTermGoals", aiInput.careerGoals.longTermGoals.includes("Lead engineering"), `got "${aiInput.careerGoals.longTermGoals}"`);
check("Long-term goal — returnPlans", aiInput.careerGoals.returnPlans === "Return to India to start a company", `got "${aiInput.careerGoals.returnPlans}"`);
check("Short-term and long-term separate in evidence", evidenceContains("Software Engineer") && evidenceContains("Lead engineering"), "short/long term not separately visible");

console.log("\n=== FIELD MOTIVATION / PERSONAL STORY ===");
check("Field motivation → personalStory.motivation", aiInput.personalStory.motivation === "I first became interested in CS when I built a website in high school.", `got "${aiInput.personalStory.motivation}"`);
check("Field motivation in evidence", evidenceContains("interested in CS"), "field motivation not in evidence");

console.log("\n=== LEGACY FALLBACK ===");
// Test legacy-only profile (no canonical keys)
const legacyProfile = {
  personalDetails: { firstName: "Legacy", lastName: "User", nationality: "American" },
  englishProficiency: { testType: "TOEFL", overallScore: "100" },
  education: [{ id: "e1", institution: "MIT", degree: "BS", level: "Bachelor's" }],
};
const adaptedLegacy = adaptProfile({ id: "s1", firstName: "Legacy", lastName: "User" }, legacyProfile as any);
const aiInputLegacy = buildAiInput(adaptedLegacy);
check("Legacy fallback — personalDetails → personalData", aiInputLegacy.personal.firstName === "Legacy", `got "${aiInputLegacy.personal.firstName}"`);
check("Legacy fallback — englishProficiency → englishTesting", aiInputLegacy.englishProficiency.testType === "TOEFL", `got "${aiInputLegacy.englishProficiency.testType}"`);
check("Legacy fallback — education passthrough", aiInputLegacy.education[0].institution === "MIT", `got "${aiInputLegacy.education[0].institution}"`);

// Test mixed profile — canonical takes precedence
const mixedProfile = {
  personalData: { firstName: "Canonical", lastName: "User" },
  personalDetails: { firstName: "Legacy", lastName: "ShouldNotWin" },
};
const adaptedMixed = adaptProfile({ id: "s2", firstName: "X", lastName: "Y" }, mixedProfile as any);
const aiInputMixed = buildAiInput(adaptedMixed);
check("Mixed — canonical wins", aiInputMixed.personal.firstName === "Canonical", `got "${aiInputMixed.personal.firstName}"`);

// Test empty profile
const adaptedEmpty = adaptProfile({ id: "s3", firstName: "Empty", lastName: "Profile" }, {} as any);
const aiInputEmpty = buildAiInput(adaptedEmpty);
check("Empty profile — no crash", aiInputEmpty.personal.firstName === "Empty", `got "${aiInputEmpty.personal.firstName}"`);

// ============================================================
// SPECIFIC PROJECT TEST (from requirement #10)
// ============================================================
console.log("\n=== SPECIFIC PROJECT TEST ===");
const specificProjectProfile = {
  projects: [
    {
      name: "Smart Attendance System",
      role: "Backend Developer",
      objective: "Reduce manual attendance recording",
      methods: "Designed REST APIs and database workflow",
      technologies: "Java, MySQL",
      outcome: "Working prototype",
    },
  ],
};
const adaptedSpecific = adaptProfile({ id: "s4" }, specificProjectProfile as any);
const aiInputSpecific = buildAiInput(adaptedSpecific);
const bundleSpecific = buildApplicationEvidenceBundle({ profile: adaptedSpecific, programContextText: "", facultyAlignment: [] });
const specificProj = aiInputSpecific.projects[0];
check("Specific — name", specificProj.name === "Smart Attendance System");
check("Specific — role → studentRole", specificProj.studentRole === "Backend Developer", `got "${specificProj.studentRole}"`);
check("Specific — objective", specificProj.objective === "Reduce manual attendance recording", `got "${specificProj.objective}"`);
check("Specific — methods", specificProj.methods === "Designed REST APIs and database workflow", `got "${specificProj.methods}"`);
check("Specific — technologies", specificProj.technologies === "Java, MySQL", `got "${specificProj.technologies}"`);
check("Specific — outcome", specificProj.outcome === "Working prototype", `got "${specificProj.outcome}"`);
check("Specific — all 6 in evidence", bundleSpecific.studentFactsText.includes("Smart Attendance System"), "project not in evidence text");

// ============================================================
// SKILLS TEST (from requirement #11)
// ============================================================
console.log("\n=== SKILLS TEST ===");
const skillsProfile = {
  skills: {
    technical: [], tools: [], software: [],
    programming: ["Java", "MySQL", "Flutter"],
    domain: [], soft: [],
  },
};
const adaptedSkills = adaptProfile({ id: "s5" }, skillsProfile as any);
const aiInputSkills = buildAiInput(adaptedSkills);
const bundleSkills = buildApplicationEvidenceBundle({ profile: adaptedSkills, programContextText: "", facultyAlignment: [] });
check("Skills — Java", aiInputSkills.skills.programming.includes("Java"));
check("Skills — MySQL", aiInputSkills.skills.programming.includes("MySQL"));
check("Skills — Flutter", aiInputSkills.skills.programming.includes("Flutter"));
check("Skills — no embellishment", !bundleSkills.studentFactsText.includes("advanced Java expertise"), "skills were embellished");

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log("GENERATION MAPPING: FAIL");
  process.exit(1);
} else {
  console.log("GENERATION MAPPING: PASS");
}
