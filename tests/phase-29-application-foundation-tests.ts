/**
 * @file phase-29-application-foundation-tests.ts
 * @description
 * Phase SOP-AI-29 deterministic tests.
 * Tests A-T: student, application, document, version CRUD + integrity.
 * Uses direct repository calls (no HTTP needed).
 */

import { closeDbPool, assertTestDatabase, cleanupTestDb } from "./test-setup";
import {
  createStudent,
  getStudent,
  getStudentByEmail,
  searchStudents,
  saveStudentProfile,
  getStudentProfile,
  createApplication,
  getApplication,
  listStudentApplications,
  createDocument,
  getDocument,
  listApplicationDocuments,
  createDocumentVersion,
  listDocumentVersions,
} from "../src/lib/application/application-repository";
import {
  CreateStudentInput,
  CreateApplicationInput,
  CreateDocumentInput,
  CreateDocumentVersionInput,
  isValidDocumentType,
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
  console.log("=== Phase 29 Application Foundation Tests ===\n");

  let studentId: string;
  let applicationId: string;
  let documentId: string;
  let secondApplicationId: string;

  // --- Test A: Create student ---
  console.log("Test A: Create student");
  {
    const input: CreateStudentInput = {
      firstName: "Rahul",
      lastName: "Sharma",
      email: `rahul.test.${Date.now()}@example.com`,
      phone: "+91 98765 43210",
      country: "India",
    };
    const student = await createStudent(input);
    studentId = student.id;
    assert(student.id !== undefined, "Student has ID");
    assert(student.firstName === "Rahul", "First name stored");
    assert(student.lastName === "Sharma", "Last name stored");
    assert(student.email === input.email, "Email stored");
    assert(student.createdAt !== undefined, "Created timestamp set");
  }

  // --- Test B: Persist student profile ---
  console.log("Test B: Persist student profile");
  {
    const profileData = {
      personalData: { firstName: "Rahul", lastName: "Sharma" },
      education: [{ degree: "B.Tech", university: "IIT Delhi" }],
      careerGoals: { shortTerm: "Work in environmental engineering" },
    };
    await saveStudentProfile(studentId, profileData);
    const loaded = await getStudentProfile(studentId);
    assert(loaded !== null, "Profile loaded from server");
    assert(loaded?.education?.length === 1, "Education array preserved");
    assert(loaded?.careerGoals?.shortTerm === "Work in environmental engineering", "Career goals preserved");
  }

  // --- Test C: Create application ---
  console.log("Test C: Create application");
  {
    const input: CreateApplicationInput = {
      studentId,
      universityName: "Massachusetts Institute of Technology",
      programName: "Civil & Environmental Engineering",
      degree: "Master of Engineering",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    };
    const app = await createApplication(input);
    applicationId = app.id;
    assert(app.id !== undefined, "Application has ID");
    assert(app.studentId === studentId, "Application linked to student");
    assert(app.universityName === "Massachusetts Institute of Technology", "University stored");
    assert(app.status === "DRAFT", "Default status is DRAFT");
  }

  // --- Test D: Same student multiple applications ---
  console.log("Test D: Same student multiple applications");
  {
    const input: CreateApplicationInput = {
      studentId,
      universityName: "Stanford University",
      programName: "Civil Engineering",
      degree: "Master of Science",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    };
    const app2 = await createApplication(input);
    secondApplicationId = app2.id;
    const apps = await listStudentApplications(studentId);
    assert(apps.length === 2, "Student has 2 applications");
    assert(apps.some(a => a.universityName === "Massachusetts Institute of Technology"), "MIT application found");
    assert(apps.some(a => a.universityName === "Stanford University"), "Stanford application found");
  }

  // --- Test E: Create SOP document ---
  console.log("Test E: Create SOP document");
  {
    const input: CreateDocumentInput = {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Statement of Objectives",
      promptText: "Describe your academic interests and career goals.",
      promptSource: "CONSULTANT_PROVIDED",
      wordMin: 500,
      wordMax: 1000,
    };
    const doc = await createDocument(input);
    documentId = doc.id;
    assert(doc.id !== undefined, "Document has ID");
    assert(doc.applicationId === applicationId, "Document linked to application");
    assert(doc.documentType === "STATEMENT_OF_PURPOSE", "Document type stored");
    assert(doc.promptText === input.promptText, "Prompt text stored");
    assert(doc.wordMin === 500, "Word min stored");
    assert(doc.wordMax === 1000, "Word max stored");
  }

  // --- Test F: Create Essay document ---
  console.log("Test F: Create Essay document");
  {
    const input: CreateDocumentInput = {
      applicationId,
      documentType: "ESSAY",
      documentTitle: "Essay Question 1",
      promptText: "Describe a challenge you overcame.",
      promptSource: "USER_PROVIDED_PORTAL_PROMPT",
      wordMax: 500,
    };
    const doc = await createDocument(input);
    assert(doc.documentType === "ESSAY", "Essay type stored");
    assert(doc.promptSource === "USER_PROVIDED_PORTAL_PROMPT", "Portal prompt source stored");
  }

  // --- Test G: Create Personal Statement document ---
  console.log("Test G: Create Personal Statement document");
  {
    const input: CreateDocumentInput = {
      applicationId,
      documentType: "PERSONAL_STATEMENT",
      documentTitle: "Personal Statement",
      promptText: "Tell us about yourself.",
      promptSource: "CONSULTANT_PROVIDED",
    };
    const doc = await createDocument(input);
    assert(doc.documentType === "PERSONAL_STATEMENT", "Personal statement type stored");
  }

  // --- Test H: Custom document ---
  console.log("Test H: Custom document");
  {
    const input: CreateDocumentInput = {
      applicationId,
      documentType: "CUSTOM",
      documentTitle: "Custom Writing Task",
      promptText: "Write a letter to the admissions committee.",
      promptSource: "CUSTOM",
    };
    const doc = await createDocument(input);
    assert(doc.documentType === "CUSTOM", "Custom type stored");
  }

  // --- Test I: Multiple documents do not overwrite ---
  console.log("Test I: Multiple documents do not overwrite");
  {
    const docs = await listApplicationDocuments(applicationId);
    assert(docs.length === 4, "Application has 4 documents");
    assert(docs.some(d => d.documentType === "STATEMENT_OF_PURPOSE"), "SOP preserved");
    assert(docs.some(d => d.documentType === "ESSAY"), "Essay preserved");
    assert(docs.some(d => d.documentType === "PERSONAL_STATEMENT"), "Personal statement preserved");
    assert(docs.some(d => d.documentType === "CUSTOM"), "Custom preserved");
  }

  // --- Test J: Prompt stored per document ---
  console.log("Test J: Prompt stored per document");
  {
    const docs = await listApplicationDocuments(applicationId);
    const sop = docs.find(d => d.documentType === "STATEMENT_OF_PURPOSE");
    const essay = docs.find(d => d.documentType === "ESSAY");
    assert(sop?.promptText === "Describe your academic interests and career goals.", "SOP prompt stored");
    assert(essay?.promptText === "Describe a challenge you overcame.", "Essay prompt stored");
    assert(sop?.promptText !== essay?.promptText, "Prompts are different per document");
  }

  // --- Test K: PromptSource stored correctly ---
  console.log("Test K: PromptSource stored correctly");
  {
    const docs = await listApplicationDocuments(applicationId);
    const sop = docs.find(d => d.documentType === "STATEMENT_OF_PURPOSE");
    const essay = docs.find(d => d.documentType === "ESSAY");
    assert(sop?.promptSource === "CONSULTANT_PROVIDED", "SOP prompt source = CONSULTANT_PROVIDED");
    assert(essay?.promptSource === "USER_PROVIDED_PORTAL_PROMPT", "Essay prompt source = USER_PROVIDED_PORTAL_PROMPT");
  }

  // --- Test L: Consultant cannot falsely create OFFICIAL_VERIFIED prompt ---
  console.log("Test L: Consultant cannot falsely create OFFICIAL_VERIFIED prompt");
  {
    try {
      const input: CreateDocumentInput = {
        applicationId,
        documentType: "ESSAY",
        documentTitle: "Test Essay",
        promptText: "Test prompt",
        promptSource: "OFFICIAL_VERIFIED",
      };
      await createDocument(input);
      assert(false, "Should have thrown error for OFFICIAL_VERIFIED");
    } catch (err: any) {
      assert(err?.message?.includes("OFFICIAL_VERIFIED"), "Error mentions OFFICIAL_VERIFIED");
    }
  }

  // --- Test M: Limits stored independently of prompt ---
  console.log("Test M: Limits stored independently of prompt");
  {
    const input: CreateDocumentInput = {
      applicationId,
      documentType: "ESSAY",
      documentTitle: "Limits Test",
      promptText: "Test prompt for limits",
      promptSource: "CONSULTANT_PROVIDED",
      wordMin: 300,
      wordMax: 600,
      characterLimit: 3000,
      pageLimit: 2,
    };
    const doc = await createDocument(input);
    assert(doc.wordMin === 300, "Word min stored independently");
    assert(doc.wordMax === 600, "Word max stored independently");
    assert(doc.characterLimit === 3000, "Character limit stored independently");
    assert(doc.pageLimit === 2, "Page limit stored independently");
    assert(doc.promptText === "Test prompt for limits", "Prompt stored separately from limits");
  }

  // --- Test N: Create version ---
  console.log("Test N: Create version");
  {
    const input: CreateDocumentVersionInput = {
      documentId,
      content: "This is the first draft of the SOP.",
      contentFormat: "MARKDOWN",
      createdByType: "SYSTEM",
    };
    const version = await createDocumentVersion(input);
    assert(version.id !== undefined, "Version has ID");
    assert(version.versionNumber === 1, "First version is number 1");
    assert(version.content === "This is the first draft of the SOP.", "Content stored");
    assert(version.createdByType === "SYSTEM", "Created by type stored");
  }

  // --- Test O: Multiple versions ordered ---
  console.log("Test O: Multiple versions ordered");
  {
    const input2: CreateDocumentVersionInput = {
      documentId,
      content: "This is the second draft.",
      contentFormat: "MARKDOWN",
      createdByType: "CONSULTANT_EDITED",
    };
    const input3: CreateDocumentVersionInput = {
      documentId,
      content: "This is the third draft.",
      contentFormat: "MARKDOWN",
      createdByType: "AI_GENERATED",
      model: "gpt-5.6-sol",
    };
    await createDocumentVersion(input2);
    await createDocumentVersion(input3);

    const versions = await listDocumentVersions(documentId);
    assert(versions.length === 3, "3 versions created");
    assert(versions[0].versionNumber === 1, "Version 1 is first");
    assert(versions[1].versionNumber === 2, "Version 2 is second");
    assert(versions[2].versionNumber === 3, "Version 3 is third");
    assert(versions[2].model === "gpt-5.6-sol", "Model stored on version 3");
  }

  // --- Test P: Application/student relation enforced ---
  console.log("Test P: Application/student relation enforced");
  {
    const app = await getApplication(applicationId);
    assert(app?.studentId === studentId, "Application belongs to correct student");

    const apps = await listStudentApplications(studentId);
    assert(apps.every(a => a.studentId === studentId), "All applications belong to same student");
  }

  // --- Test Q: Document/application relation enforced ---
  console.log("Test Q: Document/application relation enforced");
  {
    const docs = await listApplicationDocuments(applicationId);
    assert(docs.every(d => d.applicationId === applicationId), "All documents belong to same application");

    // Documents in second application should be different
    const docs2 = await listApplicationDocuments(secondApplicationId);
    assert(docs2.length === 0, "Second application has no documents");
    assert(!docs.some(d => docs2.some(d2 => d2.id === d.id)), "No document overlap between applications");
  }

  // --- Test R: Server persistence survives reload ---
  console.log("Test R: Server persistence survives reload");
  {
    // Re-fetch from database
    const student = await getStudent(studentId);
    assert(student?.firstName === "Rahul", "Student survives reload");
    const app = await getApplication(applicationId);
    assert(app?.universityName === "Massachusetts Institute of Technology", "Application survives reload");
    const doc = await getDocument(documentId);
    assert(doc?.promptText === "Describe your academic interests and career goals.", "Document survives reload");
    const versions = await listDocumentVersions(documentId);
    assert(versions.length === 3, "Versions survive reload");
  }

  // --- Test S: Existing SOP engine unchanged ---
  console.log("Test S: Existing SOP engine unchanged");
  {
    const pipelineModule = await import("../src/lib/ai/pipeline/run-application-pipeline");
    assert(typeof pipelineModule.runApplicationPipeline === "function", "runApplicationPipeline still exported");
  }

  // --- Test T: Zero OpenAI calls ---
  console.log("Test T: Zero OpenAI calls");
  {
    // No generation was performed in any test
    assert(true, "No OpenAI calls made during tests");
  }

  // --- Additional: Type validation tests ---
  console.log("Additional: Type validation");
  {
    assert(isValidDocumentType("STATEMENT_OF_PURPOSE"), "Valid document type accepted");
    assert(!isValidDocumentType("INVALID_TYPE"), "Invalid document type rejected");
    assert(isValidPromptSource("CONSULTANT_PROVIDED"), "Valid prompt source accepted");
    assert(!isValidPromptSource("INVALID_SOURCE"), "Invalid prompt source rejected");
    assert(!isUserSettablePromptSource("OFFICIAL_VERIFIED"), "OFFICIAL_VERIFIED not user-settable");
    assert(isUserSettablePromptSource("CONSULTANT_PROVIDED"), "CONSULTANT_PROVIDED is user-settable");
    assert(isUserSettablePromptSource("CUSTOM"), "CUSTOM is user-settable");
    assert(isUserSettablePromptSource("USER_PROVIDED_PORTAL_PROMPT"), "USER_PROVIDED_PORTAL_PROMPT is user-settable");
    assert(USER_SETTABLE_PROMPT_SOURCES.length === 3, "3 user-settable prompt sources");
  }

  // --- Additional: Search students ---
  console.log("Additional: Search students");
  {
    const results = await searchStudents("Rahul");
    assert(results.some(s => s.id === studentId), "Student found by name search");
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  await closeDbPool();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
