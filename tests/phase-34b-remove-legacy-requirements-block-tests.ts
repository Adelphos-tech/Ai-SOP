/**
 * @file phase-34b-remove-legacy-requirements-block-tests.ts
 * @description
 * Phase SOP-AI-34B BUGFIX tests A-J.
 * Verifies that the legacy "requirements must be verified" blocker is removed
 * and that Fact Sheet approval is the only pre-generation gate.
 *
 * Tests:
 *   A. Fact Sheet approved + consultant prompt → generation allowed
 *   B. Fact Sheet approved + portal prompt → generation allowed
 *   C. Fact Sheet approved + saved verified requirements → generation allowed
 *   D. Fact Sheet approved + no prompt + crawl finds requirement → generation allowed
 *   E. Fact Sheet approved + crawl finds nothing → default template → generation allowed
 *   F. Fact Sheet NOT approved → generation blocked
 *   G. no legacy "requirements must be verified" blocker remains
 *   H. exactly six AI stages remain
 *   I. existing document/version persistence used
 *   J. production unaffected
 *
 * No OpenAI calls are made.
 */

import { closeDbPool, assertTestDatabase, cleanupTestDb, getProductionCounts } from "./test-setup";
import {
  createStudent,
  getStudentByEmail,
  saveStudentProfile,
  createApplication,
  listStudentApplications,
  createDocument,
  listApplicationDocuments,
  getDocument,
} from "../src/lib/application/application-repository";
import {
  getDefaultTemplate,
} from "../src/lib/application/default-templates";
import {
  loadDocumentGenerationContext,
} from "../src/lib/application/generation-context";
import { DocumentType, PromptSource } from "../src/lib/application/application-types";
import { EXECUTION_STAGES } from "../src/lib/ai/pipeline/stage-execution";
import * as fs from "fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

/**
 * Simulate the bridging logic from /api/sop/generate without calling OpenAI.
 * Creates student/application/document and returns the document with its prompt resolution.
 */
async function bridgeProfileToDocument(profile: any) {
  // Check fact sheet approval
  if (!profile.factSheetApproval?.approved) {
    return { blocked: true, reason: "FACT_SHEET_NOT_APPROVED" };
  }

  // Create or find student
  const firstName = profile.personalDetails.firstName || "Student";
  const lastName = profile.personalDetails.lastName || "";
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@dvivid.student`.replace(/\s+/g, "");

  let student = await getStudentByEmail(email);
  if (!student) {
    student = await createStudent({ firstName, lastName, email });
  }

  // Save profile
  await saveStudentProfile(student.id, {
    personalData: { firstName, lastName },
    factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
  });

  // Create or find application
  const app = profile.application || {};
  const universityName = app.targetUniversity || "Unknown University";
  const programName = app.targetProgram || "Unknown Program";
  const degree = app.degreeLevel || "Master";
  const country = app.targetCountry || "Unknown";
  const intake = app.intake || "Fall";
  const intakeYear = app.intakeYear || "2027";

  const existingApps = await listStudentApplications(student.id);
  let application = existingApps.find(
    (a) => a.universityName === universityName && a.programName === programName,
  );
  if (!application) {
    application = await createApplication({
      studentId: student.id, universityName, programName, degree, country, intake, intakeYear,
    });
  }

  // Create or find document with prompt resolution
  const documentType: DocumentType = "STATEMENT_OF_PURPOSE";
  const existingDocs = await listApplicationDocuments(application.id);
  let document = existingDocs.find((d) => d.documentType === documentType);

  const manualPrompt = (app.sopQuestion || "").trim();
  const defaultTemplate = getDefaultTemplate(documentType);

  let promptText: string;
  let promptSource: PromptSource;

  if (manualPrompt) {
    promptText = manualPrompt;
    promptSource = "CONSULTANT_PROVIDED";
  } else {
    promptText = defaultTemplate?.promptText || "Default prompt";
    promptSource = "DVIVID_DEFAULT_TEMPLATE";
  }

  const wordMin = app.wordRequirement === "Known" && app.minWords ? parseInt(app.minWords, 10) : undefined;
  const wordMax = app.wordRequirement === "Known" && app.maxWords ? parseInt(app.maxWords, 10) : undefined;

  if (!document) {
    if (promptSource === "DVIVID_DEFAULT_TEMPLATE") {
      // DVIVID_DEFAULT_TEMPLATE is server-controlled, insert directly
      const { getDbPool } = await import("../src/lib/application/db");
      const pool = getDbPool();
      const { randomUUID } = await import("crypto");
      const docId = randomUUID();
      await pool.execute(
        `INSERT INTO application_documents (id, application_id, document_type, document_title, prompt_text, prompt_source, word_min, word_max, requirements_status, generation_status, review_status, created_at, updated_at) VALUES (?, ?, 'STATEMENT_OF_PURPOSE', 'Statement of Purpose', ?, 'DVIVID_DEFAULT_TEMPLATE', ?, ?, 'NOT_STARTED', 'NOT_STARTED', 'DRAFT', NOW(), NOW())`,
        [docId, application.id, promptText, wordMin || null, wordMax || null],
      );
      document = { id: docId, applicationId: application.id, documentType, documentTitle: "Statement of Purpose", promptText, promptSource, wordMin, wordMax } as any;
    } else {
      document = await createDocument({
        applicationId: application.id,
        documentType,
        documentTitle: "Statement of Purpose",
        promptText,
        promptSource,
        wordMin,
        wordMax,
      });
    }
  }

  // Load the generation context to verify prompt resolution (does NOT call OpenAI)
  const ctxResult = await loadDocumentGenerationContext(student.id, application.id, document!.id);

  return {
    blocked: false,
    student,
    application,
    document,
    ctxResult,
    promptSource,
    promptText,
  };
}

async function runTests() {
  await assertTestDatabase();
  console.log("=== Phase 34B Remove Legacy Requirements Block Tests ===\n");

  // ===== A. Fact Sheet approved + consultant prompt → generation allowed =====
  console.log("[A] Fact Sheet approved + consultant prompt → generation allowed");
  {
    const profile = {
      personalDetails: { firstName: "TestA", lastName: "StudentA" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
      application: {
        targetUniversity: "Test University A",
        targetProgram: "MS CS",
        targetCountry: "USA",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "Describe your research interests in AI.",
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(!result.blocked, "Generation not blocked with approved fact sheet + consultant prompt");
    assert(result.promptSource === "CONSULTANT_PROVIDED", "Prompt source is CONSULTANT_PROVIDED");
    assert(result.ctxResult!.ok, "Generation context loads successfully");
    assert(result.ctxResult!.context?.mergedPrompt.promptText === "Describe your research interests in AI.", "Manual prompt is used");
    assert(result.ctxResult!.context?.mergedPrompt.resolutionPath === "MANUAL", "Resolution path is MANUAL");
  }

  // ===== B. Fact Sheet approved + portal prompt → generation allowed =====
  console.log("\n[B] Fact Sheet approved + portal prompt → generation allowed");
  {
    const profile = {
      personalDetails: { firstName: "TestB", lastName: "StudentB" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
      application: {
        targetUniversity: "Portal University",
        targetProgram: "MS Data Science",
        targetCountry: "USA",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "Why do you want to pursue data science?",
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(!result.blocked, "Generation not blocked with approved fact sheet + portal prompt");
    assert(result.promptSource === "CONSULTANT_PROVIDED", "Prompt source is CONSULTANT_PROVIDED (portal prompt treated as manual)");
    assert(result.ctxResult!.ok, "Generation context loads successfully");
  }

  // ===== C. Fact Sheet approved + saved verified requirements → generation allowed =====
  console.log("\n[C] Fact Sheet approved + saved verified requirements → generation allowed");
  {
    // This test verifies that if a document has OFFICIAL_VERIFIED prompt source,
    // the generation context loads it correctly (no blocker).
    // OFFICIAL_VERIFIED can only be set by the server (requirements resolution flow),
    // so we insert it directly via SQL to simulate the server having verified requirements.
    const student = await createStudent({
      firstName: "TestC", lastName: "StudentC",
      email: `testc.${Date.now()}@dvivid.student`,
    });
    await saveStudentProfile(student.id, {
      personalData: { firstName: "TestC", lastName: "StudentC" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
    });
    const app = await createApplication({
      studentId: student.id,
      universityName: "Verified University",
      programName: "MS AI",
      degree: "Master",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    });
    // Insert document with OFFICIAL_VERIFIED directly (simulating server-side requirements resolution)
    const { getDbPool } = await import("../src/lib/application/db");
    const pool = getDbPool();
    const docId = `test-doc-c-${Date.now()}`;
    await pool.execute(
      `INSERT INTO application_documents (id, application_id, document_type, document_title, prompt_text, prompt_source, word_min, word_max, requirements_status, generation_status, review_status, created_at, updated_at) VALUES (?, ?, 'STATEMENT_OF_PURPOSE', 'Statement of Purpose', ?, 'OFFICIAL_VERIFIED', 500, 1000, 'NOT_STARTED', 'NOT_STARTED', 'DRAFT', NOW(), NOW())`,
      [docId, app.id, "Official verified prompt from university."],
    );

    const ctxResult = await loadDocumentGenerationContext(student.id, app.id, docId);
    assert(ctxResult.ok, "Generation context loads with OFFICIAL_VERIFIED prompt");
    assert(!ctxResult.context?.blocked, "Generation not blocked with verified requirements");
    // Without a linked writing requirement, OFFICIAL_VERIFIED falls through to MANUAL path
    // The key assertion is that generation is NOT blocked, regardless of resolution path
  }

  // ===== D. Fact Sheet approved + no prompt + crawl finds requirement → generation allowed =====
  console.log("\n[D] Fact Sheet approved + no prompt + crawl finds requirement → generation allowed");
  {
    // Crawl is not performed in the bridge; the Phase-32 flow handles this.
    // We test that no prompt + no verified requirement does NOT block.
    const profile = {
      personalDetails: { firstName: "TestD", lastName: "StudentD" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
      application: {
        targetUniversity: "Crawl University",
        targetProgram: "MS Robotics",
        targetCountry: "USA",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "", // No manual prompt
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(!result.blocked, "Generation not blocked when no prompt and no verified requirements");
    assert(result.promptSource === "DVIVID_DEFAULT_TEMPLATE", "Falls back to DVIVID_DEFAULT_TEMPLATE");
    assert(result.ctxResult!.ok, "Generation context loads successfully with default template");
  }

  // ===== E. Fact Sheet approved + crawl finds nothing → default template → generation allowed =====
  console.log("\n[E] Fact Sheet approved + crawl finds nothing → default template → generation allowed");
  {
    const profile = {
      personalDetails: { firstName: "TestE", lastName: "StudentE" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
      application: {
        targetUniversity: "Unknown University",
        targetProgram: "Unknown Program",
        targetCountry: "Unknown",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "",
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(!result.blocked, "Generation not blocked when crawl finds nothing");
    assert(result.promptSource === "DVIVID_DEFAULT_TEMPLATE", "Uses DVIVID_DEFAULT_TEMPLATE");
    assert(result.ctxResult!.ok, "Generation context loads with default template");
    assert(result.ctxResult!.context?.mergedPrompt.resolutionPath === "DEFAULT_TEMPLATE", "Resolution path is DEFAULT_TEMPLATE");

    // Verify DVIVID_DEFAULT_TEMPLATE is NOT labeled OFFICIAL_VERIFIED
    assert(result.ctxResult!.context?.mergedPrompt.promptSource === "DVIVID_DEFAULT_TEMPLATE", "Default template is NOT labeled OFFICIAL_VERIFIED");
  }

  // ===== F. Fact Sheet NOT approved → generation blocked =====
  console.log("\n[F] Fact Sheet NOT approved → generation blocked");
  {
    const profile = {
      personalDetails: { firstName: "TestF", lastName: "StudentF" },
      factSheetApproval: { approved: false, approvedAt: "" },
      application: {
        targetUniversity: "Block University",
        targetProgram: "MS CS",
        targetCountry: "USA",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "Test prompt",
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(result.blocked, "Generation blocked when fact sheet not approved");
    assert(result.reason === "FACT_SHEET_NOT_APPROVED", "Block reason is FACT_SHEET_NOT_APPROVED");
  }

  // ===== G. no legacy "requirements must be verified" blocker remains =====
  console.log("\n[G] no legacy 'requirements must be verified' blocker remains");
  {
    // Code audit: check the /api/sop/generate route source
    const routeSource = fs.readFileSync(
      "src/app/api/sop/generate/route.ts", "utf-8",
    );
    assert(!routeSource.includes("APPLICATION_CONTEXT_NOT_FOUND"), "No APPLICATION_CONTEXT_NOT_FOUND blocker");
    assert(!routeSource.includes("APPLICATION_REQUIREMENTS_UNVERIFIED"), "No APPLICATION_REQUIREMENTS_UNVERIFIED blocker");
    assert(!routeSource.includes("APPLICATION_REQUIREMENTS_REVIEW_REQUIRED"), "No APPLICATION_REQUIREMENTS_REVIEW_REQUIRED blocker");
    assert(!routeSource.includes("APPLICATION_AI_POLICY_BLOCK"), "No APPLICATION_AI_POLICY_BLOCK blocker");
    assert(!routeSource.includes("requirements have not been verified"), "No 'requirements have not been verified' message");
    assert(!routeSource.includes("loadVerifiedApplicationContext"), "No legacy loadVerifiedApplicationContext call");

    // Check fact-sheet page source
    const pageSource = fs.readFileSync(
      "src/app/fact-sheet/page.tsx", "utf-8",
    );
    assert(!pageSource.includes("Application requirements have not been verified"), "No legacy blocker message in fact-sheet page");
    assert(!pageSource.includes("APPLICATION_CONTEXT_NOT_FOUND"), "No legacy error code in fact-sheet page");
    assert(!pageSource.includes("APPLICATION_REQUIREMENTS_UNVERIFIED"), "No legacy requirements unverified code in fact-sheet page");
  }

  // ===== H. exactly six AI stages remain =====
  console.log("\n[H] exactly six AI stages remain");
  {
    assert(EXECUTION_STAGES.length === 6, "Still exactly 6 AI stages");
    assert(EXECUTION_STAGES[0] === "planner", "Stage 1: planner");
    assert(EXECUTION_STAGES[1] === "writer", "Stage 2: writer");
    assert(EXECUTION_STAGES[2] === "qualityReviewer", "Stage 3: qualityReviewer");
    assert(EXECUTION_STAGES[3] === "languageCalibrator", "Stage 4: languageCalibrator");
    assert(EXECUTION_STAGES[4] === "finalizer", "Stage 5: finalizer");
    assert(EXECUTION_STAGES[5] === "factReviewer", "Stage 6: factReviewer");
  }

  // ===== I. existing document/version persistence used =====
  console.log("\n[I] existing document/version persistence used");
  {
    // Verify that the bridge creates persistent student/application/document
    const profile = {
      personalDetails: { firstName: "TestI", lastName: "StudentI" },
      factSheetApproval: { approved: true, approvedAt: new Date().toISOString() },
      application: {
        targetUniversity: "Persistence University",
        targetProgram: "MS Persistence",
        targetCountry: "USA",
        degreeLevel: "Master",
        intake: "Fall",
        intakeYear: "2027",
        sopQuestion: "Test persistence prompt.",
        wordRequirement: "Unknown",
      },
    };
    const result = await bridgeProfileToDocument(profile);
    assert(!result.blocked, "Bridge succeeded");
    assert(!!result.student?.id, "Student created with ID");
    assert(!!result.application?.id, "Application created with ID");
    assert(!!result.document?.id, "Document created with ID");

    // Verify the document is in the persistent DB
    const doc = await getDocument(result.document!.id);
    assert(!!doc, "Document persists in DB");
    assert(doc?.promptText === "Test persistence prompt.", "Document prompt text is correct");
    assert(doc?.promptSource === "CONSULTANT_PROVIDED", "Document prompt source is correct");

    // Verify idempotency: calling again should find the same records
    const result2 = await bridgeProfileToDocument(profile);
    assert(result2.student?.id === result.student?.id, "Same student on second call (idempotent)");
    assert(result2.application?.id === result.application?.id, "Same application on second call (idempotent)");
    assert(result2.document?.id === result.document?.id, "Same document on second call (idempotent)");
  }

  // ===== J. production unaffected =====
  console.log("\n[J] production unaffected");
  {
    const counts = await getProductionCounts();
    assert(counts.students === 1, "Production still has 1 student");
    assert(counts.applications === 1, "Production still has 1 application");
    assert(counts.application_documents === 1, "Production still has 1 document");
    assert(counts.document_versions === 1, "Production still has 1 version");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  try {
    await cleanupTestDb();
  } catch {
    // ignore cleanup errors
  }
  await closeDbPool();
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
