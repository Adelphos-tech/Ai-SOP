/**
 * resolved-requirements-display.test.ts — the Review panel must show the
 * same resolved requirement values (and provenance) that the generation
 * contract consumes. Tests the canonical resolveAndMergePrompt directly.
 * No provider calls, no DB.
 */
import assert from "node:assert/strict";
import { resolveAndMergePrompt } from "../src/lib/application/generation-context";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const uniReq = { wordMin: 800, wordMax: 1000, characterLimit: undefined, pageLimit: undefined };

// A. No document overrides → inherited university limits shown + provenance
check("A: inherited 800/1000 shown with University Requirements provenance", () => {
  const m = resolveAndMergePrompt(
    { documentType: "STATEMENT_OF_PURPOSE", promptSource: "CONSULTANT_PROVIDED", promptText: "p" },
    null, uniReq,
  );
  assert.equal(m.wordMin, 800);
  assert.equal(m.wordMax, 1000);
  assert.equal(m.fieldSources?.wordMin, "UNIVERSITY_REQUIREMENTS");
  assert.equal(m.fieldSources?.wordMax, "UNIVERSITY_REQUIREMENTS");
});

// B. Document max override wins; min still inherited
check("B: doc wordMax=900 override wins, min stays inherited", () => {
  const m = resolveAndMergePrompt(
    { documentType: "STATEMENT_OF_PURPOSE", promptSource: "CONSULTANT_PROVIDED", promptText: "p", wordMax: 900 },
    null, uniReq,
  );
  assert.equal(m.wordMin, 800);
  assert.equal(m.wordMax, 900);
  assert.equal(m.fieldSources?.wordMin, "UNIVERSITY_REQUIREMENTS");
  assert.equal(m.fieldSources?.wordMax, "DOCUMENT");
});

// C. Nothing anywhere → undefined → UI renders —
check("C: no page limit anywhere → undefined (renders —)", () => {
  const m = resolveAndMergePrompt(
    { documentType: "STATEMENT_OF_PURPOSE", promptSource: "CONSULTANT_PROVIDED", promptText: "p" },
    null, uniReq,
  );
  assert.equal(m.pageLimit, undefined);
  assert.equal(m.fieldSources?.pageLimit, undefined);
});

// D. Explicit document page limit
check("D: doc pageLimit=2 → 2 Document override", () => {
  const m = resolveAndMergePrompt(
    { documentType: "STATEMENT_OF_PURPOSE", promptSource: "CONSULTANT_PROVIDED", promptText: "p", pageLimit: 2 },
    null, { ...uniReq, pageLimit: 5 },
  );
  assert.equal(m.pageLimit, 2);
  assert.equal(m.fieldSources?.pageLimit, "DOCUMENT");
});

// E. Same resolver feeds generation context — Visa SOP blank-prompt doc
//    (DVIVID_DEFAULT_TEMPLATE) still resolves inherited limits.
check("E: Visa SOP default-template doc inherits 800/1000", () => {
  const m = resolveAndMergePrompt(
    { documentType: "VISA_SOP", promptSource: "DVIVID_DEFAULT_TEMPLATE", promptText: "template text" },
    null, uniReq,
  );
  assert.equal(m.wordMin, 800);
  assert.equal(m.wordMax, 1000);
  assert.equal(m.resolutionPath, "DEFAULT_TEMPLATE");
  assert.equal(m.fieldSources?.wordMin, "UNIVERSITY_REQUIREMENTS");
});

// E2: default template supplies limits when nothing else does
check("E2: no uni, no overrides → D-Vivid default limits + provenance", () => {
  const m = resolveAndMergePrompt(
    { documentType: "VISA_SOP", promptSource: "DVIVID_DEFAULT_TEMPLATE", promptText: "t" },
    null, null,
  );
  assert.ok(m.wordMin && m.wordMin > 0);
  assert.equal(m.fieldSources?.wordMin, "DEFAULT_TEMPLATE");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
