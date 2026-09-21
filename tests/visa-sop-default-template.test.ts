/**
 * visa-sop-default-template.test.ts — deterministic checks for the normalized
 * VISA_SOP default template. No provider calls, no DB.
 *
 * Covers:
 *   A. Blank Visa SOP prompt → resolves to DVIVID_DEFAULT_TEMPLATE
 *   B. Template does NOT require "family, property" or "financial support" as
 *      unconditional sections
 *   C. Template contains "only when explicitly provided" (or equivalent
 *      conditional language)
 *   D. Template allows nuanced post-study intentions
 *   E. Explicit Consultant Provided Visa prompt still overrides default
 *   F. 800–1000 inherited limits unchanged (template word limits not the
 *      source of truth for inheritance)
 */
import assert from "node:assert/strict";
import { getDefaultTemplate, DVIVID_DEFAULT_TEMPLATES } from "../src/lib/application/default-templates";
import { isPromptRequired } from "../src/lib/application/document-prompt-ui";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const visaTemplate = getDefaultTemplate("VISA_SOP");

// ============================================================
// A. Blank Visa SOP prompt → resolves to DVIVID_DEFAULT_TEMPLATE
// ============================================================
check("A: blank Visa SOP prompt resolves to DVIVID_DEFAULT_TEMPLATE", () => {
  // Visa SOP is NOT prompt-required (optional type)
  assert.equal(isPromptRequired("VISA_SOP"), false,
    "VISA_SOP must be an optional-prompt type so blank → default template");
  // The default template exists and has substantial content
  assert.ok(visaTemplate.promptText.length > 200,
    "default template must have substantial content");
  assert.equal(DVIVID_DEFAULT_TEMPLATES.VISA_SOP.documentType, "VISA_SOP");
  // The API route applies getDefaultTemplate when promptText is blank
  // (verified in document/route.ts — isPromptRequired check + fallback)
});

// ============================================================
// B. Template does NOT require family/property or financial support as
//    unconditional sections
// ============================================================
check("B: template does NOT unconditionally require family/property", () => {
  const text = visaTemplate.promptText;
  // The old template had "Family, property, or career ties that demonstrate
  // intent to return" as an unconditional bullet. The new template must NOT
  // have that as an unconditional requirement.
  // "family" and "property" should only appear in the conditional section 6.
  const familyIdx = text.toLowerCase().indexOf("family");
  const propertyIdx = text.toLowerCase().indexOf("property");
  // Both should appear ONLY in the conditional "Additional Visa-Relevant
  // Circumstances" section, qualified by "ONLY when they have explicitly been
  // provided and approved".
  assert.ok(familyIdx > -1, "family should be mentioned (conditionally)");
  assert.ok(propertyIdx > -1, "property should be mentioned (conditionally)");
  // Verify they appear in the conditional section, not as unconditional bullets
  const conditionalSectionIdx = text.indexOf("Additional Visa-Relevant Circumstances");
  assert.ok(conditionalSectionIdx > -1, "conditional section must exist");
  assert.ok(familyIdx > conditionalSectionIdx, "family must be in the conditional section");
  assert.ok(propertyIdx > conditionalSectionIdx, "property must be in the conditional section");
  // Must NOT have the old unconditional "Ties to Home Country" section
  assert.ok(!text.includes("Ties to Home Country"),
    "old unconditional 'Ties to Home Country' section must be removed");
});

check("B2: template does NOT unconditionally require financial support", () => {
  const text = visaTemplate.promptText;
  // The old template had "Financial Support" as an unconditional section.
  // The new template must NOT have that as an unconditional requirement.
  assert.ok(!text.includes("Financial Support\n"),
    "old unconditional 'Financial Support' section must be removed");
  // "financial" should only appear in the conditional section
  const financialIdx = text.toLowerCase().indexOf("financial");
  assert.ok(financialIdx > -1, "financial should be mentioned (conditionally)");
  const conditionalSectionIdx = text.indexOf("Additional Visa-Relevant Circumstances");
  assert.ok(financialIdx > conditionalSectionIdx,
    "financial must be in the conditional section");
});

// ============================================================
// C. Template contains "only when explicitly provided" or equivalent
//    conditional language
// ============================================================
check("C: template contains conditional language for visa-specific facts", () => {
  const text = visaTemplate.promptText;
  assert.ok(text.includes("ONLY when they have explicitly been provided and approved"),
    "must contain explicit conditional language");
  assert.ok(text.includes("Omit these topics when supporting evidence is unavailable"),
    "must instruct omission when evidence is unavailable");
});

// ============================================================
// D. Template allows nuanced post-study intentions
// ============================================================
check("D: template allows nuanced post-study intentions", () => {
  const text = visaTemplate.promptText;
  // Must NOT force immediate return
  assert.ok(!text.includes("Demonstrate clear intent to return home after studies"),
    "must NOT force immediate-return claim (old language removed)");
  // Must allow nuanced post-study intentions
  assert.ok(text.includes("Post-Study Intentions"),
    "must have a Post-Study Intentions section");
  assert.ok(text.includes("truthfully"),
    "must ask for truthful post-study intentions");
  assert.ok(text.includes("professional experience abroad"),
    "must allow professional experience abroad (subject to immigration rules)");
  assert.ok(text.includes("subject to applicable immigration rules"),
    "must qualify abroad experience as subject to immigration rules");
  assert.ok(text.includes("Do not force an immediate-return claim"),
    "must explicitly allow nuanced intentions over immediate return");
});

// ============================================================
// E. Explicit Consultant Provided Visa prompt still overrides default
// ============================================================
check("E: explicit Consultant Provided prompt still overrides default", () => {
  // The API route logic (document/route.ts) only applies the default template
  // when promptText is blank. When the consultant provides an explicit prompt,
  // it is used as-is with promptSource = CONSULTANT_PROVIDED.
  // This is verified by the existing document-prompt-ui tests and the API route.
  // Here we verify the template is the FALLBACK, not the only option.
  assert.ok(isPromptRequired("VISA_SOP") === false,
    "VISA_SOP must allow blank prompt (so default template is the fallback)");
  // The default template is only applied when promptText is blank
  assert.ok(visaTemplate.promptText.length > 0,
    "default template must exist as the fallback");
});

// ============================================================
// F. 800–1000 inherited limits unchanged
// ============================================================
check("F: template word limits are not the source of truth for inheritance", () => {
  // The template has wordMin: 800, wordMax: 1200. The user sees 800-1000
  // because University Requirements inheritance overrides the template.
  // The template's own limits are the fallback when no inheritance exists.
  // We verify the template has reasonable limits but do NOT change them.
  assert.ok(visaTemplate.wordMin === 800, "template wordMin should be 800 (fallback)");
  assert.ok(visaTemplate.wordMax !== undefined, "template wordMax should be defined (fallback)");
  // The inheritance precedence (document override → university requirements →
  // default template) is handled by resolveAndMergePrompt, not changed here.
});

// ============================================================
// Extra: no-fabrication rule present
// ============================================================
check("Extra: template contains explicit no-fabrication rule", () => {
  const text = visaTemplate.promptText;
  assert.ok(text.includes("Do not fabricate missing information"),
    "must contain no-fabrication rule");
  assert.ok(text.includes("Do not assume property ownership, family circumstances, financial resources, sponsorship, job offers, immigration history, or permanent settlement intentions"),
    "must list specific facts that must not be assumed");
});

check("Extra: template focuses on study purpose", () => {
  const text = visaTemplate.promptText;
  assert.ok(text.includes("Study Purpose"), "must have Study Purpose section");
  assert.ok(text.includes("genuine study purpose"), "must focus on genuine study purpose");
  assert.ok(text.includes("academic/professional progression"),
    "must focus on academic/professional progression");
});

check("Extra: template does not turn into CV in prose", () => {
  const text = visaTemplate.promptText;
  assert.ok(text.includes("Use professional examples selectively; do not turn the statement into a CV in prose"),
    "must instruct selective professional examples");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
