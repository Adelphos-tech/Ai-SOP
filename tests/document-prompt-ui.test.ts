/**
 * document-prompt-ui.test.ts — deterministic checks for the per-document-type
 * prompt UI config. No provider calls, no DB.
 */
import assert from "node:assert/strict";
import {
  DOCUMENT_PROMPT_UI_CONFIG,
  getDocumentPromptUi,
  isPromptRequired,
} from "../src/lib/application/document-prompt-ui";
import { DOCUMENT_TYPE_OPTIONS, DocumentType } from "../src/lib/application/application-types";
import { getDefaultTemplate } from "../src/lib/application/default-templates";

const ALL_TYPES: DocumentType[] = DOCUMENT_TYPE_OPTIONS.map(o => o.value);
let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

// Every canonical type covered
check("config covers every DocumentType", () => {
  for (const t of ALL_TYPES) {
    const c = DOCUMENT_PROMPT_UI_CONFIG[t];
    assert.ok(c, `missing config for ${t}`);
    assert.ok(c.label.length > 3);
    assert.ok(c.placeholder.length > 10);
    assert.equal(typeof c.required, "boolean");
  }
});

// Required matrix per spec
check("required matrix", () => {
  assert.equal(isPromptRequired("STATEMENT_OF_PURPOSE"), true);
  assert.equal(isPromptRequired("ESSAY"), true);
  assert.equal(isPromptRequired("SUPPLEMENTAL_QUESTION"), true);
  assert.equal(isPromptRequired("CUSTOM"), true);
  assert.equal(isPromptRequired("VISA_SOP"), false);
  assert.equal(isPromptRequired("COVER_LETTER"), false);
  assert.equal(isPromptRequired("LETTER_OF_RECOMMENDATION"), false);
  assert.equal(isPromptRequired("LETTER_OF_MOTIVATION"), false);
  assert.equal(isPromptRequired("PERSONAL_STATEMENT"), false);
  assert.equal(isPromptRequired("STATEMENT_OF_ACADEMIC_PURPOSE"), false);
  assert.equal(isPromptRequired("MOA"), false);
});

// Spec labels
check("spec labels", () => {
  assert.equal(getDocumentPromptUi("STATEMENT_OF_PURPOSE").label, "University / Application Prompt");
  assert.equal(getDocumentPromptUi("VISA_SOP").label, "Visa / Embassy Prompt");
  assert.equal(getDocumentPromptUi("LETTER_OF_RECOMMENDATION").label, "Recommendation Prompt / Instructions");
  assert.equal(getDocumentPromptUi("LETTER_OF_MOTIVATION").label, "Motivation Letter Prompt");
  assert.equal(getDocumentPromptUi("PERSONAL_STATEMENT").label, "Personal Statement Prompt");
  assert.equal(getDocumentPromptUi("STATEMENT_OF_ACADEMIC_PURPOSE").label, "Academic Purpose Prompt");
  assert.equal(getDocumentPromptUi("ESSAY").label, "Essay Question / Prompt");
  assert.equal(getDocumentPromptUi("SUPPLEMENTAL_QUESTION").label, "Supplemental Question");
  assert.equal(getDocumentPromptUi("COVER_LETTER").label, "Job / Employer Requirements");
  assert.equal(getDocumentPromptUi("CUSTOM").label, "Document Prompt / Instructions");
});

// Visa SOP: no university lookup actions (backend only searches university sources)
check("non-university types hide lookup", () => {
  for (const t of ["VISA_SOP", "COVER_LETTER", "CUSTOM"] as DocumentType[]) {
    const c = getDocumentPromptUi(t);
    assert.equal(c.primaryLookupLabel, null, `${t} should hide university lookup`);
    assert.equal(c.secondaryLookupLabel, null, `${t} should hide discovery lookup`);
  }
  // university-oriented types keep it
  for (const t of ["STATEMENT_OF_PURPOSE", "ESSAY", "LETTER_OF_RECOMMENDATION"] as DocumentType[]) {
    assert.ok(getDocumentPromptUi(t).primaryLookupLabel, `${t} should keep university lookup`);
  }
});

// Blank-prompt server path: optional type → default template exists
check("every optional type has a default template for blank-prompt create", () => {
  for (const t of ALL_TYPES) {
    if (!isPromptRequired(t)) {
      const tpl = getDefaultTemplate(t);
      assert.ok(tpl.promptText.length > 20, `${t} missing usable default template`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
