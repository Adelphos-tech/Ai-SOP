import { promises as fs } from "fs";
import path from "path";
import {
  AiPolicySource,
  AiUsagePolicy,
} from "../src/lib/requirements/ai-policy-types";
import {
  buildAiUsagePolicy,
  computeGenerationEligibility,
  detectAiPolicyFromText,
} from "../src/lib/requirements/ai-policy-verifier";
import { checkGenerationGate } from "../src/lib/requirements/generation-gate";

interface FixtureResult {
  fixtureId: string;
  description: string;
  pass: boolean;
  details: string;
}

async function loadFixture(fixtureFile: string): Promise<any> {
  const content = await fs.readFile(path.join(__dirname, "fixtures", "ai-policy", fixtureFile), "utf-8");
  return JSON.parse(content);
}

async function runFixture(fixtureFile: string): Promise<FixtureResult> {
  const fixture = await loadFixture(fixtureFile);
  const identity = fixture.identity;
  const policySources = fixture.policySources as AiPolicySource[];
  const expected = fixture.expected;

  try {
    // Build AI usage policy from sources
    const aiPolicy = buildAiUsagePolicy(policySources, identity);

    // Compute generation eligibility (requirements assumed verified for this test)
    const eligibility = computeGenerationEligibility(true, aiPolicy);

    // Check generation gate
    const gateResult = checkGenerationGate(
      { factSheetApproval: { approved: true, requirementsConfirmed: true } },
      {
        applicationIdentity: identity,
        documents: [],
        countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
        sources: [{ sourceId: "test", priority: "PRIMARY", status: "ACTIVE" } as any],
        verification: { status: "VERIFIED", verifiedAt: new Date().toISOString(), conflicts: [], blockingIssues: [] },
        cacheKey: "test",
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
      aiPolicy
    );

    let pass = true;
    const details: string[] = [];

    // Check status
    if (aiPolicy.status !== expected.status) {
      pass = false;
      details.push(`Status: ${aiPolicy.status} (expected: ${expected.status})`);
    } else {
      details.push(`Status: ${aiPolicy.status}`);
    }

    // Check generationAllowed
    if (aiPolicy.generationAllowed !== expected.generationAllowed) {
      pass = false;
      details.push(`GenerationAllowed: ${aiPolicy.generationAllowed} (expected: ${expected.generationAllowed})`);
    } else {
      details.push(`GenerationAllowed: ${aiPolicy.generationAllowed}`);
    }

    // Check applicationAiMode
    if (aiPolicy.applicationAiMode !== expected.applicationAiMode) {
      pass = false;
      details.push(`Mode: ${aiPolicy.applicationAiMode} (expected: ${expected.applicationAiMode})`);
    } else {
      details.push(`Mode: ${aiPolicy.applicationAiMode}`);
    }

    // Check finalGenerationEligible
    if (eligibility.finalGenerationEligible !== expected.finalGenerationEligible) {
      pass = false;
      details.push(`FinalEligible: ${eligibility.finalGenerationEligible} (expected: ${expected.finalGenerationEligible})`);
    } else {
      details.push(`FinalEligible: ${eligibility.finalGenerationEligible}`);
    }

    // Check blocking reasons count
    if (aiPolicy.blockingReasons.length !== expected.blockingReasonCount) {
      pass = false;
      details.push(`BlockingReasons: ${aiPolicy.blockingReasons.length} (expected: ${expected.blockingReasonCount})`);
    } else {
      details.push(`BlockingReasons: ${aiPolicy.blockingReasons.length}`);
    }

    // Check gate allowed
    if (gateResult.allowed !== expected.finalGenerationEligible) {
      pass = false;
      details.push(`Gate: ${gateResult.allowed ? "ALLOWED" : "BLOCKED"} (expected: ${expected.finalGenerationEligible ? "ALLOWED" : "BLOCKED"})`);
    } else {
      details.push(`Gate: ${gateResult.allowed ? "ALLOWED" : "BLOCKED"}`);
    }

    // Check aiPolicyBlocked
    if (expected.finalGenerationEligible === false) {
      if (!gateResult.aiPolicyBlocked && expected.status !== "AI_GENERATION_ALLOWED") {
        // For blocked tests, aiPolicyBlocked should be true if the AI policy is the blocker
        // But for fixture D (policy not found), the policy itself blocks
        if (expected.status !== "AI_GENERATION_ALLOWED") {
          if (!gateResult.aiPolicyBlocked) {
            pass = false;
            details.push(`aiPolicyBlocked: false (expected: true)`);
          } else {
            details.push(`aiPolicyBlocked: true`);
          }
        }
      } else {
        details.push(`aiPolicyBlocked: ${gateResult.aiPolicyBlocked}`);
      }
    } else {
      details.push(`aiPolicyBlocked: ${gateResult.aiPolicyBlocked}`);
    }

    return {
      fixtureId: fixture.fixtureId,
      description: fixture.description,
      pass,
      details: details.join("; "),
    };
  } catch (error: any) {
    return {
      fixtureId: fixture.fixtureId,
      description: fixture.description,
      pass: false,
      details: `ERROR: ${error?.message}`,
    };
  }
}

async function main() {
  const fixtures = [
    "fixture-a-generation-prohibited.json",
    "fixture-b-generation-allowed.json",
    "fixture-c-limited-assistance.json",
    "fixture-d-policy-not-found.json",
    "fixture-e-ambiguous.json",
    "fixture-f-conflicting.json",
    "fixture-g-program-override.json",
  ];

  console.log("===== AI POLICY TEST FIXTURES =====\n");

  let passCount = 0;
  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);
    if (result.pass) passCount++;
    console.log(`[${result.pass ? "PASS" : "FAIL"}] ${result.fixtureId}: ${result.description}`);
    console.log(`  ${result.details}`);
    console.log();
  }

  console.log(`===== FIXTURE SUMMARY: ${passCount}/${fixtures.length} PASS =====`);

  // Test detector directly
  console.log("\n===== POLICY DETECTOR TESTS =====\n");

  const detectorTests = [
    { text: "Work may not be that of a third party nor that created by generative artificial intelligence.", expect: "AI_GENERATION_PROHIBITED" },
    { text: "AI-generated content is not permitted in application materials.", expect: "AI_GENERATION_PROHIBITED" },
    { text: "Applicants may use AI tools to assist with writing. AI-generated content is permitted.", expect: "AI_GENERATION_ALLOWED" },
    { text: "Applicants may use AI for proofreading and grammar checking only.", expect: "AI_ASSISTANCE_RESTRICTED" },
    { text: "Welcome to our admissions page. Please submit your materials online.", expect: "AI_POLICY_NOT_FOUND" },
    { text: "Applicants should be aware of AI technology.", expect: "AI_POLICY_NOT_FOUND" },
    { text: "", expect: "AI_POLICY_NOT_FOUND" },
  ];

  let detectorPass = 0;
  for (const test of detectorTests) {
    const result = detectAiPolicyFromText(test.text);
    const pass = result === test.expect;
    if (pass) detectorPass++;
    console.log(`[${pass ? "PASS" : "FAIL"}] "${test.text.substring(0, 60)}..." → ${result} (expected: ${test.expect})`);
  }

  console.log(`\n===== DETECTOR SUMMARY: ${detectorPass}/${detectorTests.length} PASS =====`);

  // Test Harvard case
  console.log("\n===== HARVARD LIVE TEST =====\n");

  const harvardPolicy: AiPolicySource = {
    sourceId: "AIPOL-HDS-001",
    title: "Applying to Degree Programs — GSAS",
    url: "https://gsas.harvard.edu/apply/applying-degree-programs",
    officialDomain: "gsas.harvard.edu",
    domainVerified: true,
    sourceType: "OFFICIAL_APPLICATION_INSTRUCTIONS",
    exactPolicyText: "Your written parts of this application, including but not limited to the statement of purpose, supplemental data, additional materials (if applicable), short answers, and personal statement (if applicable), resume/CV and employment history are expected to be your own work. Work may not be that of a third party nor that created by generative artificial intelligence. Use of these sources to develop your work, as opposed to assisting your application to suggest minor edits or to identify grammatical errors, is forbidden.",
    retrievedAt: "2026-09-09T17:25:00Z",
    applicableScope: "All GSAS programs including SEAS",
    priority: "PRIMARY",
    httpStatus: 200,
  };

  const harvardIdentity = {
    country: "USA",
    university: "Harvard University",
    program: "Data Science",
    degreeLevel: "Master's",
    intake: "Fall",
    intakeYear: "2027",
  };

  const harvardAiPolicy = buildAiUsagePolicy([harvardPolicy], harvardIdentity);
  const harvardEligibility = computeGenerationEligibility(true, harvardAiPolicy);

  console.log(`Harvard AI Policy Status: ${harvardAiPolicy.status}`);
  console.log(`Harvard Generation Allowed: ${harvardAiPolicy.generationAllowed}`);
  console.log(`Harvard Application AI Mode: ${harvardAiPolicy.applicationAiMode}`);
  console.log(`Harvard Requirements Eligible: ${harvardEligibility.requirementsEligible}`);
  console.log(`Harvard Final Generation Eligible: ${harvardEligibility.finalGenerationEligible}`);
  console.log(`Harvard Blocking Reasons: ${harvardEligibility.blockingReasons.length}`);
  if (harvardEligibility.blockingReasons.length > 0) {
    console.log(`  Reason: ${harvardEligibility.blockingReasons[0]}`);
  }
  console.log(`Harvard Generation Blocked By Policy: ${harvardEligibility.generationBlockedByPolicy}`);

  const harvardPass =
    harvardAiPolicy.status === "AI_GENERATION_PROHIBITED" &&
    harvardAiPolicy.generationAllowed === false &&
    harvardAiPolicy.applicationAiMode === "AI_WRITING_BLOCKED" &&
    harvardEligibility.requirementsEligible === true &&
    harvardEligibility.finalGenerationEligible === false &&
    harvardEligibility.generationBlockedByPolicy === true;

  console.log(`\nHarvard Test: ${harvardPass ? "PASS" : "FAIL"}`);

  const totalPass = passCount + detectorPass + (harvardPass ? 1 : 0);
  const totalTests = fixtures.length + detectorTests.length + 1;
  console.log(`\n===== TOTAL: ${totalPass}/${totalTests} PASS =====`);

  process.exit(totalPass === totalTests ? 0 : 1);
}

main().catch(console.error);
