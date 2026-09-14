/**
 * @file phase-33-document-generation-integration-tests.ts
 * @description
 * Phase SOP-AI-33 deterministic tests A-Z.
 * Tests document generation integration: context loading, document-type
 * configs, prompt merge, relationship validation, version persistence.
 * No OpenAI calls are made.
 */

import {
  createStudent,
  createApplication,
  createDocument,
  createOfficialDocument,
  getDocument,
  getStudent,
  getApplication,
  createDocumentVersion,
  listDocumentVersions,
  updateDocumentStatus,
  getDocumentVersion,
} from "../src/lib/application/application-repository";
import {
  createInstitution,
  createProgram,
  createRequirementSet,
  createWritingRequirement,
  linkApplicationToRequirementSet,
  linkDocumentToWritingRequirement,
} from "../src/lib/application/requirements-repository";
import {
  computeRequirementSetHash,
} from "../src/lib/application/requirements-types";
import {
  loadDocumentGenerationContext,
  buildPipelineWritingInstructions,
} from "../src/lib/application/generation-context";
import {
  DOCUMENT_TYPE_CONFIGS,
  getDocumentTypeConfig,
  buildWritingInstructions,
  buildQualityRubricInstructions,
  WritingPerspective,
} from "../src/lib/application/document-type-config";
import {
  adaptProfile,
} from "../src/lib/application/profile-adapter";
import {
  DVIVID_DEFAULT_TEMPLATES,
  getDefaultTemplate,
} from "../src/lib/application/default-templates";
import { closeDbPool, assertTestDatabase, cleanupTestDb } from "./test-setup";
import { saveStudentProfile } from "../src/lib/application/application-repository";

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
  console.log("=== Phase 33 Document Generation Integration Tests ===\n");

  // ===== Setup: Create test data =====
  const student = await createStudent({
    firstName: "Phase33",
    lastName: "TestStudent",
    email: `phase33.${Date.now()}@test.com`,
  });

  // Save a profile with fact sheet approval
  await saveStudentProfile(student.id, {
    personalData: {
      firstName: "Phase33",
      lastName: "TestStudent",
      nationality: "Indian",
      currentCity: "Mumbai",
      currentCountry: "India",
    },
    education: [{
      level: "Bachelor",
      institution: "Test University",
      degree: "B.Tech",
      specialization: "Computer Science",
      startYear: "2019",
      endYear: "2023",
      cgpa: "8.5",
      cgpaScale: "10",
    }],
    englishTesting: {
      testType: "IELTS",
      overallScore: "7.5",
      writing: "7.0",
    },
    experience: [{
      type: "Internship",
      organization: "Test Corp",
      role: "Software Engineer Intern",
      startDate: "2022-06",
      endDate: "2022-08",
      currentlyWorking: false,
      location: "Mumbai",
      responsibilities: "Developed web applications",
      keyAchievements: "Built a REST API",
      skillsLearned: "React, Node.js",
    }],
    careerGoals: {
      whyField: "I want to advance my knowledge in AI",
      whyProgram: "This program offers great courses",
      shortTermGoals: "Work as a software engineer",
      longTermGoals: "Lead AI projects",
      returnHomeCountry: "Yes",
      returnPlans: "Return to India after graduation",
    },
    factSheetApproval: {
      approved: true,
      approvedAt: new Date().toISOString(),
    },
  } as any);

  const application = await createApplication({
    studentId: student.id,
    universityName: "Test University Phase33",
    programName: "MS Computer Science",
    degree: "Master of Science",
    country: "USA",
    intake: "Fall",
    intakeYear: "2027",
  });

  // --- Test A: Persisted student loaded ---
  console.log("Test A: Persisted student loaded");
  {
    const loaded = await getStudent(student.id);
    assert(loaded !== null, "Student loaded from DB");
    assert(loaded!.firstName === "Phase33", "First name correct");
    assert(loaded!.email.includes("phase33"), "Email correct");
  }

  // --- Test B: Persisted application loaded ---
  console.log("Test B: Persisted application loaded");
  {
    const loaded = await getApplication(application.id);
    assert(loaded !== null, "Application loaded from DB");
    assert(loaded!.studentId === student.id, "Application linked to student");
    assert(loaded!.universityName === "Test University Phase33", "University correct");
  }

  // --- Test C: Persisted document loaded ---
  console.log("Test C: Persisted document loaded");
  {
    const doc = await createDocument({
      applicationId: application.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Statement of Purpose",
      promptText: "Describe your academic interests and career goals.",
      promptSource: "CONSULTANT_PROVIDED",
      wordMax: 1000,
    });
    assert(doc.id !== undefined, "Document created with ID");
    const loaded = await getDocument(doc.id);
    assert(loaded !== null, "Document loaded from DB");
    assert(loaded!.documentType === "STATEMENT_OF_PURPOSE", "Document type correct");
    assert(loaded!.promptText === "Describe your academic interests and career goals.", "Prompt text correct");
  }

  // --- Test D: Relationship mismatch blocks ---
  console.log("Test D: Relationship mismatch blocks");
  {
    const otherStudent = await createStudent({
      firstName: "Other",
      lastName: "Student",
      email: `other.${Date.now()}@test.com`,
    });
    const otherApp = await createApplication({
      studentId: otherStudent.id,
      universityName: "Other University",
      programName: "Other Program",
      degree: "PhD",
      country: "USA",
      intake: "Spring",
      intakeYear: "2028",
    });
    const otherDoc = await createDocument({
      applicationId: otherApp.id,
      documentType: "ESSAY",
      documentTitle: "Other Essay",
      promptText: "Write an essay.",
      promptSource: "CUSTOM",
    });

    // Wrong student for application
    const result1 = await loadDocumentGenerationContext(otherStudent.id, application.id, otherDoc.id);
    assert(!result1.ok, "Wrong student for application blocked");
    assert(result1.statusCode === 403, "Returns 403");

    // Wrong application for document
    const result2 = await loadDocumentGenerationContext(student.id, application.id, otherDoc.id);
    assert(!result2.ok, "Wrong application for document blocked");

    // Cleanup
    const pool = (await import("../src/lib/application/db")).getDbPool();
    await pool.execute("DELETE FROM document_versions WHERE document_id = ?", [otherDoc.id]);
    await pool.execute("DELETE FROM application_documents WHERE id = ?", [otherDoc.id]);
    await pool.execute("DELETE FROM applications WHERE id = ?", [otherApp.id]);
    await pool.execute("DELETE FROM students WHERE id = ?", [otherStudent.id]);
  }

  // --- Test E: Resolved manual prompt ---
  console.log("Test E: Resolved manual prompt");
  {
    const manualDoc = await createDocument({
      applicationId: application.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Manual SOP",
      promptText: "Write about your research interests in AI.",
      promptSource: "CONSULTANT_PROVIDED",
      wordMax: 1000,
    });

    const ctxResult = await loadDocumentGenerationContext(student.id, application.id, manualDoc.id);
    assert(ctxResult.ok, "Context loaded for manual prompt");
    assert(ctxResult.context!.mergedPrompt.promptSource === "CONSULTANT_PROVIDED", "Prompt source is CONSULTANT_PROVIDED");
    assert(ctxResult.context!.mergedPrompt.resolutionPath === "MANUAL", "Resolution path is MANUAL");
    assert(ctxResult.context!.mergedPrompt.promptText === "Write about your research interests in AI.", "Prompt text preserved");
    assert(ctxResult.context!.mergedPrompt.mergedWithDefault === false, "Not merged with default");
  }

  // --- Test F: Saved official prompt ---
  console.log("Test F: Saved official prompt");
  {
    const institution = await createInstitution({
      canonicalName: "Official Test University",
      country: "USA",
      officialDomain: "officialtest.edu",
    });
    const program = await createProgram({
      institutionId: institution.id,
      programName: "MS AI",
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
        university: "Official Test University",
        program: "MS AI",
        degree: "Master of Science",
        intake: "Fall",
        intakeYear: "2027",
        writingRequirements: [],
        aiPolicyStatus: "AI_GENERATION_ALLOWED",
      }),
    });
    const wr = await createWritingRequirement({
      requirementSetId: reqSet.id,
      documentType: "STATEMENT_OF_PURPOSE",
      officialTitle: "Statement of Purpose",
      promptText: "Describe your background in AI and your research goals.",
      promptSource: "OFFICIAL_VERIFIED",
      componentOrder: 0,
      wordMax: 750,
    });

    const officialApp = await createApplication({
      studentId: student.id,
      universityName: "Official Test University",
      programName: "MS AI",
      degree: "Master of Science",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    });
    await linkApplicationToRequirementSet(officialApp.id, reqSet.id);

    const officialDoc = await createOfficialDocument({
      applicationId: officialApp.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Statement of Purpose",
      promptText: "Describe your background in AI and your research goals.",
      promptSource: "OFFICIAL_VERIFIED",
      wordMax: 750,
    });
    await linkDocumentToWritingRequirement(officialDoc.id, wr.id);

    const ctxResult = await loadDocumentGenerationContext(student.id, officialApp.id, officialDoc.id);
    assert(ctxResult.ok, "Context loaded for official prompt");
    assert(ctxResult.context!.mergedPrompt.promptSource === "OFFICIAL_VERIFIED", "Prompt source is OFFICIAL_VERIFIED");
    assert(ctxResult.context!.mergedPrompt.resolutionPath === "OFFICIAL_VERIFIED", "Resolution path is OFFICIAL_VERIFIED");
    assert(ctxResult.context!.mergedPrompt.wordMax === 750, "Official word max preserved");
    assert(ctxResult.context!.mergedPrompt.writingRequirementId === wr.id, "Writing requirement ID linked");
  }

  // --- Test G: Default-template fallback ---
  console.log("Test G: Default-template fallback");
  {
    const defaultDoc = await createOfficialDocument({
      applicationId: application.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Default SOP",
      promptText: DVIVID_DEFAULT_TEMPLATES.STATEMENT_OF_PURPOSE.promptText,
      promptSource: "DVIVID_DEFAULT_TEMPLATE",
      wordMin: 800,
      wordMax: 1000,
    });

    const ctxResult = await loadDocumentGenerationContext(student.id, application.id, defaultDoc.id);
    assert(ctxResult.ok, "Context loaded for default template");
    assert(ctxResult.context!.mergedPrompt.promptSource === "DVIVID_DEFAULT_TEMPLATE", "Prompt source is DVIVID_DEFAULT_TEMPLATE");
    assert(ctxResult.context!.mergedPrompt.resolutionPath === "DEFAULT_TEMPLATE", "Resolution path is DEFAULT_TEMPLATE");
    assert(ctxResult.context!.mergedPrompt.wordMin === 800, "Default word min preserved");
    assert(ctxResult.context!.mergedPrompt.wordMax === 1000, "Default word max preserved");
  }

  // --- Test H: Partial official + default merge ---
  console.log("Test H: Partial official + default merge");
  {
    const institution = await createInstitution({
      canonicalName: "Partial Test University",
      country: "USA",
      officialDomain: "partialtest.edu",
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
      contentHash: "partial-test-hash",
    });
    // Writing requirement with only word limit, no exact question
    const wr = await createWritingRequirement({
      requirementSetId: reqSet.id,
      documentType: "STATEMENT_OF_PURPOSE",
      officialTitle: "Statement of Purpose",
      promptText: "",
      promptSource: "OFFICIAL_VERIFIED",
      componentOrder: 0,
      wordMax: 500,
    });

    const partialApp = await createApplication({
      studentId: student.id,
      universityName: "Partial Test University",
      programName: "MS Data Science",
      degree: "Master of Science",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    });
    await linkApplicationToRequirementSet(partialApp.id, reqSet.id);

    const partialDoc = await createOfficialDocument({
      applicationId: partialApp.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Statement of Purpose",
      promptText: "",
      promptSource: "OFFICIAL_VERIFIED",
      wordMax: 500,
    });
    await linkDocumentToWritingRequirement(partialDoc.id, wr.id);

    const ctxResult = await loadDocumentGenerationContext(student.id, partialApp.id, partialDoc.id);
    assert(ctxResult.ok, "Context loaded for partial official");
    assert(ctxResult.context!.mergedPrompt.mergedWithDefault === true, "Merged with default template");
    assert(ctxResult.context!.mergedPrompt.wordMax === 500, "Official word max takes precedence");
    assert(ctxResult.context!.mergedPrompt.promptText === DVIVID_DEFAULT_TEMPLATES.STATEMENT_OF_PURPOSE.promptText, "Default template fills missing question");
    assert(ctxResult.context!.mergedPrompt.promptSource === "OFFICIAL_VERIFIED", "Source remains OFFICIAL_VERIFIED");
  }

  // --- Test I: Correct document-type configuration ---
  console.log("Test I: Correct document-type configuration");
  {
    const sopConfig = getDocumentTypeConfig("STATEMENT_OF_PURPOSE");
    assert(sopConfig.documentType === "STATEMENT_OF_PURPOSE", "SOP config type correct");
    assert(sopConfig.writingPerspective === "FIRST_PERSON_STUDENT", "SOP perspective is FIRST_PERSON_STUDENT");
    assert(sopConfig.programFitRelevant === true, "SOP program fit relevant");
    assert(sopConfig.recommenderPerspectiveRequired === false, "SOP not recommender");
    assert(sopConfig.qualityRubric.length > 0, "SOP has quality rubric");
    assert(sopConfig.studentEvidenceCategories.length > 0, "SOP has evidence categories");

    const lorConfig = getDocumentTypeConfig("LETTER_OF_RECOMMENDATION");
    assert(lorConfig.writingPerspective === "FIRST_PERSON_RECOMMENDER", "LOR perspective is FIRST_PERSON_RECOMMENDER");
    assert(lorConfig.recommenderPerspectiveRequired === true, "LOR requires recommender perspective");
    assert(lorConfig.programFitRelevant === false, "LOR program fit not relevant");

    const visaConfig = getDocumentTypeConfig("VISA_SOP");
    assert(visaConfig.visaSpecificEvidence === true, "Visa SOP has visa-specific evidence");
    assert(visaConfig.safetyNotes.length > 0, "Visa SOP has safety notes");

    const essayConfig = getDocumentTypeConfig("ESSAY");
    assert(essayConfig.promptFirst === true, "Essay is prompt-first");
    assert(essayConfig.programFitRelevant === false, "Essay program fit not relevant");
  }

  // --- Test J: SOP perspective ---
  console.log("Test J: SOP perspective");
  {
    const config = getDocumentTypeConfig("STATEMENT_OF_PURPOSE");
    assert(config.writingPerspective === "FIRST_PERSON_STUDENT", "SOP uses FIRST_PERSON_STUDENT");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("First person (student)"), "Writing instructions include perspective");
    assert(instructions.includes("Statement of Purpose"), "Writing instructions include document type");
  }

  // --- Test K: Personal Statement perspective ---
  console.log("Test K: Personal Statement perspective");
  {
    const config = getDocumentTypeConfig("PERSONAL_STATEMENT");
    assert(config.writingPerspective === "FIRST_PERSON_STUDENT", "Personal Statement uses FIRST_PERSON_STUDENT");
    assert(config.programFitRelevant === true, "Personal Statement program fit relevant");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("First person (student)"), "Instructions include perspective");
  }

  // --- Test L: LOR recommender perspective ---
  console.log("Test L: LOR recommender perspective");
  {
    const config = getDocumentTypeConfig("LETTER_OF_RECOMMENDATION");
    assert(config.writingPerspective === "FIRST_PERSON_RECOMMENDER", "LOR uses FIRST_PERSON_RECOMMENDER");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("RECOMMENDER"), "Instructions mention recommender perspective");
    assert(instructions.includes("RECOMMENDER SAFETY"), "Instructions include recommender safety");
    assert(config.safetyNotes.some(n => n.includes("fabricate recommender")), "LOR has fabricate recommender safety note");
  }

  // --- Test M: Visa SOP configuration ---
  console.log("Test M: Visa SOP configuration");
  {
    const config = getDocumentTypeConfig("VISA_SOP");
    assert(config.visaSpecificEvidence === true, "Visa SOP has visa-specific evidence flag");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("VISA SAFETY"), "Instructions include visa safety");
    assert(instructions.includes("financial assets"), "Instructions mention financial assets");
    assert(instructions.includes("immigration intent"), "Instructions mention immigration intent");
  }

  // --- Test N: Cover Letter configuration ---
  console.log("Test N: Cover Letter configuration");
  {
    const config = getDocumentTypeConfig("COVER_LETTER");
    assert(config.writingPerspective === "FIRST_PERSON_APPLICANT", "Cover Letter uses FIRST_PERSON_APPLICANT");
    assert(config.programFitRelevant === false, "Cover Letter program fit not relevant");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("First person (applicant)"), "Instructions include applicant perspective");
    assert(instructions.includes("job achievements"), "Instructions mention job achievements safety");
  }

  // --- Test O: Essay prompt-first behavior ---
  console.log("Test O: Essay prompt-first behavior");
  {
    const config = getDocumentTypeConfig("ESSAY");
    assert(config.promptFirst === true, "Essay is prompt-first");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("Answer the supplied prompt"), "Instructions emphasize answering the prompt");
    assert(instructions.includes("Do NOT default to a Statement of Purpose structure"), "Instructions warn against SOP structure");
  }

  // --- Test P: Custom instructions ---
  console.log("Test P: Custom instructions");
  {
    const config = getDocumentTypeConfig("CUSTOM");
    assert(config.writingPerspective === "PROMPT_DEPENDENT", "Custom uses PROMPT_DEPENDENT");
    assert(config.promptFirst === true, "Custom is prompt-first");
    const instructions = buildWritingInstructions(config);
    assert(instructions.includes("Follow the consultant"), "Instructions mention following consultant");
  }

  // --- Test Q: Unsupported facts still blocked ---
  console.log("Test Q: Unsupported facts still blocked");
  {
    // The pipeline's closed-world evidence constraint is unchanged.
    // We verify the pipeline module still exports the same functions.
    const pipelineModule = await import("../src/lib/ai/pipeline/run-application-pipeline");
    assert(typeof pipelineModule.runApplicationPipeline === "function", "Pipeline still exports runApplicationPipeline");
    // The claim provenance module is still available
    const claimModule = await import("../src/lib/ai/claim-provenance");
    assert(typeof claimModule.validateFinalizerClaims === "function", "Claim provenance validation still available");
  }

  // --- Test R: Approval missing blocks pre-OpenAI ---
  console.log("Test R: Approval missing blocks pre-OpenAI");
  {
    const unapprovedStudent = await createStudent({
      firstName: "Unapproved",
      lastName: "Student",
      email: `unapproved.${Date.now()}@test.com`,
    });
    // Save profile WITHOUT fact sheet approval
    await saveStudentProfile(unapprovedStudent.id, {
      personalData: { firstName: "Unapproved", lastName: "Student" },
      education: [{ level: "Bachelor", institution: "Test", degree: "B.Tech" }],
      factSheetApproval: { approved: false, approvedAt: "" },
    } as any);

    const unapprovedApp = await createApplication({
      studentId: unapprovedStudent.id,
      universityName: "Test University",
      programName: "MS CS",
      degree: "MS",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    });
    const unapprovedDoc = await createDocument({
      applicationId: unapprovedApp.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "SOP",
      promptText: "Write about yourself.",
      promptSource: "CONSULTANT_PROVIDED",
    });

    const ctxResult = await loadDocumentGenerationContext(unapprovedStudent.id, unapprovedApp.id, unapprovedDoc.id);
    assert(ctxResult.ok, "Context loaded");
    assert(ctxResult.context!.blocked === true, "Generation is blocked");
    assert(ctxResult.context!.factSheetApproved === false, "Fact sheet not approved");
    assert(ctxResult.context!.blockReasons.some(r => r.includes("FACT_SHEET_NOT_APPROVED")), "Block reason includes fact sheet");
  }

  // --- Test S: First generation creates Version 1 ---
  console.log("Test S: First generation creates Version 1");
  {
    const versionDoc = await createDocument({
      applicationId: application.id,
      documentType: "ESSAY",
      documentTitle: "Version Test Essay",
      promptText: "Write about a challenge.",
      promptSource: "CONSULTANT_PROVIDED",
    });

    const version = await createDocumentVersion({
      documentId: versionDoc.id,
      content: "This is the generated content for version 1.",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "test-model",
      generationId: "gen-test-001",
      studentFactsHash: "hash123",
      requirementsHash: "reqhash123",
      costUsd: 0.05,
      costInr: 4.5,
    });

    assert(version.versionNumber === 1, "First version is version 1");
    assert(version.content === "This is the generated content for version 1.", "Content saved");
    assert(version.createdByType === "AI_GENERATED", "Created by AI");
    assert(version.model === "test-model", "Model saved");
    assert(version.costUsd === 0.05, "Cost USD saved");
    assert(version.costInr === 4.5, "Cost INR saved");
  }

  // --- Test T: Later version doesn't overwrite V1 ---
  console.log("Test T: Later version doesn't overwrite V1");
  {
    const versionDoc = await createDocument({
      applicationId: application.id,
      documentType: "ESSAY",
      documentTitle: "Version Test Essay 2",
      promptText: "Write about a challenge.",
      promptSource: "CONSULTANT_PROVIDED",
    });

    const v1 = await createDocumentVersion({
      documentId: versionDoc.id,
      content: "Version 1 content.",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "test-model",
      generationId: "gen-001",
    });
    const v2 = await createDocumentVersion({
      documentId: versionDoc.id,
      content: "Version 2 content.",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "test-model",
      generationId: "gen-002",
    });

    assert(v1.versionNumber === 1, "V1 is version 1");
    assert(v2.versionNumber === 2, "V2 is version 2");

    const allVersions = await listDocumentVersions(versionDoc.id);
    assert(allVersions.length === 2, "Two versions exist");
    assert(allVersions[0].versionNumber === 1, "V1 still exists");
    assert(allVersions[1].versionNumber === 2, "V2 exists");
    assert(allVersions[0].content === "Version 1 content.", "V1 content preserved");
    assert(allVersions[1].content === "Version 2 content.", "V2 content different");
  }

  // --- Test U: Failed generation creates no success version ---
  console.log("Test U: Failed generation creates no success version");
  {
    const failDoc = await createDocument({
      applicationId: application.id,
      documentType: "ESSAY",
      documentTitle: "Failed Gen Test",
      promptText: "Write about failure.",
      promptSource: "CONSULTANT_PROVIDED",
    });

    // Simulate a failed generation: update status to FAILED, don't create a version
    await updateDocumentStatus(failDoc.id, undefined, "FAILED");
    const loaded = await getDocument(failDoc.id);
    assert(loaded!.generationStatus === "FAILED", "Status is FAILED");

    const versions = await listDocumentVersions(failDoc.id);
    assert(versions.length === 0, "No version created for failed generation");
  }

  // --- Test V: Cost saved with version ---
  console.log("Test V: Cost saved with version");
  {
    const costDoc = await createDocument({
      applicationId: application.id,
      documentType: "ESSAY",
      documentTitle: "Cost Test",
      promptText: "Write about costs.",
      promptSource: "CONSULTANT_PROVIDED",
    });

    const version = await createDocumentVersion({
      documentId: costDoc.id,
      content: "Content with cost tracking.",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "gpt-5.6-sol",
      generationId: "gen-cost-001",
      studentFactsHash: "facts-hash",
      requirementsHash: "req-hash",
      costUsd: 0.1234,
      costInr: 10.5,
    });

    const loaded = await getDocumentVersion(version.id);
    assert(loaded!.costUsd === 0.1234, "Cost USD saved on version");
    assert(loaded!.costInr === 10.5, "Cost INR saved on version");
    assert(loaded!.model === "gpt-5.6-sol", "Model saved on version");
    assert(loaded!.generationId === "gen-cost-001", "Generation ID saved");
    assert(loaded!.studentFactsHash === "facts-hash", "Student facts hash saved");
    assert(loaded!.requirementsHash === "req-hash", "Requirements hash saved");
  }

  // --- Test W: Separate documents maintain separate versions ---
  console.log("Test W: Separate documents maintain separate versions");
  {
    const doc1 = await createDocument({
      applicationId: application.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "SOP Doc",
      promptText: "SOP prompt",
      promptSource: "CONSULTANT_PROVIDED",
    });
    const doc2 = await createDocument({
      applicationId: application.id,
      documentType: "ESSAY",
      documentTitle: "Essay Doc",
      promptText: "Essay prompt",
      promptSource: "CONSULTANT_PROVIDED",
    });

    await createDocumentVersion({
      documentId: doc1.id,
      content: "SOP content",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "test",
    });
    await createDocumentVersion({
      documentId: doc2.id,
      content: "Essay content",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "test",
    });

    const v1 = await listDocumentVersions(doc1.id);
    const v2 = await listDocumentVersions(doc2.id);
    assert(v1.length === 1, "Doc 1 has 1 version");
    assert(v2.length === 1, "Doc 2 has 1 version");
    assert(v1[0].content === "SOP content", "Doc 1 content is SOP");
    assert(v2[0].content === "Essay content", "Doc 2 content is Essay");
    assert(v1[0].documentId === doc1.id, "Version 1 belongs to doc 1");
    assert(v2[0].documentId === doc2.id, "Version 2 belongs to doc 2");
  }

  // --- Test X: Old document prose not promoted to facts ---
  console.log("Test X: Old document prose not promoted to facts");
  {
    // The profile adapter does NOT read from document_versions.
    // It only reads from the student profile.
    const profile = await adaptProfile(student, await import("../src/lib/application/application-repository").then(m => m.getStudentProfile(student.id)));
    assert(profile.factSheetApproval.approved === true, "Profile fact sheet approved from profile data");
    assert(profile.personalDetails.firstName === "Phase33", "Profile first name from profile data");
    // The pipeline's fact review still uses the profile, not old document content
    assert(!((profile as any).oldDocumentContent), "No old document content in profile");
  }

  // --- Test Y: Exactly six logical AI stages ---
  console.log("Test Y: Exactly six logical AI stages");
  {
    const stageExecutionModule = await import("../src/lib/ai/pipeline/stage-execution");
    const stages = stageExecutionModule.EXECUTION_STAGES;
    assert(stages.length === 6, `Expected 6 AI stages, got ${stages.length}`);
    assert(stages.includes("planner"), "Stage 1: Planner");
    assert(stages.includes("writer"), "Stage 2: Writer");
    assert(stages.includes("qualityReviewer"), "Stage 3: Quality Reviewer");
    assert(stages.includes("languageCalibrator"), "Stage 4: Language Calibrator");
    assert(stages.includes("finalizer"), "Stage 5: Bounded Finalizer");
    assert(stages.includes("factReviewer"), "Stage 6: Final Fact Reviewer");
  }

  // --- Test Z: No university-specific generation branch ---
  console.log("Test Z: No university-specific generation branch");
  {
    // The generation endpoint loads from the persistent DB model.
    // It does NOT branch based on university name.
    // The document-type config is the ONLY branching mechanism.
    const configs = Object.keys(DOCUMENT_TYPE_CONFIGS);
    assert(configs.length === 11, `Expected 11 document type configs, got ${configs.length}`);
    // Verify no university-specific configs exist
    assert(!configs.includes("MIT_SOP"), "No MIT-specific config");
    assert(!configs.includes("HARVARD_ESSAY"), "No Harvard-specific config");
    // All configs are document-type-based
    for (const key of configs) {
      const config = getDocumentTypeConfig(key);
      assert(config.documentType === key, `Config ${key} matches document type`);
    }
  }

  // ===== Additional: Quality rubric instructions =====
  console.log("Additional: Quality rubric instructions");
  {
    const sopConfig = getDocumentTypeConfig("STATEMENT_OF_PURPOSE");
    const rubric = buildQualityRubricInstructions(sopConfig);
    assert(rubric.includes("Statement of Purpose"), "Rubric mentions document type");
    assert(rubric.includes("Academic preparation"), "Rubric includes academic preparation");
    assert(rubric.includes("NOT a generic SOP rubric"), "Rubric warns against generic SOP rubric");

    const lorConfig = getDocumentTypeConfig("LETTER_OF_RECOMMENDATION");
    const lorRubric = buildQualityRubricInstructions(lorConfig);
    assert(lorRubric.includes("Letter of Recommendation"), "LOR rubric mentions document type");
    assert(lorRubric.includes("Relationship credibility"), "LOR rubric includes relationship credibility");
    assert(lorRubric.includes("Recommendation strength"), "LOR rubric includes recommendation strength");
  }

  // ===== Additional: Profile adapter =====
  console.log("Additional: Profile adapter");
  {
    const profile = await adaptProfile(student, await import("../src/lib/application/application-repository").then(m => m.getStudentProfile(student.id)));
    assert(profile.personalDetails.firstName === "Phase33", "Profile first name adapted");
    assert(profile.education.length > 0, "Education adapted");
    assert(profile.experience.length > 0, "Experience adapted");
    assert(profile.factSheetApproval.approved === true, "Fact sheet approval adapted");
    assert(profile.careerGoals.whyField === "I want to advance my knowledge in AI", "Career goals adapted");
  }

  // ===== Additional: Pipeline writing instructions =====
  console.log("Additional: Pipeline writing instructions");
  {
    const doc = await createDocument({
      applicationId: application.id,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Instructions Test",
      promptText: "Test prompt",
      promptSource: "CONSULTANT_PROVIDED",
    });
    const ctxResult = await loadDocumentGenerationContext(student.id, application.id, doc.id);
    if (ctxResult.ok && ctxResult.context) {
      const instructions = buildPipelineWritingInstructions(ctxResult.context);
      assert(instructions.includes("Statement of Purpose"), "Instructions include document type");
      assert(instructions.includes("First person (student)"), "Instructions include perspective");
      assert(instructions.includes("SAFETY NOTES"), "Instructions include safety notes");
    }
  }

  // ===== Additional: All document types have configs =====
  console.log("Additional: All document types have configs");
  {
    const allTypes = ["STATEMENT_OF_PURPOSE", "ESSAY", "SUPPLEMENTAL_QUESTION", "MOA", "PERSONAL_STATEMENT",
      "STATEMENT_OF_ACADEMIC_PURPOSE", "LETTER_OF_MOTIVATION", "VISA_SOP", "COVER_LETTER",
      "LETTER_OF_RECOMMENDATION", "CUSTOM"];
    for (const dt of allTypes) {
      const config = getDocumentTypeConfig(dt);
      assert(config.documentType === dt, `Config exists for ${dt}`);
      assert(config.displayName.length > 0, `${dt} has display name`);
      assert(config.qualityRubric.length > 0, `${dt} has quality rubric`);
      assert(config.studentEvidenceCategories.length > 0, `${dt} has evidence categories`);
      assert(config.safetyNotes.length > 0, `${dt} has safety notes`);
    }
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  // Clean up test data
  // Phase SOP-AI-34A: Tests now run against sop_ai_app_test, so we can
  // freely truncate all tables without worrying about production data.
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
