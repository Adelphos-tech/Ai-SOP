import { promises as fs } from "fs";
import path from "path";
import { buildGenerationContract, validateContractForWriting } from "../src/lib/requirements/generation-contract";
import { computePlannerRelevance } from "../src/lib/requirements/planner-relevance";
import { runComplianceCheck, countWords, hasMarkdown } from "../src/lib/requirements/compliance-check";
import { ContractBuildResult, GenerationContract } from "../src/lib/requirements/generation-contract-types";

interface FixtureResult {
  fixtureId: string;
  description: string;
  pass: boolean;
  details: string;
}

async function loadFixture(fixtureFile: string): Promise<any> {
  const content = await fs.readFile(path.join(__dirname, "fixtures", "generation-contract", fixtureFile), "utf-8");
  return JSON.parse(content);
}

async function runFixture(fixtureFile: string): Promise<FixtureResult> {
  const fixture = await loadFixture(fixtureFile);
  const profile = fixture.profile;
  const brief = fixture.brief;
  const aiPolicy = fixture.aiPolicy;
  const programContext = fixture.programContext || null;
  const expected = fixture.expected;

  try {
    const result = buildGenerationContract(profile, brief, aiPolicy, programContext);

    let pass = true;
    const details: string[] = [];

    // Check status
    if (result.status !== expected.status) {
      pass = false;
      details.push(`Status: ${result.status} (expected: ${expected.status})`);
    } else {
      details.push(`Status: ${result.status}`);
    }

    // Check clearedForWriting
    if (expected.clearedForWriting !== undefined && result.contract) {
      if (result.contract.clearedForWriting !== expected.clearedForWriting) {
        pass = false;
        details.push(`Cleared: ${result.contract.clearedForWriting} (expected: ${expected.clearedForWriting})`);
      } else {
        details.push(`Cleared: ${result.contract.clearedForWriting}`);
      }
    }

    // Check blocking reasons count
    if (expected.blockingReasonCount !== undefined) {
      if (result.blockingReasons.length !== expected.blockingReasonCount) {
        pass = false;
        details.push(`BlockingReasons: ${result.blockingReasons.length} (expected: ${expected.blockingReasonCount})`);
      } else {
        details.push(`BlockingReasons: ${result.blockingReasons.length}`);
      }
    }

    // Check missing info count
    if (expected.missingInfoCountMin !== undefined) {
      if (result.missingRequiredInformation.length < expected.missingInfoCountMin) {
        pass = false;
        details.push(`MissingInfo: ${result.missingRequiredInformation.length} (expected min: ${expected.missingInfoCountMin})`);
      } else {
        details.push(`MissingInfo: ${result.missingRequiredInformation.length}`);
      }
    }

    // Check word limit
    if (expected.wordLimitMin !== undefined && result.contract) {
      const wl = result.contract.writingRequirement.wordLimit;
      if (wl.min !== expected.wordLimitMin) {
        pass = false;
        details.push(`WordLimitMin: ${wl.min} (expected: ${expected.wordLimitMin})`);
      } else {
        details.push(`WordLimitMin: ${wl.min}`);
      }
    }

    if (expected.wordLimitMax !== undefined && result.contract) {
      const wl = result.contract.writingRequirement.wordLimit;
      if (wl.max !== expected.wordLimitMax) {
        pass = false;
        details.push(`WordLimitMax: ${wl.max} (expected: ${expected.wordLimitMax})`);
      } else {
        details.push(`WordLimitMax: ${wl.max}`);
      }
    }

    if (expected.wordLimitStatus !== undefined && result.contract) {
      const wl = result.contract.writingRequirement.wordLimit;
      if (wl.status !== expected.wordLimitStatus) {
        pass = false;
        details.push(`WordLimitStatus: ${wl.status} (expected: ${expected.wordLimitStatus})`);
      } else {
        details.push(`WordLimitStatus: ${wl.status}`);
      }
    }

    // Check program context
    if (expected.programContextIsNull !== undefined && result.contract) {
      const isNull = result.contract.programContext === null;
      if (isNull !== expected.programContextIsNull) {
        pass = false;
        details.push(`ProgramContext null: ${isNull} (expected: ${expected.programContextIsNull})`);
      } else {
        details.push(`ProgramContext null: ${isNull}`);
      }
    }

    if (expected.programContextNotNull !== undefined && result.contract) {
      const notNull = result.contract.programContext !== null;
      if (notNull !== expected.programContextNotNull) {
        pass = false;
        details.push(`ProgramContext not null: ${notNull} (expected: ${expected.programContextNotNull})`);
      } else {
        details.push(`ProgramContext not null: ${notNull}`);
      }
    }

    if (expected.programContextHasCurriculumThemes !== undefined && result.contract?.programContext) {
      const hasThemes = result.contract.programContext.curriculumThemes !== null;
      if (hasThemes !== expected.programContextHasCurriculumThemes) {
        pass = false;
        details.push(`CurriculumThemes: ${hasThemes} (expected: ${expected.programContextHasCurriculumThemes})`);
      } else {
        details.push(`CurriculumThemes: ${hasThemes}`);
      }
    }

    // Check document count
    if (expected.documentCount !== undefined && result.contract) {
      // The contract builder picks the first required document
      // We check that the brief has the expected number of documents
      const docCount = brief.documents.length;
      if (docCount !== expected.documentCount) {
        pass = false;
        details.push(`DocumentCount: ${docCount} (expected: ${expected.documentCount})`);
      } else {
        details.push(`DocumentCount: ${docCount}`);
      }
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
    "fixture-a-verified-ai-allowed.json",
    "fixture-b-ai-prohibited.json",
    "fixture-c-missing-student-info.json",
    "fixture-d-verified-word-limit.json",
    "fixture-e-no-word-limit.json",
    "fixture-f-multiple-documents.json",
    "fixture-g-country-precedence.json",
    "fixture-h-unverified-program-context.json",
    "fixture-i-verified-program-context.json",
    "fixture-j-harvard-blocked.json",
  ];

  console.log("===== GENERATION CONTRACT TEST FIXTURES =====\n");

  let passCount = 0;
  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    if (result.pass) passCount++;
    console.log(`[${result.pass ? "PASS" : "FAIL"}] ${result.fixtureId}: ${result.description}`);
    console.log(`  ${result.details}`);
    console.log();
  }

  console.log(`===== FIXTURE SUMMARY: ${passCount}/${fixtures.length} PASS =====`);

  // ===== Planner relevance tests =====
  console.log("\n===== PLANNER RELEVANCE TESTS =====\n");

  // Load fixture A for relevance tests
  const fixtureA = await loadFixture("fixture-a-verified-ai-allowed.json");
  const relevanceOutput = computePlannerRelevance(
    fixtureA.profile,
    fixtureA.brief.documents[0].requiredTopics.map((t: any) => t.value),
    null
  );

  let relevancePass = true;
  const relevanceDetails: string[] = [];

  if (relevanceOutput.factRelevance.length === 0) {
    relevancePass = false;
    relevanceDetails.push("No fact relevance decisions");
  } else {
    relevanceDetails.push(`FactRelevance: ${relevanceOutput.factRelevance.length} facts`);
  }

  if (relevanceOutput.requiredTopicMappings.length !== 3) {
    relevancePass = false;
    relevanceDetails.push(`TopicMappings: ${relevanceOutput.requiredTopicMappings.length} (expected: 3)`);
  } else {
    relevanceDetails.push(`TopicMappings: ${relevanceOutput.requiredTopicMappings.length}`);
  }

  const coveredTopics = relevanceOutput.requiredTopicMappings.filter(m => m.status === "COVERED").length;
  if (coveredTopics < 2) {
    relevancePass = false;
    relevanceDetails.push(`CoveredTopics: ${coveredTopics} (expected min: 2)`);
  } else {
    relevanceDetails.push(`CoveredTopics: ${coveredTopics}`);
  }

  if (relevanceOutput.hasMaterialMissingInfo) {
    relevancePass = false;
    relevanceDetails.push("HasMaterialMissingInfo: true (expected: false for fixture A)");
  } else {
    relevanceDetails.push("HasMaterialMissingInfo: false");
  }

  console.log(`[${relevancePass ? "PASS" : "FAIL"}] Planner Relevance (Fixture A)`);
  console.log(`  ${relevanceDetails.join("; ")}`);

  // Test fixture C for missing info
  const fixtureC = await loadFixture("fixture-c-missing-student-info.json");
  const relevanceC = computePlannerRelevance(
    fixtureC.profile,
    fixtureC.brief.documents[0].requiredTopics.map((t: any) => t.value),
    null
  );

  let missingInfoPass = true;
  const missingInfoDetails: string[] = [];

  if (!relevanceC.hasMaterialMissingInfo) {
    missingInfoPass = false;
    missingInfoDetails.push("HasMaterialMissingInfo: false (expected: true)");
  } else {
    missingInfoDetails.push("HasMaterialMissingInfo: true");
  }

  if (relevanceC.missingRequiredInformation.length === 0) {
    missingInfoPass = false;
    missingInfoDetails.push("MissingInfo: 0 (expected: >0)");
  } else {
    missingInfoDetails.push(`MissingInfo: ${relevanceC.missingRequiredInformation.length}`);
  }

  console.log(`[${missingInfoPass ? "PASS" : "FAIL"}] Missing Info Detection (Fixture C)`);
  console.log(`  ${missingInfoDetails.join("; ")}`);

  // ===== Compliance check tests =====
  console.log("\n===== COMPLIANCE CHECK TESTS =====\n");

  // Create a mock contract for compliance testing
  const mockContract: GenerationContract = {
    contractId: "test",
    createdAt: new Date().toISOString(),
    studentFacts: {},
    application: { country: "USA", university: "Test", program: "Test", degreeLevel: "Master's", intake: "Fall", intakeYear: "2027" },
    writingRequirement: {
      documentType: "STATEMENT_OF_PURPOSE",
      documentTypeLabel: "Statement of Purpose",
      officialPrompt: "Describe your research interests and career goals.",
      officialPromptStatus: "VERIFIED",
      wordLimit: { min: null, max: 1000, status: "VERIFIED" },
      characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
      requiredTopics: ["research interests", "career goals"],
      formatInstructions: [],
      additionalQuestions: [],
      sourceId: "test",
      responseComponentCount: 1,
    },
    responseComponents: [],
    pageLimit: { type: "PER_DOCUMENT", maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    facultyAlignment: [],
    programContext: null,
    countryGuidance: null,
    languageProfile: { testType: "IELTS", overallScore: "7", writingScore: "7", desiredProfile: "Natural Professional", tone: "Professional", personalization: "Balanced", technicalDetail: "Medium", openingStyle: "Let AI Choose" },
    verification: { requirementsVerified: true, aiWritingAllowed: true, aiPolicyStatus: "AI_GENERATION_ALLOWED", conflicts: [], factSheetApproved: true },
    clearedForWriting: true,
    blockingReasons: [],
  };

  // Test 1: Good document within limits
  const goodText = "This is a statement of purpose describing my research interests in machine learning and my career goals as a data scientist. ".repeat(12);
  const goodResult = runComplianceCheck(goodText, mockContract);
  let goodPass = goodResult.wordLimit === "PASS" && goodResult.emptyOutput === "PASS" && goodResult.documentType === "PASS";
  console.log(`[${goodPass ? "PASS" : "FAIL"}] Compliance: Good document within limits`);
  console.log(`  WordLimit: ${goodResult.wordLimit}, Empty: ${goodResult.emptyOutput}, DocType: ${goodResult.documentType}, Words: ${countWords(goodText)}`);

  // Test 2: Document exceeding word limit (need > 1000 words)
  const longText = "This is a statement of purpose describing my research. ".repeat(150); // ~1350 words
  const longResult = runComplianceCheck(longText, mockContract);
  let longPass = longResult.wordLimit === "FAIL";
  console.log(`[${longPass ? "PASS" : "FAIL"}] Compliance: Document exceeding word limit`);
  console.log(`  WordLimit: ${longResult.wordLimit}, Words: ${countWords(longText)}`);

  // Test 3: Empty document
  const emptyResult = runComplianceCheck("", mockContract);
  let emptyPass = emptyResult.emptyOutput === "FAIL";
  console.log(`[${emptyPass ? "PASS" : "FAIL"}] Compliance: Empty document`);
  console.log(`  EmptyOutput: ${emptyResult.emptyOutput}`);

  // Test 4: Markdown detection
  const markdownText = "# Statement of Purpose\n\nThis is my **research interests** and career goals.";
  const mdDetected = hasMarkdown(markdownText);
  let mdPass = mdDetected === true;
  console.log(`[${mdPass ? "PASS" : "FAIL"}] Compliance: Markdown detection`);
  console.log(`  Markdown detected: ${mdDetected}`);

  // Test 5: No word limit specified
  const noLimitContract = { ...mockContract, writingRequirement: { ...mockContract.writingRequirement, wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" } } };
  const noLimitResult = runComplianceCheck("Short text.", noLimitContract);
  let noLimitPass = noLimitResult.wordLimit === "N/A";
  console.log(`[${noLimitPass ? "PASS" : "FAIL"}] Compliance: No word limit → N/A`);
  console.log(`  WordLimit: ${noLimitResult.wordLimit}`);

  // ===== Contract validation tests =====
  console.log("\n===== CONTRACT VALIDATION TESTS =====\n");

  // Test: validate cleared contract
  const clearedContract = (await runFixture("fixture-a-verified-ai-allowed.json")).pass
    ? buildGenerationContract(fixtureA.profile, fixtureA.brief, fixtureA.aiPolicy, null).contract
    : null;
  const validResult = validateContractForWriting(clearedContract);
  let validPass = validResult.valid === true;
  console.log(`[${validPass ? "PASS" : "FAIL"}] Validate cleared contract`);
  console.log(`  Valid: ${validResult.valid}, Reason: ${validResult.reason}`);

  // Test: validate null contract
  const nullResult = validateContractForWriting(null);
  let nullPass = nullResult.valid === false;
  console.log(`[${nullPass ? "PASS" : "FAIL"}] Validate null contract`);
  console.log(`  Valid: ${nullResult.valid}, Reason: ${nullResult.reason}`);

  // ===== Total =====
  const compliancePassCount = [goodPass, longPass, emptyPass, mdPass, noLimitPass].filter(p => p).length;
  const validationPassCount = [validPass, nullPass].filter(p => p).length;
  const relevancePassCount = [relevancePass, missingInfoPass].filter(p => p).length;

  const totalPass = passCount + compliancePassCount + validationPassCount + relevancePassCount;
  const totalTests = fixtures.length + 5 + 2 + 2;
  console.log(`\n===== TOTAL: ${totalPass}/${totalTests} PASS =====`);

  process.exit(totalPass === totalTests ? 0 : 1);
}

main().catch(console.error);
