/**
 * @file narrative-profile-visa-tests.ts
 * @description
 * Deterministic tests for the VISA_SOP conditional return-home
 * requirement and A+B default-enablement. No OpenAI calls.
 *
 *   A. VISA + supported return-home evidence -> requirement injected
 *   B. VISA + no return evidence -> nothing fabricated
 *   C. Required Visa content survives contract/finalizer action planning
 *   D. SOP / PS / LOR behavior unchanged
 *   E. A+B flags default ON, DISABLE_* rollback works
 */

import { closeDbPool, assertTestDatabase } from "./test-setup";
import {
  resolveNarrativeProfile,
  detectReturnHomeEvidence,
  applyVisaReturnHomeRequirement,
  getNarrativeProfile,
  VISA_RETURN_HOME_TOPIC,
} from "../src/lib/application/narrative-profile";
import { checkMandatoryTopicEvidence } from "../src/lib/requirements/generation-gate";
import { buildGenericQualityReviewerPrompt } from "../src/lib/ai/prompts/generic/quality-reviewer";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS: ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

const mkRC = () => ({
  componentId: "RC-DOC",
  label: "Visa SOP",
  exactPrompt: "Why do you wish to study abroad?",
  pageLimit: { type: "PER_DOCUMENT" as const, maxPages: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
  wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
  characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
  requiredTopics: [] as any[],
  sourceId: "document",
  status: "MANUAL",
  verifiedAt: "",
});

const profileWithReturn = {
  careerGoals: {
    returnPlans: "I plan to return to India after graduation to work in its AI industry.",
    returnHomeCountry: "",
  },
  careerGoalsStructured: { longTerm: { homeCountryPlans: "" } },
};

const profileNothing = {
  careerGoals: { returnPlans: "", returnHomeCountry: "" },
  careerGoalsStructured: { longTerm: { homeCountryPlans: "nothing" } },
};

const profileVisionReturn = {
  careerGoals: {},
  careerGoalsStructured: {
    longTerm: { vision: "In 10 years I want to return to India and lead an AI research lab." },
  },
};

async function runTests() {
  await assertTestDatabase();
  console.log("=== Narrative Profile Visa Return-Home Tests ===\n");

  // ---- A: supported evidence -> requirement injected ----
  console.log("--- A: VISA + supported evidence ---");
  assert(detectReturnHomeEvidence(profileWithReturn) === true, "A1: returnPlans detected as supported evidence");
  assert(detectReturnHomeEvidence(profileVisionReturn) === true, "A2: return-home vision text detected");
  const rA = resolveNarrativeProfile("VISA_SOP", profileWithReturn);
  assert(rA.returnHomeRequired === true, "A3: VISA profile marks return-home REQUIRED");
  assert(rA.profile.requireReturnHomeLogic === true, "A4: requireReturnHomeLogic=true");
  assert(rA.profile.writerRules.some(r => r.includes("REQUIRED")), "A5: writer rule marks return-home REQUIRED");
  assert(rA.profile.plannerRules.some(r => r.includes("REQUIRED")), "A6: planner rule marks return-home REQUIRED");

  const rcA = [mkRC()];
  applyVisaReturnHomeRequirement(rcA as any);
  assert(rcA[0].requiredTopics.some(t => t.topic === VISA_RETURN_HOME_TOPIC), "A7: return-home topic injected into response component");
  assert(rcA[0].requiredTopics[0].status === "RECOMMENDED", "A8: injected topic status is RECOMMENDED (non-mandatory)");
  applyVisaReturnHomeRequirement(rcA as any);
  assert(rcA[0].requiredTopics.length === 1, "A9: injection is idempotent — no duplicate topic");

  // ---- B: no evidence -> nothing fabricated ----
  console.log("--- B: VISA + no return evidence ---");
  assert(detectReturnHomeEvidence(profileNothing) === false, "B1: homeCountryPlans='nothing' is NOT supported evidence");
  assert(detectReturnHomeEvidence({ careerGoals: { returnPlans: "n/a" } }) === false, "B2: 'n/a' is NOT supported evidence");
  assert(detectReturnHomeEvidence({}) === false, "B3: empty profile -> no return evidence");
  assert(detectReturnHomeEvidence(null) === false, "B4: null profile -> no return evidence");
  const rB = resolveNarrativeProfile("VISA_SOP", profileNothing);
  assert(rB.returnHomeRequired === false, "B5: no requirement injected without evidence");
  assert(rB.profile.requireReturnHomeLogic === false, "B6: requireReturnHomeLogic=false");
  assert(rB.profile.writerRules.some(r => r.includes("Do NOT include a return-home")), "B7: writer explicitly forbidden from inventing return-home");

  // ---- C: required content survives contract + finalizer planning ----
  console.log("--- C: contract/finalizer visibility ---");
  // The topic reaches the contract's responseComponents (same array as
  // pipeline input) and flows to the finalizer's requiredTopics list.
  const rcC = [mkRC()];
  applyVisaReturnHomeRequirement(rcC as any);
  const fakeContract: any = { responseComponents: rcC };
  const gate = checkMandatoryTopicEvidence(fakeContract, { allEntries: [] } as any);
  const eval_ = gate.topicEvaluations.find(t => t.topic === VISA_RETURN_HOME_TOPIC);
  assert(!!eval_, "C1: topic visible to mandatory-topic gate evaluation");
  assert(eval_?.status === "NOT_APPLICABLE", "C2: RECOMMENDED topic is NOT_APPLICABLE — gate never blocks on it");
  assert(gate.blockingIssues.length === 0, "C3: no blocking issues from injected topic");
  assert(rcC[0].requiredTopics[0].topic === VISA_RETURN_HOME_TOPIC, "C4: topic persists in component requiredTopics (what Finalizer receives)");

  // ---- D: other document types unchanged ----
  console.log("--- D: other types unchanged ---");
  for (const dt of ["STATEMENT_OF_PURPOSE", "PERSONAL_STATEMENT", "LETTER_OF_RECOMMENDATION", "ESSAY", "COVER_LETTER", "SUPPLEMENTAL_QUESTION", "MOA", "CUSTOM"]) {
    const r = resolveNarrativeProfile(dt, profileWithReturn);
    assert(r.returnHomeRequired === false, `D-${dt}: returnHomeRequired=false`);
    assert(r.profile === getNarrativeProfile(dt), `D-${dt}: static profile returned unchanged`);
  }

  // ---- E: default-on + rollback flags ----
  console.log("--- E: flag semantics ---");
  delete process.env.DISABLE_COMPACT_REVIEWS;
  const p = buildGenericQualityReviewerPrompt({ responses: [] }, [mkRC() as any], []);
  assert(p.system.includes("COMPACT OUTPUT RULES"), "E1: compact reviews default ON (no env flag needed)");
  process.env.DISABLE_COMPACT_REVIEWS = "1";
  const p2 = buildGenericQualityReviewerPrompt({ responses: [] }, [mkRC() as any], []);
  assert(!p2.system.includes("COMPACT OUTPUT RULES"), "E2: DISABLE_COMPACT_REVIEWS=1 rolls back");
  delete process.env.DISABLE_COMPACT_REVIEWS;

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  await closeDbPool();
  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch(async e => {
  console.error("FATAL:", e);
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
