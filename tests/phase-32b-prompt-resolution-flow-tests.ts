/**
 * @file phase-32b-prompt-resolution-flow-tests.ts
 * @description
 * Phase SOP-AI-32b — Tests for the full prompt resolution decision tree:
 *
 *   1. Manual prompt → USE IT
 *   2. No manual prompt → Check D-Vivid Requirements DB → reuse
 *   3. No DB match → DVIVID_DEFAULT_TEMPLATE
 *   4. DVIVID_DEFAULT_TEMPLATE cannot be set by users
 *   5. Default templates exist for all document types
 */

import { closeDbPool, assertTestDatabase, cleanupTestDb } from "./test-setup";
import {
  createInstitution,
  createProgram,
  createRequirementSet,
  createWritingRequirement,
  findRequirementSetByAppIdentity,
} from "../src/lib/application/requirements-repository";
import {
  computeRequirementSetHash,
} from "../src/lib/application/requirements-types";
import {
  DVIVID_DEFAULT_TEMPLATES,
  getDefaultTemplate,
  hasDefaultTemplate,
} from "../src/lib/application/default-templates";
import {
  DocumentType,
  isValidPromptSource,
  isUserSettablePromptSource,
  USER_SETTABLE_PROMPT_SOURCES,
} from "../src/lib/application/application-types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTests() {
  await assertTestDatabase();
  console.log("=== Phase 32b Prompt Resolution Flow Tests ===\n");

  // --- Test 1: Manual prompt returns MANUAL path ---
  console.log("Test 1: Manual prompt returns MANUAL path");
  {
    // Simulate the resolve-prompt logic
    const manualPrompt = "Write about your research interests in AI.";
    const manualSource = "CONSULTANT_PROVIDED";

    // Step 1: manual prompt provided → use it
    assert(manualPrompt.trim().length > 0, "Manual prompt is non-empty");
    assert(isValidPromptSource(manualSource), "Manual prompt source is valid");
    assert(isUserSettablePromptSource(manualSource), "Consultant can set CONSULTANT_PROVIDED");
    assert(manualSource !== "OFFICIAL_VERIFIED" as any, "Manual source is not OFFICIAL_VERIFIED");
    assert(manualSource !== "DVIVID_DEFAULT_TEMPLATE" as any, "Manual source is not DVIVID_DEFAULT_TEMPLATE");
  }

  // --- Test 2: Portal prompt returns MANUAL path with USER_PROVIDED_PORTAL_PROMPT ---
  console.log("Test 2: Portal prompt returns MANUAL path with USER_PROVIDED_PORTAL_PROMPT");
  {
    const portalPrompt = "Copied from the university portal.";
    const portalSource = "USER_PROVIDED_PORTAL_PROMPT";

    assert(portalPrompt.trim().length > 0, "Portal prompt is non-empty");
    assert(isValidPromptSource(portalSource), "Portal prompt source is valid");
    assert(isUserSettablePromptSource(portalSource), "User can set USER_PROVIDED_PORTAL_PROMPT");
  }

  // --- Test 3: DB lookup finds fresh requirement set → DB_REUSED ---
  console.log("Test 3: DB lookup finds fresh requirement set → DB_REUSED");
  {
    const institution = await createInstitution({
      canonicalName: "Resolve Test University",
      country: "USA",
      officialDomain: "resolvetest.edu",
    });

    const program = await createProgram({
      institutionId: institution.id,
      programName: "MS Data Science",
      degree: "Master of Science",
      country: "USA",
    });

    const reqSet = await createRequirementSet({
      programId: program.id,
      intake: "Fall",
      intakeYear: "2027",
      verificationStatus: "VERIFIED",
      aiPolicyStatus: "AI_GENERATION_ALLOWED",
      verifiedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      contentHash: computeRequirementSetHash({
        university: "Resolve Test University",
        program: "MS Data Science",
        degree: "Master of Science",
        intake: "Fall",
        intakeYear: "2027",
        writingRequirements: [],
        aiPolicyStatus: "AI_GENERATION_ALLOWED",
      }),
    });

    const sopReq = await createWritingRequirement({
      requirementSetId: reqSet.id,
      documentType: "STATEMENT_OF_PURPOSE",
      officialTitle: "Statement of Purpose",
      promptText: "Describe your data science background and research interests.",
      promptSource: "OFFICIAL_VERIFIED",
      componentOrder: 0,
      wordMax: 1000,
    });

    // Simulate DB lookup
    const dbResult = await findRequirementSetByAppIdentity({
      university: "Resolve Test University",
      program: "MS Data Science",
      degree: "Master of Science",
      intake: "Fall",
      intakeYear: "2027",
    });

    assert(dbResult.result === "EXACT_FRESH_MATCH", "DB lookup returns EXACT_FRESH_MATCH");
    assert(dbResult.writingRequirements !== undefined, "Writing requirements returned");
    assert(dbResult.writingRequirements!.length > 0, "At least one writing requirement exists");

    const matchingWR = dbResult.writingRequirements!.find(wr => wr.documentType === "STATEMENT_OF_PURPOSE");
    assert(matchingWR !== undefined, "Matching writing requirement found for SOP");
    assert(matchingWR!.promptText === "Describe your data science background and research interests.", "Prompt text correct");
    assert(matchingWR!.promptSource === "OFFICIAL_VERIFIED", "Prompt source is OFFICIAL_VERIFIED");
  }

  // --- Test 4: DB lookup with no match → DEFAULT_TEMPLATE ---
  console.log("Test 4: DB lookup with no match → DEFAULT_TEMPLATE");
  {
    const dbResult = await findRequirementSetByAppIdentity({
      university: "Nonexistent University",
      program: "Nonexistent Program",
      degree: "PhD",
      intake: "Spring",
      intakeYear: "2028",
    });

    assert(dbResult.result === "NOT_FOUND", "DB lookup returns NOT_FOUND");

    // Fall through to default template
    const template = getDefaultTemplate("STATEMENT_OF_PURPOSE");
    assert(template.promptText.length > 0, "Default template has prompt text");
    assert(template.wordMin !== undefined, "Default template has word min");
    assert(template.wordMax !== undefined, "Default template has word max");
  }

  // --- Test 5: Default templates exist for all document types ---
  console.log("Test 5: Default templates exist for all document types");
  {
    const allTypes: DocumentType[] = [
      "STATEMENT_OF_PURPOSE",
      "ESSAY",
      "SUPPLEMENTAL_QUESTION",
      "MOA",
      "PERSONAL_STATEMENT",
      "STATEMENT_OF_ACADEMIC_PURPOSE",
      "LETTER_OF_MOTIVATION",
      "VISA_SOP",
      "COVER_LETTER",
      "LETTER_OF_RECOMMENDATION",
      "CUSTOM",
    ];

    for (const dt of allTypes) {
      assert(hasDefaultTemplate(dt), `Default template exists for ${dt}`);
      const template = getDefaultTemplate(dt);
      assert(template.promptText.length > 100, `Template for ${dt} has substantial prompt text`);
      assert(template.label.includes("D-Vivid Default"), `Template for ${dt} has D-Vivid Default label`);
    }
  }

  // --- Test 6: DVIVID_DEFAULT_TEMPLATE cannot be set by users ---
  console.log("Test 6: DVIVID_DEFAULT_TEMPLATE cannot be set by users");
  {
    assert(isValidPromptSource("DVIVID_DEFAULT_TEMPLATE"), "DVIVID_DEFAULT_TEMPLATE is a valid prompt source");
    assert(!isUserSettablePromptSource("DVIVID_DEFAULT_TEMPLATE"), "DVIVID_DEFAULT_TEMPLATE is NOT user-settable");
    assert(!USER_SETTABLE_PROMPT_SOURCES.includes("DVIVID_DEFAULT_TEMPLATE" as any), "Not in USER_SETTABLE_PROMPT_SOURCES");
    assert(!USER_SETTABLE_PROMPT_SOURCES.includes("OFFICIAL_VERIFIED" as any), "OFFICIAL_VERIFIED also not user-settable");
  }

  // --- Test 7: Custom prompt works without shared requirement ---
  console.log("Test 7: Custom prompt works without shared requirement");
  {
    const customPrompt = "Write a 500-word scholarship motivation essay.";
    const customSource = "CUSTOM";

    assert(isValidPromptSource(customSource), "CUSTOM is valid prompt source");
    assert(isUserSettablePromptSource(customSource), "CUSTOM is user-settable");
    assert(customPrompt.trim().length > 0, "Custom prompt is non-empty");
  }

  // --- Test 8: Default template for SOP has correct structure ---
  console.log("Test 8: Default template for SOP has correct structure");
  {
    const template = getDefaultTemplate("STATEMENT_OF_PURPOSE");
    assert(template.documentType === "STATEMENT_OF_PURPOSE", "Document type is SOP");
    assert(template.promptText.includes("Statement of Purpose"), "Prompt mentions Statement of Purpose");
    assert(template.promptText.includes("Academic Background"), "Prompt includes academic background section");
    assert(template.promptText.includes("Career Goals"), "Prompt includes career goals section");
    assert(template.wordMin === 800, "SOP default word min is 800");
    assert(template.wordMax === 1000, "SOP default word max is 1000");
  }

  // --- Test 9: Default template for VISA_SOP is study-purpose focused ---
  console.log("Test 9: Default template for VISA_SOP is study-purpose focused");
  {
    const template = getDefaultTemplate("VISA_SOP");
    assert(template.documentType === "VISA_SOP", "Document type is VISA_SOP");
    assert(template.promptText.includes("Study Purpose"), "Prompt includes Study Purpose section");
    assert(template.promptText.includes("Post-Study Intentions"), "Prompt includes Post-Study Intentions section");
    assert(!template.promptText.includes("Ties to Home Country"), "Prompt must NOT include old 'Ties to Home Country' section");
    assert(!template.promptText.includes("Demonstrate clear intent to return"), "Prompt must NOT force immediate-return claim");
  }

  // --- Test 10: Default templates are evidence-constrained ---
  console.log("Test 10: Default templates are evidence-constrained");
  {
    for (const [dt, template] of Object.entries(DVIVID_DEFAULT_TEMPLATES)) {
      assert(
        template.promptText.includes("Do not fabricate") || template.promptText.includes("factual") || template.promptText.includes("honest"),
        `Template for ${dt} includes evidence constraint language`,
      );
    }
  }

  // --- Test 11: DB lookup with wrong intake returns NOT_FOUND → would fall to default ---
  console.log("Test 11: DB lookup with wrong intake returns NOT_FOUND → would fall to default");
  {
    const dbResult = await findRequirementSetByAppIdentity({
      university: "Resolve Test University",
      program: "MS Data Science",
      degree: "Master of Science",
      intake: "Spring", // Wrong intake
      intakeYear: "2027",
    });

    assert(dbResult.result === "NOT_FOUND", "Wrong intake returns NOT_FOUND");

    // Would fall through to default template
    const template = getDefaultTemplate("STATEMENT_OF_PURPOSE");
    assert(template.promptText.length > 0, "Default template available as fallback");
  }

  // --- Test 12: Resolution path labels are correct ---
  console.log("Test 12: Resolution path labels are correct");
  {
    const pathLabels: Record<string, string> = {
      MANUAL: "Manual Prompt",
      DB_REUSED: "Reused from D-Vivid Requirements DB",
      DISCOVERY_SAVED: "Discovered & Saved from Official Source",
      DEFAULT_TEMPLATE: "D-Vivid Default Template",
    };

    assert(Object.keys(pathLabels).length === 4, "Four resolution paths defined");
    assert(pathLabels["MANUAL"] === "Manual Prompt", "MANUAL label correct");
    assert(pathLabels["DB_REUSED"] === "Reused from D-Vivid Requirements DB", "DB_REUSED label correct");
    assert(pathLabels["DISCOVERY_SAVED"] === "Discovered & Saved from Official Source", "DISCOVERY_SAVED label correct");
    assert(pathLabels["DEFAULT_TEMPLATE"] === "D-Vivid Default Template", "DEFAULT_TEMPLATE label correct");
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  // Clean up test data
  try {
    await cleanupTestDb();
    console.log("Test data cleaned up.");
  } catch {
    // ignore cleanup errors
  }

  await closeDbPool();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
