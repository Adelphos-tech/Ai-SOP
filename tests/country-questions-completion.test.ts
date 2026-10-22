/**
 * country-questions-completion.test.ts — PURE UNIT REGRESSION
 *
 * Country Questions (intake section 6) completion when the saved
 * questionnaire has no countryCode but the application has a valid
 * destination country. Exercises the same path as the profile API:
 * resolveApplicationContext → getProfileReadiness. No database.
 */

import {
  calculateIntakeCompletion,
  getProfileReadiness,
} from "../src/lib/application/intake-completion";
import {
  resolveApplicationContext,
  APPLICATION_CONTEXT_VERSION,
} from "../src/lib/application/application-context";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ANSWERS = {
  whyCountry: "Synthetic answer about the destination country.",
  whyNotHomeCountry: "Synthetic answer about the home country.",
  educationSystem: "Synthetic optional answer.",
  careerSupport: "Synthetic answer about career support.",
  postStudyIntentions: "Synthetic answer about post-study plans.",
};

// Student-scope data satisfying every other required section.
const STUDENT_PROFILE = {
  personalData: { firstName: "Synthetic", lastName: "Student", nationality: "Indian", currentCountry: "India" },
  education: [{ institution: "Synthetic University" }],
  experience: [{ company: "Synthetic Co" }],
  skills: { technical: ["Python"] },
};

// App-scope data satisfying every other required section.
const APP_FIELDS = {
  mastersMotivation: { whyNow: "Synthetic motivation." },
  careerGoals: { shortTerm: { role: "Synthetic role" } },
};

function mockApp(country: string | undefined, countryQuestionnaire?: unknown) {
  const fields: Record<string, unknown> = { ...APP_FIELDS };
  if (countryQuestionnaire !== undefined) fields.countryQuestionnaire = countryQuestionnaire;
  return {
    applicationContextVersion: APPLICATION_CONTEXT_VERSION.APP_SCOPED,
    country,
    contextData: { fields, provenance: {} },
  };
}

/** Same call shape as /api/application/profile readiness. */
function evaluate(app: ReturnType<typeof mockApp>) {
  const profile = resolveApplicationContext(app, STUDENT_PROFILE).profile;
  const readiness = getProfileReadiness(profile, app);
  const section6 = readiness.sections.find(s => s.sectionId === 6)!;
  return { profile, readiness, section6 };
}

function main() {
  console.log("=== Country Questions Completion Regression Tests ===\n");

  // 1. Reported production shape: answers saved, no countryCode, app country USA.
  {
    const app = mockApp("USA", { answers: { ...ANSWERS } });
    const savedBefore = JSON.stringify(app.contextData);
    const { readiness, section6 } = evaluate(app);
    check("1: no saved countryCode + app country USA → COMPLETE",
      section6.status === "complete", `status=${section6.status}`);
    check("1: required sections 6/6, canGenerate",
      readiness.requiredComplete === 6 && readiness.requiredTotal === 6 && readiness.canGenerate,
      `${readiness.requiredComplete}/${readiness.requiredTotal}`);
    check("1: saved record unchanged (no countryCode written)",
      JSON.stringify(app.contextData) === savedBefore &&
      (app.contextData.fields.countryQuestionnaire as any).countryCode === undefined);
  }

  // 1b. Full country name on the application resolves the same way.
  {
    const { section6 } = evaluate(mockApp("United States", { answers: { ...ANSWERS } }));
    check("1b: no saved countryCode + app country 'United States' → COMPLETE",
      section6.status === "complete", `status=${section6.status}`);
  }

  // 2. Required answer missing or blank → INCOMPLETE (fallback must not mask it).
  {
    const { careerSupport, ...withoutCareer } = ANSWERS;
    void careerSupport;
    const missing = evaluate(mockApp("USA", { answers: withoutCareer }));
    check("2a: required answer absent (no countryCode) → INCOMPLETE",
      missing.section6.status === "missing" && missing.readiness.requiredComplete === 5);

    const blank = evaluate(mockApp("USA", { answers: { ...ANSWERS, postStudyIntentions: "   " } }));
    check("2b: required answer whitespace-only (no countryCode) → INCOMPLETE",
      blank.section6.status === "missing");

    const blankWithCode = evaluate(mockApp("USA", { countryCode: "USA", answers: { ...ANSWERS, whyCountry: "" } }));
    check("2c: required answer empty (explicit countryCode) → INCOMPLETE",
      blankWithCode.section6.status === "missing");

    const optionalOnlyBlank = evaluate(mockApp("USA", { answers: { ...ANSWERS, educationSystem: "" } }));
    check("2d: only optional answer blank → still COMPLETE",
      optionalOnlyBlank.section6.status === "complete");
  }

  // 3. Explicit saved countryCode → existing behaviour preserved (saved code wins).
  {
    const { section6 } = evaluate(mockApp("USA", { countryCode: "USA", answers: { ...ANSWERS } }));
    check("3a: explicit countryCode USA → COMPLETE", section6.status === "complete");

    // Saved "OTHER" uses DEFAULT_QUESTIONNAIRE even though the app says Germany
    // (OTHER does not normalize, so the resolver keeps it).
    const other = evaluate(mockApp("Germany", { countryCode: "OTHER", answers: { ...ANSWERS } }));
    check("3b: explicit countryCode OTHER kept and evaluated → COMPLETE",
      other.profile.countryQuestionnaire?.countryCode === "OTHER" && other.section6.status === "complete");
  }

  // 4. Explicit country mismatch → server-side rejection preserved.
  {
    const { profile, section6, readiness } = evaluate(
      mockApp("Germany", { countryCode: "USA", answers: { ...ANSWERS } }),
    );
    check("4: saved USA questionnaire on Germany app discarded by resolver",
      profile.countryQuestionnaire === undefined);
    check("4: mismatch → INCOMPLETE (fallback does not resurrect it)",
      section6.status === "missing" && readiness.requiredComplete === 5);
  }

  // 5. Neither source provides a country → INCOMPLETE.
  {
    const noCountry = evaluate(mockApp(undefined, { answers: { ...ANSWERS } }));
    check("5a: no countryCode + no app country → INCOMPLETE", noCountry.section6.status === "missing");

    const emptyCountry = evaluate(mockApp("", { answers: { ...ANSWERS } }));
    check("5b: no countryCode + empty app country → INCOMPLETE", emptyCountry.section6.status === "missing");

    const blankCountry = evaluate(mockApp("   ", { answers: { ...ANSWERS } }));
    check("5c: no countryCode + whitespace app country → INCOMPLETE", blankCountry.section6.status === "missing");

    const noAnswers = evaluate(mockApp("USA", { countryCode: "USA" }));
    check("5d: country present but no answers object → INCOMPLETE", noAnswers.section6.status === "missing");

    const noQuestionnaire = evaluate(mockApp("USA"));
    check("5e: no questionnaire at all → INCOMPLETE", noQuestionnaire.section6.status === "missing");
  }

  // 6. Previously completed applications remain complete.
  {
    for (const [country, code] of [["USA", "USA"], ["United Kingdom", "UK"], ["Canada", "Canada"], ["Australia", "Australia"], ["Germany", "Germany"]]) {
      const { section6, readiness } = evaluate(mockApp(country, { countryCode: code, answers: { ...ANSWERS } }));
      check(`6: previously complete ${code} application stays COMPLETE (6/6)`,
        section6.status === "complete" && readiness.requiredComplete === 6);
    }
  }

  // 7. Callers without application context retain safe behaviour.
  {
    const legacyNoCode = { ...STUDENT_PROFILE, ...APP_FIELDS, countryQuestionnaire: { answers: { ...ANSWERS } } };
    const noApp = calculateIntakeCompletion(legacyNoCode).find(s => s.sectionId === 6)!;
    check("7a: no application + no countryCode → INCOMPLETE (unchanged)", noApp.status === "missing");

    const undefinedApp = calculateIntakeCompletion(legacyNoCode, undefined).find(s => s.sectionId === 6)!;
    check("7b: application=undefined + no countryCode → INCOMPLETE", undefinedApp.status === "missing");

    const nullApp = calculateIntakeCompletion(legacyNoCode, null).find(s => s.sectionId === 6)!;
    check("7c: application=null + no countryCode → INCOMPLETE", nullApp.status === "missing");

    const legacyWithCode = { ...legacyNoCode, countryQuestionnaire: { countryCode: "USA", answers: { ...ANSWERS } } };
    const noAppWithCode = getProfileReadiness(legacyWithCode);
    check("7d: no application + explicit countryCode → COMPLETE (unchanged)",
      noAppWithCode.sections.find(s => s.sectionId === 6)!.status === "complete" && noAppWithCode.canGenerate);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
