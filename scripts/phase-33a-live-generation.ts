/**
 * @file phase-33a-live-generation.ts
 * @description
 * Phase SOP-AI-33A: Live document generation through the real product flow.
 * Uses synthetic BENCHMARK_ONLY data. No real student data.
 *
 * Flow:
 *   1. Create synthetic student via API
 *   2. Save profile with fact sheet approval via API
 *   3. Create application via API
 *   4. Create document (STATEMENT_OF_PURPOSE, CONSULTANT_PROVIDED) via API
 *   5. Pre-generation checks
 *   6. Execute live generation via API
 *   7. Verify fact safety, version persistence
 *   8. Query DB directly to verify
 */

import { randomUUID } from "crypto";

// ============================================================
// CONFIGURATION
// ============================================================
const SOP_API = "http://localhost:5010";

// Synthetic benchmark data — BENCHMARK_ONLY, FICTIONAL
const BENCHMARK_STUDENT = {
  firstName: "Benchmark",
  lastName: "Student33A",
  email: `benchmark-33a-${Date.now()}@dvivid.test`,
  phone: "+91-9876543210",
  country: "India",
};

const BENCHMARK_PROFILE = {
  personalData: {
    firstName: "Benchmark",
    middleName: "",
    lastName: "Student33A",
    dateOfBirth: "2001-05-15",
    gender: "Female",
    nationality: "Indian",
    currentCity: "Bangalore",
    currentCountry: "India",
    languages: "English, Hindi, Kannada",
  },
  education: [{
    id: "edu1",
    level: "Bachelor",
    institution: "Bangalore Institute of Technology",
    degree: "B.Tech",
    specialization: "Computer Science and Engineering",
    startYear: "2019",
    endYear: "2023",
    percentage: "",
    cgpa: "8.7",
    cgpaScale: "10",
    status: "Completed",
  }],
  englishTesting: {
    testType: "IELTS",
    status: "Completed",
    overallScore: "7.5",
    listening: "8.0",
    reading: "7.5",
    writing: "7.0",
    speaking: "7.5",
  },
  experience: [{
    id: "exp1",
    type: "Internship",
    organization: "TechSolutions Pvt Ltd",
    role: "Software Engineering Intern",
    startDate: "2022-06",
    endDate: "2022-08",
    currentlyWorking: false,
    location: "Bangalore, India",
    responsibilities: "Developed REST APIs using Node.js and Express. Worked on database optimization and query performance.",
    keyAchievements: "Reduced API response time by 30% through query optimization and caching.",
    skillsLearned: "Node.js, Express, MongoDB, REST API design, Database optimization",
  }],
  projects: [{
    id: "proj1",
    name: "Smart Campus Navigation System",
    type: "Academic Project",
    description: "Built a navigation system for the college campus using React and Mapbox. Integrated real-time location tracking and route optimization.",
    studentRole: "Lead Developer",
    technologies: "React, Mapbox, Node.js, MongoDB",
    outcome: "Deployed successfully and used by 500+ students daily.",
    whatLearned: "Full-stack development, real-time data handling, UI/UX design",
  }],
  careerGoals: {
    whyField: "I want to specialize in artificial intelligence and machine learning to build intelligent systems that solve real-world problems.",
    whyProgram: "This program offers excellent coursework in AI/ML with opportunities for hands-on research.",
    shortTermGoals: "Work as a machine learning engineer after graduation.",
    longTermGoals: "Lead AI research and development at a technology company.",
    desiredRole: "Machine Learning Engineer",
    industries: "Technology, AI/ML",
    returnHomeCountry: "Yes",
    returnPlans: "Return to India to contribute to the growing AI industry.",
  },
  personalStory: {
    motivation: "My interest in AI began during my undergraduate studies when I worked on a campus navigation project that used machine learning for route optimization.",
    influencingExperience: "My internship at TechSolutions exposed me to real-world software engineering and sparked my interest in pursuing advanced studies.",
    challenges: "Balancing academic coursework with my project work taught me time management and perseverance.",
    proudOf: "Leading the campus navigation project from concept to deployment.",
    qualities: "Analytical thinking, perseverance, collaborative",
    leadershipExample: "Led a team of 4 students in the campus navigation project.",
    teamworkExample: "Collaborated with designers and developers during my internship.",
    outsideAcademics: "Member of the college coding club. Participated in hackathons.",
    communityService: "Volunteered at a local school teaching basic programming.",
    familyBackground: "My parents are both educators who encouraged my interest in technology.",
  },
  writingPreferences: {
    level: "Natural Professional",
    tone: "Professional & Personal",
    personalization: "Balanced",
    technicalDetail: "Medium",
    openingStyle: "Let AI Choose Best Opening",
    sopLength: "900-1100",
  },
  factSheetApproval: {
    approved: true,
    approvedAt: new Date().toISOString(),
  },
};

const BENCHMARK_APPLICATION = {
  universityName: "Test State University",
  programName: "MS Computer Science",
  degree: "Master of Science",
  country: "USA",
  intake: "Fall",
  intakeYear: "2027",
};

const BENCHMARK_DOCUMENT = {
  documentType: "STATEMENT_OF_PURPOSE",
  documentTitle: "Statement of Purpose",
  promptText: "Describe your academic background, research interests, and career goals. Explain why you are applying to this program and how it aligns with your future plans.",
  promptSource: "CONSULTANT_PROVIDED",
  wordMin: 800,
  wordMax: 1000,
};

// ============================================================
// HELPERS
// ============================================================
async function apiCall(method: string, path: string, body?: any) {
  const url = `${SOP_API}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

function log(section: string, message: string) {
  console.log(`[${section}] ${message}`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("=== Phase 33A Live Generation (Synthetic Data) ===\n");
  console.log("BENCHMARK_ONLY: YES");
  console.log("FICTIONAL: YES\n");

  // ===== STEP 1: Create student + application + document =====
  log("STEP 1", "Creating synthetic benchmark student + application + document...");
  const saveRes = await apiCall("POST", "/api/application/save", {
    student: {
      firstName: BENCHMARK_STUDENT.firstName,
      lastName: BENCHMARK_STUDENT.lastName,
      email: BENCHMARK_STUDENT.email,
      phone: BENCHMARK_STUDENT.phone,
      country: BENCHMARK_STUDENT.country,
    },
    application: BENCHMARK_APPLICATION,
    document: BENCHMARK_DOCUMENT,
  });

  if (saveRes.status !== 200) {
    console.error("Failed to create student/application/document:", saveRes.data);
    process.exit(1);
  }
  const studentId = saveRes.data.studentId;
  const applicationId = saveRes.data.applicationId;
  const documentId = saveRes.data.documentId;
  log("STEP 1", `Student created: ${studentId}`);
  log("STEP 1", `Application created: ${applicationId}`);
  log("STEP 1", `Document created: ${documentId}`);

  // ===== STEP 2: Save profile with fact sheet approval =====
  log("STEP 2", "Saving profile with fact sheet approval...");
  const profileRes = await apiCall("PUT", "/api/application/profile", {
    studentId,
    profileData: BENCHMARK_PROFILE,
  });

  if (profileRes.status !== 200) {
    console.error("Failed to save profile:", profileRes.data);
    process.exit(1);
  }
  log("STEP 2", "Profile saved with fact sheet approved");

  // ===== STEP 3: Pre-generation checks =====
  log("STEP 3", "Running pre-generation checks...");
  const profileCheck = await apiCall("GET", `/api/application/profile?studentId=${studentId}`);
  if (profileCheck.status !== 200) {
    console.error("Pre-gen check failed: profile not found");
    process.exit(1);
  }
  const profileData = profileCheck.data.profile;
  const factApproved = profileData?.factSheetApproval?.approved === true;
  log("STEP 3", `Student ID valid: ${!!studentId}`);
  log("STEP 3", `Application ID valid: ${!!applicationId}`);
  log("STEP 3", `Document ID valid: ${!!documentId}`);
  log("STEP 3", `Profile server-backed: ${profileCheck.data.hasServerProfile}`);
  log("STEP 3", `Fact Sheet approved: ${factApproved}`);
  log("STEP 3", `Prompt resolved: ${BENCHMARK_DOCUMENT.promptText.substring(0, 50)}...`);
  log("STEP 3", `Document type: STATEMENT_OF_PURPOSE`);
  log("STEP 3", `Generation status: ${saveRes.data.document.generationStatus}`);

  if (!factApproved) {
    console.error("Pre-gen check FAILED: fact sheet not approved");
    process.exit(1);
  }
  log("STEP 3", "All pre-generation checks PASSED");

  // ===== STEP 4: Execute live generation =====
  log("STEP 4", "Executing live AI generation through product flow...");
  log("STEP 4", "This will make real OpenAI API calls. Please wait...");

  const genStart = Date.now();
  const genRes = await apiCall("POST", "/api/application/document/generate", {
    studentId,
    applicationId,
    documentId,
  });
  const genDuration = ((Date.now() - genStart) / 1000).toFixed(1);

  log("STEP 4", `Generation completed in ${genDuration}s with status ${genRes.status}`);

  if (genRes.status !== 200) {
    console.error("Generation FAILED:", JSON.stringify(genRes.data, null, 2));
    process.exit(1);
  }

  const result = genRes.data;
  log("STEP 4", `Status: ${result.status}`);
  log("STEP 4", `Generation ID: ${result.generationId}`);
  log("STEP 4", `Document type: ${result.documentType}`);
  log("STEP 4", `Version number: ${result.version.versionNumber}`);
  log("STEP 4", `Word count: ${result.version.wordCount}`);
  log("STEP 4", `Model: ${result.version.model}`);
  log("STEP 4", `Stages: ${result.pipeline.stages}`);
  log("STEP 4", `Duration: ${result.pipeline.duration}s`);
  log("STEP 4", `Prompt source: ${result.promptResolution.source}`);
  log("STEP 4", `Prompt path: ${result.promptResolution.path}`);
  log("STEP 4", `Merged with default: ${result.promptResolution.mergedWithDefault}`);

  // ===== STEP 5: Fact safety verification =====
  log("STEP 5", "Verifying fact safety...");
  const factReview = result.version.factReview;
  if (factReview) {
    log("STEP 5", `Total invented facts: ${factReview.totalInventedFacts || 0}`);
    log("STEP 5", `Total altered facts: ${factReview.totalAlteredFacts || 0}`);
    log("STEP 5", `Total interpretive elaborations: ${factReview.totalInterpretiveElaborations || 0}`);
    log("STEP 5", `Total ambiguous claims: ${factReview.totalAmbiguousClaims || 0}`);
    log("STEP 5", `Overall pass: ${factReview.overallPass}`);
  } else {
    log("STEP 5", "No fact review data available");
  }

  // ===== STEP 6: Cost verification =====
  log("STEP 6", "Cost analysis...");
  if (result.pipeline.cost) {
    log("STEP 6", `Input tokens: ${result.pipeline.cost.inputTokens}`);
    log("STEP 6", `Cached tokens: ${result.pipeline.cost.cachedInputTokens}`);
    log("STEP 6", `Output tokens: ${result.pipeline.cost.outputTokens}`);
    log("STEP 6", `Total tokens: ${result.pipeline.cost.totalTokens}`);
    log("STEP 6", `Cost USD: $${result.pipeline.cost.estimatedUsd}`);
    log("STEP 6", `Cost INR: ₹${result.pipeline.cost.estimatedInr}`);
  }
  log("STEP 6", `Version cost USD: $${result.version.costUsd}`);
  log("STEP 6", `Version cost INR: ₹${result.version.costInr}`);

  // ===== STEP 7: Version persistence verification =====
  log("STEP 7", "Verifying version persistence...");
  const versionRes = await apiCall("GET", `/api/application/version?documentId=${documentId}`);
  if (versionRes.status !== 200) {
    console.error("Failed to load versions:", versionRes.data);
    process.exit(1);
  }
  const versions = versionRes.data.versions;
  log("STEP 7", `Version count: ${versions.length}`);
  if (versions.length > 0) {
    const v1 = versions[0];
    log("STEP 7", `Version 1 number: ${v1.versionNumber}`);
    log("STEP 7", `Version 1 created by: ${v1.createdByType}`);
    log("STEP 7", `Version 1 model: ${v1.model}`);
    log("STEP 7", `Version 1 generation ID: ${v1.generationId}`);
    log("STEP 7", `Version 1 cost USD: ${v1.costUsd}`);
    log("STEP 7", `Version 1 cost INR: ${v1.costInr}`);
    log("STEP 7", `Version 1 content length: ${v1.content.length} chars`);
    log("STEP 7", `Version 1 content preview: ${v1.content.substring(0, 200)}...`);
  }

  // ===== STEP 8: Document reload verification =====
  log("STEP 8", "Verifying document reload...");
  const docReload = await apiCall("GET", `/api/application/document?id=${documentId}&studentId=${studentId}`);
  if (docReload.status !== 200) {
    console.error("Failed to reload document:", docReload.data);
    process.exit(1);
  }
  log("STEP 8", `Document generation status: ${docReload.data.document.generationStatus}`);

  // ===== SUMMARY =====
  console.log("\n=== LIVE GENERATION SUMMARY ===");
  console.log(`Student ID: ${studentId}`);
  console.log(`Application ID: ${applicationId}`);
  console.log(`Document ID: ${documentId}`);
  console.log(`Document type: STATEMENT_OF_PURPOSE`);
  console.log(`Prompt source: ${result.promptResolution.source}`);
  console.log(`Prompt path: ${result.promptResolution.path}`);
  console.log(`Generation ID: ${result.generationId}`);
  console.log(`Six stages executed: ${result.pipeline.stages === 6 ? "YES" : "NO"}`);
  console.log(`Final Fact Review pass: ${factReview?.overallPass ? "YES" : "NO"}`);
  console.log(`Material invented facts: ${factReview?.totalInventedFacts || 0}`);
  console.log(`Material altered facts: ${factReview?.totalAlteredFacts || 0}`);
  console.log(`Version 1 saved: ${versions.length >= 1 && versions[0].versionNumber === 1 ? "YES" : "NO"}`);
  console.log(`Version 1 reload persistence: ${docReload.data.document.generationStatus === "GENERATED" ? "YES" : "NO"}`);
  console.log(`Input tokens: ${result.pipeline.cost?.inputTokens || "N/A"}`);
  console.log(`Cached tokens: ${result.pipeline.cost?.cachedInputTokens || "N/A"}`);
  console.log(`Output tokens: ${result.pipeline.cost?.outputTokens || "N/A"}`);
  console.log(`Cost USD: $${result.version.costUsd || "N/A"}`);
  console.log(`Cost INR: ₹${result.version.costInr || "N/A"}`);
  console.log(`Duration: ${genDuration}s`);
  console.log(`Word count: ${result.version.wordCount}`);

  // Output IDs for DB verification
  console.log("\n=== DB VERIFICATION IDS ===");
  console.log(`studentId=${studentId}`);
  console.log(`applicationId=${applicationId}`);
  console.log(`documentId=${documentId}`);
}

main().catch(err => {
  console.error("Live generation error:", err);
  process.exit(1);
});
