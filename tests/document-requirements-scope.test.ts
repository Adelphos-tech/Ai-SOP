/**
 * document-requirements-scope.test.ts — deterministic checks that document
 * writing requirements are correctly scoped per-document and that new
 * documents do NOT inherit ambiguous legacy application-level requirements.
 *
 * No provider calls, no DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAndMergePrompt } from "../src/lib/application/generation-context";
import { getDefaultTemplate } from "../src/lib/application/default-templates";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const repoRoot = resolve(import.meta.dirname, "..");
const readFile = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf-8");

// Legacy application-level requirements (the kind that used to bleed)
const legacyUniReqs = {
  promptText: "OLD SOP PROMPT",
  wordMin: 850,
  wordMax: 1000,
  characterLimit: 5000,
  pageLimit: 2,
  mandatoryTopics: "Research methodology\nAcademic ethics",
  specificQuestions: "Why this university?\nDescribe your research.",
  formattingRules: "12pt, double-spaced",
};

// ============================================================
// 1. Application intake no longer asks document prompt
// ============================================================
check("1: intake does NOT collect document prompt", () => {
  const intake = readFile("src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx");
  const section8 = intake.substring(intake.indexOf("SECTION 8"));
  // Must NOT have the document prompt field
  assert.ok(!section8.includes('name="universityRequirements.promptText"'),
    "intake Section 8 must NOT collect universityRequirements.promptText");
  assert.ok(!section8.includes('name="universityRequirements.wordMin"'),
    "intake Section 8 must NOT collect wordMin");
  assert.ok(!section8.includes('name="universityRequirements.mandatoryTopics"'),
    "intake Section 8 must NOT collect mandatoryTopics");
});

// ============================================================
// 2. Application intake no longer asks document word/page limits
// ============================================================
check("2: intake does NOT collect document word/page limits", () => {
  const intake = readFile("src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx");
  const section8 = intake.substring(intake.indexOf("SECTION 8"));
  assert.ok(!section8.includes('name="universityRequirements.wordMax"'),
    "must NOT collect wordMax");
  assert.ok(!section8.includes('name="universityRequirements.characterLimit"'),
    "must NOT collect characterLimit");
  assert.ok(!section8.includes('name="universityRequirements.pageLimit"'),
    "must NOT collect pageLimit");
  assert.ok(!section8.includes('name="universityRequirements.formattingRules"'),
    "must NOT collect formattingRules");
});

// ============================================================
// 3. Add Document form contains all document requirement fields
// ============================================================
check("3: Add Document form has all requirement fields", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  assert.ok(page.includes("mandatoryTopics"), "must have mandatoryTopics state");
  assert.ok(page.includes("additionalQuestions"), "must have additionalQuestions state");
  assert.ok(page.includes("formattingInstructions"), "must have formattingInstructions state");
  assert.ok(page.includes("Mandatory Topics"), "must have Mandatory Topics UI label");
  assert.ok(page.includes("Additional / Specific Questions"), "must have Additional Questions UI label");
  assert.ok(page.includes("Formatting Rules"), "must have Formatting Rules UI label");
  // Must pass these to the API
  assert.ok(page.includes("mandatoryTopics,"), "must send mandatoryTopics to API");
  assert.ok(page.includes("additionalQuestions,"), "must send additionalQuestions to API");
  assert.ok(page.includes("formattingInstructions,"), "must send formattingInstructions to API");
});

// ============================================================
// 4. NEW Visa SOP does NOT inherit legacy SOP prompt
// ============================================================
check("4: new Visa SOP does NOT inherit legacy SOP prompt", () => {
  const newVisaDoc = {
    documentType: "VISA_SOP",
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
    promptText: "", // blank — should resolve to default
    useLegacyRequirements: false, // NEW document
  };
  const resolved = resolveAndMergePrompt(newVisaDoc, null, legacyUniReqs);
  assert.ok(resolved.promptText.includes("Study Purpose"),
    "new Visa SOP must resolve to current default template, not legacy prompt");
  assert.ok(!resolved.promptText.includes("OLD SOP PROMPT"),
    "new Visa SOP must NOT contain legacy SOP prompt");
});

// ============================================================
// 5. NEW Visa SOP does NOT inherit legacy SOP word limits
// ============================================================
check("5: new Visa SOP does NOT inherit legacy word limits", () => {
  const newVisaDoc = {
    documentType: "VISA_SOP",
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
    promptText: "",
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(newVisaDoc, null, legacyUniReqs);
  // Should resolve to default template limits, NOT legacy 850-1000
  const template = getDefaultTemplate("VISA_SOP");
  assert.ok(resolved.wordMin === template.wordMin,
    `new Visa SOP wordMin should be ${template.wordMin} (default), not ${legacyUniReqs.wordMin} (legacy)`);
  assert.ok(resolved.wordMax === template.wordMax,
    `new Visa SOP wordMax should be ${template.wordMax} (default), not ${legacyUniReqs.wordMax} (legacy)`);
});

// ============================================================
// 6. NEW Visa SOP does NOT inherit legacy topics/questions
// ============================================================
check("6: new Visa SOP does NOT inherit legacy topics/questions", () => {
  const newVisaDoc = {
    documentType: "VISA_SOP",
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
    promptText: "",
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(newVisaDoc, null, legacyUniReqs);
  assert.ok(!resolved.requiredTopics || resolved.requiredTopics.length === 0,
    "new Visa SOP must NOT inherit legacy mandatory topics");
  assert.ok(!resolved.additionalQuestions || resolved.additionalQuestions.length === 0,
    "new Visa SOP must NOT inherit legacy specific questions");
});

// ============================================================
// 7. LEGACY document DOES inherit from universityRequirements
// ============================================================
check("7: legacy document DOES inherit from universityRequirements", () => {
  const legacyDoc = {
    documentType: "SOP",
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
    promptText: "",
    useLegacyRequirements: true, // LEGACY document
  };
  const resolved = resolveAndMergePrompt(legacyDoc, null, legacyUniReqs);
  // Legacy docs should still inherit word limits from universityRequirements
  assert.ok(resolved.wordMin === 850,
    `legacy doc should inherit wordMin=850, got ${resolved.wordMin}`);
  assert.ok(resolved.wordMax === 1000,
    `legacy doc should inherit wordMax=1000, got ${resolved.wordMax}`);
});

// ============================================================
// 8. NEW document with explicit prompt keeps its own values
// ============================================================
check("8: new SOP with explicit prompt keeps its own values", () => {
  const newSopDoc = {
    documentType: "SOP",
    promptSource: "CONSULTANT_PROVIDED",
    promptText: "NEW SOP PROMPT",
    wordMin: 900,
    wordMax: 1100,
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(newSopDoc, null, legacyUniReqs);
  assert.equal(resolved.promptText, "NEW SOP PROMPT");
  assert.equal(resolved.wordMin, 900);
  assert.equal(resolved.wordMax, 1100);
  assert.ok(!resolved.promptText.includes("OLD SOP PROMPT"),
    "must NOT contain legacy prompt");
});

// ============================================================
// 9. Two essays with different requirements are isolated
// ============================================================
check("9: two essays with different requirements are isolated", () => {
  const essay1 = {
    documentType: "ESSAY",
    promptSource: "CONSULTANT_PROVIDED",
    promptText: "Describe leadership",
    wordMax: 500,
    useLegacyRequirements: false,
  };
  const essay2 = {
    documentType: "ESSAY",
    promptSource: "CONSULTANT_PROVIDED",
    promptText: "Describe a challenge",
    wordMax: 300,
    useLegacyRequirements: false,
  };
  const r1 = resolveAndMergePrompt(essay1, null, legacyUniReqs);
  const r2 = resolveAndMergePrompt(essay2, null, legacyUniReqs);
  assert.equal(r1.promptText, "Describe leadership");
  assert.equal(r1.wordMax, 500);
  assert.equal(r2.promptText, "Describe a challenge");
  assert.equal(r2.wordMax, 300);
  assert.notEqual(r1.promptText, r2.promptText);
  assert.notEqual(r1.wordMax, r2.wordMax);
});

// ============================================================
// 10. Document-scoped topics are used for NEW documents
// ============================================================
check("10: document-scoped topics are used for NEW documents", () => {
  const newDoc = {
    documentType: "SOP",
    promptSource: "CONSULTANT_PROVIDED",
    promptText: "Write an SOP",
    mandatoryTopics: "Innovation\nTeamwork",
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(newDoc, null, legacyUniReqs);
  assert.ok(resolved.requiredTopics,
    "must have requiredTopics from document");
  assert.ok(resolved.requiredTopics!.includes("Innovation"),
    "must include document-scoped topic 'Innovation'");
  assert.ok(resolved.requiredTopics!.includes("Teamwork"),
    "must include document-scoped topic 'Teamwork'");
  assert.ok(!resolved.requiredTopics!.includes("Research methodology"),
    "must NOT include legacy topic 'Research methodology'");
});

// ============================================================
// 11. Default template re-resolution preserved
// ============================================================
check("11: DVIVID_DEFAULT_TEMPLATE re-resolves current template", () => {
  const doc = {
    documentType: "VISA_SOP",
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
    promptText: "OLD TEMPLATE SNAPSHOT", // persisted old text
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(doc, null, null);
  const currentTemplate = getDefaultTemplate("VISA_SOP");
  assert.equal(resolved.promptText, currentTemplate.promptText,
    "must resolve to CURRENT default template, not persisted snapshot");
  assert.ok(resolved.promptText.includes("Study Purpose"),
    "must contain current template sections");
});

// ============================================================
// 12. Explicit document prompt remains persistent
// ============================================================
check("12: explicit consultant prompt remains persistent", () => {
  const doc = {
    documentType: "SOP",
    promptSource: "CONSULTANT_PROVIDED",
    promptText: "Write about your journey",
    useLegacyRequirements: false,
  };
  const resolved = resolveAndMergePrompt(doc, null, legacyUniReqs);
  assert.equal(resolved.promptText, "Write about your journey",
    "explicit prompt must be preserved");
  assert.equal(resolved.promptSource, "CONSULTANT_PROVIDED",
    "prompt source must remain CONSULTANT_PROVIDED");
});

// ============================================================
// 13. No generation triggered by document creation
// ============================================================
check("13: document creation API does NOT trigger generation", () => {
  const route = readFile("src/app/api/application/document/route.ts");
  // The create route should NOT call any generation/pipeline function
  assert.ok(!route.includes("runApplicationPipeline"),
    "create route must NOT call runApplicationPipeline");
  assert.ok(!route.includes("generateDocument"),
    "create route must NOT call generateDocument");
  assert.ok(!route.includes("/api/application/generate"),
    "create route must NOT call generate API");
});

// ============================================================
// 14. DB schema has new columns
// ============================================================
check("14: DB schema has mandatory_topics, additional_questions, use_legacy_requirements", () => {
  const schema = readFile("src/lib/application/schema.ts");
  assert.ok(schema.includes("mandatory_topics TEXT"),
    "schema must have mandatory_topics column");
  assert.ok(schema.includes("additional_questions TEXT"),
    "schema must have additional_questions column");
  assert.ok(schema.includes("use_legacy_requirements BOOLEAN"),
    "schema must have use_legacy_requirements column");
});

// ============================================================
// 15. Migration marks existing docs as legacy
// ============================================================
check("15: migration marks existing documents as legacy", () => {
  const migration = readFile("migrations/2026-09-21-document-requirements-scope.sql");
  assert.ok(migration.includes("use_legacy_requirements = TRUE"),
    "migration must set existing documents to use_legacy_requirements=TRUE");
  assert.ok(migration.includes("UPDATE application_documents"),
    "migration must UPDATE existing documents");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
