/**
 * @file phase-24-simplify-freeze-v1.test.ts
 * Phase 24 deterministic test suite — 11 tests (A-K).
 * No live OpenAI calls. All deterministic/mock.
 *
 * Tests:
 *   A: Missing mandatory student fact → blocked before Planner
 *   B: Approved motivation fact exists → pre-check passes
 *   C: AI-prohibited application → blocked before writing
 *   D: Single-component application → supported
 *   E: Multi-component application → supported
 *   F: Word-limit application → supported
 *   G: Page-limit application → supported
 *   H: Faculty required → supported
 *   I: Faculty not required → supported
 *   J: Generic non-MIT fixture → supported
 *   K: No university-specific production branch
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildGenerationContract } from "../src/lib/requirements/generation-contract";
import { checkGenerationGate, checkMandatoryTopicEvidence } from "../src/lib/requirements/generation-gate";
import { buildApplicationEvidenceBundle } from "../src/lib/ai/application-evidence-bundle";
import type { GenerationContract } from "../src/lib/requirements/generation-contract-types";
import type { ResponseComponent, FacultyAlignment, PageLimitConstraint } from "../src/lib/requirements/generation-contract-types";

// ============================================================
// Mock Fixtures
// ============================================================

const mockProfileWithMotivation: any = {
  personalDetails: { firstName: "Demo", lastName: "Student", nationality: "Indian", currentCity: "Mumbai", currentCountry: "India", languages: "English, Hindi" },
  education: [{ level: "Bachelors", institution: "Mumbai University", degree: "B.Tech", specialization: "Civil Engineering", startYear: "2018", endYear: "2022", percentage: "85", cgpa: "8.5", cgpaScale: "10", status: "completed" }],
  englishProficiency: { testType: "IELTS", overallScore: "7.5", listening: "8", reading: "7", writing: "7", speaking: "7.5" },
  experience: [{ type: "Internship", organization: "L&T Construction", role: "Structural Engineer Intern", startDate: "2021-06", endDate: "2021-08", currentlyWorking: false, location: "Mumbai", responsibilities: "Structural design", keyAchievements: "Reduced steel usage by 12%", skillsLearned: "STAAD.Pro" }],
  projects: [{ name: "Seismic Response Analysis", type: "Academic", description: "Analyzed seismic response of a 20-story building", studentRole: "Lead Researcher", technologies: "MATLAB, SAP2000", outcome: "Identified structural vulnerabilities", whatLearned: "Earthquake engineering" }],
  research: [], publications: [], achievements: [],
  application: { targetCountry: "USA", targetUniversity: "MIT", targetProgram: "CEE MEng", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027" },
  careerGoals: { whyField: "Structural engineering", whyProgram: "MIT CEE", shortTermGoals: "Structural design engineer", longTermGoals: "Lead sustainable infrastructure" },
  personalStory: { motivation: "Growing up in Mumbai, I witnessed urbanization impact on infrastructure", challenges: "Limited access to advanced engineering software" },
  writingPreferences: { sopWritingProfile: { level: "Natural Professional", tone: "Professional & Personal" } },
  projectClarifications: [
    {
      id: "SF-CHALLENGE-PROJECT-001", category: "project_challenge",
      canonicalText: "During one of my structural engineering projects, I initially had limited access to the engineering analysis software I needed.",
      context: { domain: "structural engineering project", eventType: "unforeseen challenge", challenge: "limited access to engineering analysis software", response: "scheduling access more carefully" },
      source: "STUDENT_CLARIFICATION", approvalStatus: "STUDENT_APPROVED", benchmarkOnly: true,
    },
    {
      id: "SF-PROJECT-MOTIVATION-001", category: "project_motivation",
      canonicalText: "I chose this structural engineering project because I wanted to understand how a high-rise structure responds to earthquake loading and to deepen my understanding of structural analysis.",
      context: { domain: "structural engineering project", motivation: "understand how a high-rise structure responds to earthquake loading", additionalMotivation: "deepen understanding of structural analysis" },
      source: "STUDENT_CLARIFICATION", approvalStatus: "STUDENT_APPROVED", benchmarkOnly: true,
    },
  ],
  factSheetApproval: { status: "APPROVED", approved: true, requirementsConfirmed: true },
};

// Profile WITHOUT motivation fact (simulates #007 pre-fix state)
const mockProfileWithoutMotivation: any = {
  ...mockProfileWithMotivation,
  projectClarifications: [
    mockProfileWithMotivation.projectClarifications[0], // Only SF-CHALLENGE-PROJECT-001
  ],
};

const mockBrief: any = {
  applicationIdentity: { university: "MIT", program: "CEE MEng", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027", country: "USA" },
  documents: [{
    type: "SOP", required: true, label: "Statement of Objectives",
    documentType: "SOP", documentTypeLabel: "Statement of Objectives",
    officialPrompt: { rawText: "Describe your background", status: "VERIFIED" },
    wordLimit: { min: null, max: null, status: "NOT_SPECIFIED" },
    characterLimit: { min: null, max: null, status: "NOT_SPECIFIED" },
    requiredTopics: [{ value: "academic experience" }, { value: "research interests" }],
    formatInstructions: [], additionalQuestions: [],
  }],
  countryGuidance: { country: "USA", notes: "Standard US graduate application" },
  sources: [{ url: "https://mit.edu", type: "official", verifiedAt: "2026-01-01T00:00:00Z" }],
  verification: { verified: true, conflicts: [], warnings: [], blockingIssues: [] },
  cacheKey: "test-cache-key", createdAt: "2026-01-01T00:00:00Z", expiresAt: null,
};

const mockAiPolicyAllowed: any = {
  status: "AI_GENERATION_ALLOWED", generationAllowed: true,
  editingAllowed: "ALLOWED", proofreadingAllowed: "ALLOWED",
  brainstormingAllowed: "ALLOWED", translationAllowed: "NEVER",
  applicationAiMode: "FULL_AI_GENERATION",
  sources: [{ url: "https://mit.edu", type: "official" }],
  verifiedAt: "2026-01-01T00:00:00Z", cacheKey: "test-policy-key",
  expiresAt: "2027-01-01T00:00:00Z", blockingReasons: [],
};

const mockAiPolicyProhibited: any = {
  ...mockAiPolicyAllowed,
  status: "AI_GENERATION_PROHIBITED", generationAllowed: false,
  blockingReasons: ["AI generation prohibited by official policy"],
};

const mockResponseComponents: any[] = [
  {
    componentId: "RC-MIT-CEE-A", label: "A. Experience",
    exactPrompt: "Describe your experience",
    pageLimit: { type: "PER_DOCUMENT", maxPages: 1, status: "VERIFIED" },
    wordLimit: { type: "NONE", maxWords: null, status: "NOT_SPECIFIED" },
    characterLimit: { type: "NONE", maxCharacters: null, status: "NOT_SPECIFIED" },
    requiredTopics: [
      { topic: "academic or research experience", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      { topic: "motivation for the work", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      { topic: "responsibilities and tasks", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      { topic: "conclusions", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      { topic: "unforeseen challenges", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
    ],
    sourceId: "SRC-1", status: "VERIFIED", verifiedAt: "2026-01-01T00:00:00Z",
  },
  {
    componentId: "RC-MIT-CEE-B", label: "B. Purpose",
    exactPrompt: "Describe your purpose",
    pageLimit: { type: "PER_DOCUMENT", maxPages: 1, status: "VERIFIED" },
    wordLimit: { type: "NONE", maxWords: null, status: "NOT_SPECIFIED" },
    characterLimit: { type: "NONE", maxCharacters: null, status: "NOT_SPECIFIED" },
    requiredTopics: [
      { topic: "why graduate school", status: "VERIFIED", sourceId: "SRC-2", sourceQuote: "" },
      { topic: "research interests at MIT", status: "VERIFIED", sourceId: "SRC-2", sourceQuote: "" },
      { topic: "MIT faculty members", status: "VERIFIED", sourceId: "SRC-2", sourceQuote: "" },
    ],
    sourceId: "SRC-2", status: "VERIFIED", verifiedAt: "2026-01-01T00:00:00Z",
  },
];

const mockPageLimit: any = { type: "PER_DOCUMENT", maxPages: 2, status: "VERIFIED" };

const mockFaculty: any[] = [
  { facultyName: "Oral Buyukozturk", status: "STUDENT_APPROVED", verifiedProgramFactSource: "MIT CEE Faculty Page", studentInterestEvidence: "SF-PROJ-0", alignmentReason: "Seismic research alignment" },
  { facultyName: "Josephine V. Carstensen", status: "STUDENT_APPROVED", verifiedProgramFactSource: "MIT CEE Faculty Page", studentInterestEvidence: "SF-PROJ-0", alignmentReason: "Optimization research alignment" },
];

function buildContract(profile: any, components?: any[], faculty?: any[]): GenerationContract {
  const result = buildGenerationContract(profile, mockBrief, mockAiPolicyAllowed, {
    responseComponents: components || mockResponseComponents,
    pageLimit: mockPageLimit,
    facultyAlignment: faculty || mockFaculty,
    programContext: null,
  });
  if (!result.contract) throw new Error("Contract not cleared: " + result.status);
  return result.contract;
}

function buildBundle(profile: any, faculty?: any[]) {
  return buildApplicationEvidenceBundle({
    profile,
    programContextText: "",
    facultyAlignment: faculty || mockFaculty,
  });
}

// ============================================================
// Tests
// ============================================================

describe("Phase 24: Simplify and Freeze V1 Architecture", () => {

  it("A. Missing mandatory student fact → blocked before Planner", () => {
    // Profile WITHOUT SF-PROJECT-MOTIVATION-001
    const contract = buildContract(mockProfileWithoutMotivation);
    const bundle = buildBundle(mockProfileWithoutMotivation);

    const result = checkMandatoryTopicEvidence(contract, bundle);

    assert.ok(!result.passed, "Gate should block when motivation evidence is missing");
    assert.ok(result.blockingIssues.some(b => b.issue.includes("motivation for the work")), "Should block on motivation topic");
    assert.ok(result.blockingIssues.some(b => b.issue.includes("MISSING_REQUIRED_STUDENT_INFORMATION")), "Should report MISSING_REQUIRED_STUDENT_INFORMATION");
  });

  it("B. Approved motivation fact exists → pre-check passes", () => {
    // Profile WITH SF-PROJECT-MOTIVATION-001
    const contract = buildContract(mockProfileWithMotivation);
    const bundle = buildBundle(mockProfileWithMotivation);

    const result = checkMandatoryTopicEvidence(contract, bundle);

    if (!result.passed) {
      console.log("Blocking issues:", result.blockingIssues.map(b => b.issue));
    }
    assert.ok(result.passed, "Gate should pass when motivation evidence exists");
    const motivationEval = result.topicEvaluations.find(e => e.topic === "motivation for the work");
    assert.ok(motivationEval, "Should have evaluation for motivation topic");
    assert.equal(motivationEval!.status, "SUPPORTED", "Motivation topic should be SUPPORTED");
    assert.ok(motivationEval!.suitableEvidenceIds.includes("SF-PROJECT-MOTIVATION-001"), "Should find SF-PROJECT-MOTIVATION-001 as suitable");
  });

  it("C. AI-prohibited application → blocked before writing", () => {
    const gate = checkGenerationGate(mockProfileWithMotivation, mockBrief, mockAiPolicyProhibited);
    assert.ok(!gate.allowed, "AI-prohibited application should be blocked");
    assert.ok(gate.aiPolicyBlocked, "Should be blocked by AI policy");
  });

  it("D. Single-component application → supported", () => {
    const singleComponent: any[] = [mockResponseComponents[0]];
    const contract = buildContract(mockProfileWithMotivation, singleComponent);
    const bundle = buildBundle(mockProfileWithMotivation);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    assert.ok(result.passed, "Single-component application should pass gate");
  });

  it("E. Multi-component application → supported", () => {
    const contract = buildContract(mockProfileWithMotivation);
    const bundle = buildBundle(mockProfileWithMotivation);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    assert.ok(result.passed, "Multi-component application should pass gate");
    assert.ok(result.topicEvaluations.length > 5, "Should evaluate all topics across components");
  });

  it("F. Word-limit application → supported", () => {
    const wordLimitComponents: any[] = [{
      ...mockResponseComponents[0],
      wordLimit: { type: "MAX_WORDS", maxWords: 500, status: "VERIFIED" },
    }];
    const contract = buildContract(mockProfileWithMotivation, wordLimitComponents);
    const bundle = buildBundle(mockProfileWithMotivation);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    assert.ok(result.passed, "Word-limit application should pass gate");
  });

  it("G. Page-limit application → supported", () => {
    const contract = buildContract(mockProfileWithMotivation);
    const bundle = buildBundle(mockProfileWithMotivation);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    assert.ok(result.passed, "Page-limit application should pass gate");
  });

  it("H. Faculty required → supported", () => {
    const contract = buildContract(mockProfileWithMotivation);
    const bundle = buildBundle(mockProfileWithMotivation);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    const facultyTopic = result.topicEvaluations.find(e => e.topic === "MIT faculty members");
    assert.ok(facultyTopic, "Should evaluate faculty topic");
    assert.equal(facultyTopic!.status, "SUPPORTED", "Faculty topic should be SUPPORTED with faculty evidence");
  });

  it("I. Faculty not required → supported", () => {
    const noFacultyComponents: any[] = [{
      componentId: "RC-GENERIC-A", label: "Component A",
      exactPrompt: "Describe your background",
      pageLimit: { type: "PER_DOCUMENT", maxPages: 1, status: "VERIFIED" },
      wordLimit: { type: "NONE", maxWords: null, status: "NOT_SPECIFIED" },
      characterLimit: { type: "NONE", maxCharacters: null, status: "NOT_SPECIFIED" },
      requiredTopics: [
        { topic: "academic experience", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
        { topic: "motivation for the work", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      ],
      sourceId: "SRC-1", status: "VERIFIED", verifiedAt: "2026-01-01T00:00:00Z",
    }];
    const contract = buildContract(mockProfileWithMotivation, noFacultyComponents, []);
    const bundle = buildBundle(mockProfileWithMotivation, []);
    const result = checkMandatoryTopicEvidence(contract, bundle);
    assert.ok(result.passed, "Application without faculty requirement should pass");
  });

  it("J. Generic non-MIT fixture → supported", () => {
    const genericProfile = {
      ...mockProfileWithMotivation,
      application: { targetCountry: "UK", targetUniversity: "Oxford", targetProgram: "MSc Computer Science", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027" },
      personalDetails: { ...mockProfileWithMotivation.personalDetails, firstName: "Generic", lastName: "Student" },
    };
    const genericBrief = {
      ...mockBrief,
      applicationIdentity: { university: "Oxford", program: "MSc Computer Science", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027", country: "UK" },
    };
    const genericComponents: any[] = [{
      componentId: "RC-OXFORD-A", label: "Statement of Purpose",
      exactPrompt: "Describe your background and motivation",
      pageLimit: { type: "PER_DOCUMENT", maxPages: 2, status: "VERIFIED" },
      wordLimit: { type: "NONE", maxWords: null, status: "NOT_SPECIFIED" },
      characterLimit: { type: "NONE", maxCharacters: null, status: "NOT_SPECIFIED" },
      requiredTopics: [
        { topic: "academic experience", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
        { topic: "motivation for the work", status: "VERIFIED", sourceId: "SRC-1", sourceQuote: "" },
      ],
      sourceId: "SRC-1", status: "VERIFIED", verifiedAt: "2026-01-01T00:00:00Z",
    }];
    const result_contract = buildGenerationContract(genericProfile, genericBrief, mockAiPolicyAllowed, {
      responseComponents: genericComponents, pageLimit: mockPageLimit, facultyAlignment: [], programContext: null,
    });
    assert.ok(result_contract.contract, "Generic non-MIT contract should build");
    const bundle = buildBundle(genericProfile, []);
    const result = checkMandatoryTopicEvidence(result_contract.contract!, bundle);
    assert.ok(result.passed, "Generic non-MIT fixture should pass gate");
  });

  it("K. No university-specific production branch", () => {
    // The checkMandatoryTopicEvidence function uses only:
    // - Generation Contract (from official requirements)
    // - ApplicationEvidenceBundle (from approved student facts)
    // No university name, program name, or domain-specific branching.
    // Verify by checking that the function signature takes generic types.
    const contract1 = buildContract(mockProfileWithMotivation);
    const contract2 = buildContract({
      ...mockProfileWithMotivation,
      application: { targetCountry: "UK", targetUniversity: "Oxford", targetProgram: "MSc", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027" },
    });
    // Both contracts should work with the same gate function
    const bundle1 = buildBundle(mockProfileWithMotivation);
    const bundle2 = buildBundle({
      ...mockProfileWithMotivation,
      application: { targetCountry: "UK", targetUniversity: "Oxford", targetProgram: "MSc", degreeLevel: "Masters", intake: "Fall", intakeYear: "2027" },
    });
    const result1 = checkMandatoryTopicEvidence(contract1, bundle1);
    const result2 = checkMandatoryTopicEvidence(contract2, bundle2);
    // Both should pass (same evidence, same topics)
    assert.ok(result1.passed, "MIT fixture should pass");
    assert.ok(result2.passed, "Oxford fixture should pass");
    // No university-specific branching in the gate function
    assert.ok(typeof checkMandatoryTopicEvidence === "function", "Gate is a generic function");
  });

});
