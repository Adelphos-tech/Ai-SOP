import { promises as fs } from "fs";
import path from "path";
import { buildGenerationContract, validateContractForWriting } from "../src/lib/requirements/generation-contract";
import { computePlannerRelevance } from "../src/lib/requirements/planner-relevance";
import { ResponseComponent, FacultyAlignment, PageLimitConstraint } from "../src/lib/requirements/generation-contract-types";

async function loadJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function main() {
  console.log("===== MIT CEE MEng — Generation Contract Dry Run (SOP-AI-4) =====\n");

  const baseDir = path.join(__dirname, "..", "logs", "requirements", "ai-permitted-live-test");

  // Load artifacts
  const brief = await loadJson(path.join(baseDir, "verified-application-brief.json"));
  const aiPolicy = await loadJson(path.join(baseDir, "ai-usage-policy.json"));
  const responseComponentsData = await loadJson(path.join(baseDir, "response-components.json"));

  // Build response components
  const responseComponents: ResponseComponent[] = responseComponentsData.responseComponents;

  // Build page limit
  const pageLimit: PageLimitConstraint = responseComponentsData.totalPageLimit;

  // Fictional demo student profile (same as SOP-REQ-4)
  const profile = {
    factSheetApproval: { approved: true, requirementsConfirmed: true },
    personalDetails: {
      firstName: "Demo", lastName: "Student", nationality: "Indian",
      currentCity: "Mumbai", currentCountry: "India", languages: "English, Hindi"
    },
    education: [{
      level: "Bachelor's", institution: "IIT Bombay", degree: "BTech",
      specialization: "Civil Engineering", startYear: "2019", endYear: "2023",
      percentage: "85", cgpa: "8.5", cgpaScale: "10", status: "Completed"
    }],
    experience: [{
      type: "Internship", organization: "L&T Construction", role: "Structural Engineering Intern",
      startDate: "2022-05", endDate: "2022-08", currentlyWorking: false, location: "Mumbai",
      responsibilities: "Designed structural elements for a commercial building project using finite element analysis.",
      keyAchievements: "Optimized steel usage by 12% through improved structural modeling.",
      skillsLearned: "STAAD.Pro, AutoCAD, structural analysis, finite element methods"
    }],
    projects: [{
      name: "Seismic Response Analysis of High-Rise Buildings", type: "Academic",
      description: "Analyzed seismic response of a 20-story reinforced concrete building using response spectrum analysis.",
      studentRole: "Lead Researcher", technologies: "MATLAB, SAP2000",
      outcome: "Identified critical structural vulnerabilities and proposed retrofitting solutions.",
      whatLearned: "Earthquake engineering, structural dynamics, response spectrum analysis"
    }],
    research: [], publications: [],
    achievements: [{
      type: "Academic", title: "Best Undergraduate Thesis Award",
      description: "Awarded for thesis on structural optimization techniques.", year: "2023"
    }],
    careerGoals: {
      whyField: "I am passionate about structural engineering and sustainable infrastructure design.",
      whyProgram: "MIT CEE's MEng program offers the perfect blend of advanced coursework and real-world engineering projects.",
      shortTermGoals: "Work as a structural design engineer at a leading engineering firm.",
      longTermGoals: "Lead sustainable infrastructure projects in developing countries.",
      desiredRole: "Senior Structural Engineer", industries: "Construction, Infrastructure",
      returnHomeCountry: "Yes", returnPlans: "Apply sustainable engineering practices in India's infrastructure development."
    },
    personalStory: {
      motivation: "Growing up in Mumbai, I witnessed the impact of rapid urbanization on infrastructure quality.",
      influencingExperience: "My internship at L&T exposed me to large-scale structural engineering challenges.",
      challenges: "Limited access to advanced engineering software during undergraduate studies.",
      proudOf: "Winning the Best Undergraduate Thesis Award for my work on structural optimization.",
      qualities: "Analytical, detail-oriented, passionate about sustainable design.",
      leadershipExample: "Led a team of 4 students in our final-year structural design project.",
      teamworkExample: "Collaborated with architects and contractors during my internship.",
      outsideAcademics: "Volunteer with Habitat for Humanity building homes.",
      communityService: "Teaching math to underprivileged students.",
      familyBackground: "Family of engineers; father is a civil engineer."
    },
    englishProficiency: {
      testType: "IELTS", status: "Completed", overallScore: "7.5",
      listening: "8", reading: "7.5", writing: "7", speaking: "7.5"
    },
    writingPreferences: {
      sopWritingProfile: {
        level: "Natural Professional", tone: "Professional & Personal",
        personalization: "Balanced", technicalDetail: "Medium",
        openingStyle: "Let AI Choose Best Opening", sopLength: "900-1100"
      }
    }
  };

  // ===== DRY RUN 1: No faculty alignment (should BLOCK) =====
  console.log("--- DRY RUN 1: No faculty alignment (expect BLOCK) ---");
  const result1 = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents,
    pageLimit,
    facultyAlignment: [],
    programContext: null,
  });

  console.log(`Status: ${result1.status}`);
  console.log(`Cleared for Writing: ${result1.contract?.clearedForWriting ?? "N/A"}`);
  console.log(`Blocking Reasons: ${result1.blockingReasons.length}`);
  result1.blockingReasons.forEach(r => console.log(`  - ${r}`));
  if (result1.missingRequiredInformation.length > 0) {
    console.log(`Missing Required Information:`);
    result1.missingRequiredInformation.forEach(m => {
      console.log(`  - Topic: ${m.requiredTopic}`);
      console.log(`    Reason: ${m.reason}`);
      console.log(`    Missing Fields: ${m.studentEvidenceFields.join(", ")}`);
    });
  }

  // ===== DRY RUN 2: With PROPOSED faculty alignment (should BLOCK) =====
  console.log("\n--- DRY RUN 2: PROPOSED faculty alignment (expect BLOCK) ---");
  const proposedFaculty: FacultyAlignment[] = [{
    facultyName: "Prof. Oral Buyukozturk",
    verifiedProgramFactSource: "SRC-MIT-CEE-FAC-001",
    studentInterestEvidence: ["career-goals"],
    alignmentReason: "Student's interest in structural engineering aligns with professor's research.",
    status: "PROPOSED"
  }];

  const result2 = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents,
    pageLimit,
    facultyAlignment: proposedFaculty,
    programContext: null,
  });

  console.log(`Status: ${result2.status}`);
  console.log(`Cleared for Writing: ${result2.contract?.clearedForWriting ?? "N/A"}`);
  console.log(`Blocking Reasons: ${result2.blockingReasons.length}`);
  result2.blockingReasons.forEach(r => console.log(`  - ${r}`));

  // ===== DRY RUN 3: With STUDENT_APPROVED faculty alignment (should PASS) =====
  console.log("\n--- DRY RUN 3: STUDENT_APPROVED faculty alignment (expect PASS) ---");
  const approvedFaculty: FacultyAlignment[] = [{
    facultyName: "Prof. Oral Buyukozturk",
    verifiedProgramFactSource: "SRC-MIT-CEE-FAC-001",
    studentInterestEvidence: ["career-goals", "project-0"],
    alignmentReason: "Student's interest in structural engineering and seismic analysis aligns with professor's research on structural health monitoring and nondestructive evaluation.",
    status: "STUDENT_APPROVED"
  }];

  const result3 = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents,
    pageLimit,
    facultyAlignment: approvedFaculty,
    programContext: null,
  });

  console.log(`Status: ${result3.status}`);
  console.log(`Cleared for Writing: ${result3.contract?.clearedForWriting ?? "N/A"}`);
  console.log(`Blocking Reasons: ${result3.blockingReasons.length}`);

  if (result3.contract) {
    console.log(`\nContract Details:`);
    console.log(`  Contract ID: ${result3.contract.contractId}`);
    console.log(`  Response Components: ${result3.contract.responseComponents.length}`);
    console.log(`  Page Limit: ${JSON.stringify(result3.contract.pageLimit)}`);
    console.log(`  Faculty Alignment: ${result3.contract.facultyAlignment.length}`);
    result3.contract.facultyAlignment.forEach(fa => {
      console.log(`    - ${fa.facultyName} (${fa.status})`);
    });

    console.log(`\nResponse Components:`);
    result3.contract.responseComponents.forEach(rc => {
      console.log(`  ${rc.componentId}: ${rc.label}`);
      console.log(`    Page Limit: ${JSON.stringify(rc.pageLimit)}`);
      console.log(`    Required Topics: ${rc.requiredTopics.length}`);
      rc.requiredTopics.forEach(t => {
        const flag = t.requiresStudentSpecificFact ? " [STUDENT-SPECIFIC]" : "";
        console.log(`      - ${t.topic}${flag}`);
      });
    });

    const validation = validateContractForWriting(result3.contract);
    console.log(`\nContract Validation: ${validation.valid ? "PASS" : "FAIL"}`);
    if (validation.reason) console.log(`  Reason: ${validation.reason}`);
  }

  // ===== SUMMARY =====
  console.log("\n===== DRY RUN SUMMARY =====");
  console.log(`Run 1 (no faculty): ${result1.status === "MISSING_REQUIRED_STUDENT_INFORMATION" ? "PASS (correctly blocked)" : "FAIL"}`);
  console.log(`Run 2 (proposed): ${result2.status === "MISSING_REQUIRED_STUDENT_INFORMATION" ? "PASS (correctly blocked)" : "FAIL"}`);
  console.log(`Run 3 (approved): ${result3.status === "CLEARED" ? "PASS (correctly cleared)" : "FAIL"}`);
  console.log(`OpenAI Writing Calls: 0`);

  const allPass = result1.status === "MISSING_REQUIRED_STUDENT_INFORMATION"
    && result2.status === "MISSING_REQUIRED_STUDENT_INFORMATION"
    && result3.status === "CLEARED";
  process.exit(allPass ? 0 : 1);
}

main().catch(console.error);
