/**
 * country-questionnaire-persistence.test.ts — REGRESSION TEST
 *
 * Reproduces and verifies the fix for:
 *   application.country stores full country name ("United States")
 *   countryQuestionnaire.countryCode stores code ("USA")
 *   The naive string comparison always mismatched, silently deleting
 *   saved country questionnaires on every resolve.
 *
 * Scenarios:
 *   A. Same country (name vs code) → questionnaire preserved
 *   B. Different country → questionnaire discarded
 *   C. Unknown country (no mapping) → questionnaire preserved (lenient)
 *   D. Browser reload simulation → save + resolve + verify stable
 *
 * Uses sop_ai_app_test only. OpenAI calls: 0.
 */

import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createStudent, createApplication, deleteApplicationCascade,
  saveStudentProfile, getStudentProfile, getApplication,
  saveApplicationContext,
} from "../src/lib/application/application-repository";
import {
  buildContextDataForSave,
  resolveApplicationContext,
  APPLICATION_CONTEXT_VERSION,
} from "../src/lib/application/application-context";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  await assertTestDatabase();
  const pool = getDbPool();
  console.log("=== Country Questionnaire Persistence Regression Tests ===\n");

  const student = await createStudent({
    firstName: "Country", lastName: "Test",
    email: `country-${Date.now()}@example.test`,
  });

  // -----------------------------------------------------------
  // Scenario A — Same country: application.country="United States",
  // stored countryCode="USA" → MUST preserve questionnaire
  // -----------------------------------------------------------
  {
    const app = await createApplication({
      studentId: student.id, universityName: "MIT", programName: "MS",
      degree: "MS", country: "United States", intake: "Fall", intakeYear: "2027",
    });
    const questionnaire = {
      countryCode: "USA",
      answers: { whyCountry: "Great research", careerSupport: "Tech hub" },
    };
    const appFields = { countryQuestionnaire: questionnaire };
    const ctx = buildContextDataForSave(app, appFields, {});
    await saveApplicationContext(app.id, ctx);

    const resolved = resolveApplicationContext(
      await getApplication(app.id),
      await getStudentProfile(student.id) || {},
    );
    check("A: USA questionnaire preserved for 'United States' app",
      resolved.profile.countryQuestionnaire?.countryCode === "USA" &&
      resolved.profile.countryQuestionnaire?.answers?.whyCountry === "Great research",
      JSON.stringify(resolved.profile.countryQuestionnaire));

    await deleteApplicationCascade(app.id);
  }

  // -----------------------------------------------------------
  // Scenario B — Different country: app="Germany", stored="USA"
  // → MUST discard questionnaire (real mismatch)
  // -----------------------------------------------------------
  {
    const app = await createApplication({
      studentId: student.id, universityName: "TU Munich", programName: "MBA",
      degree: "MBA", country: "Germany", intake: "Fall", intakeYear: "2027",
    });
    const questionnaire = { countryCode: "USA", answers: { whyCountry: "Wrong country" } };
    const ctx = buildContextDataForSave(app, { countryQuestionnaire: questionnaire }, {});
    await saveApplicationContext(app.id, ctx);

    const resolved = resolveApplicationContext(
      await getApplication(app.id),
      await getStudentProfile(student.id) || {},
    );
    check("B: USA questionnaire discarded for Germany app (mismatch)",
      resolved.profile.countryQuestionnaire === undefined,
      JSON.stringify(resolved.profile.countryQuestionnaire));

    await deleteApplicationCascade(app.id);
  }

  // -----------------------------------------------------------
  // Scenario C — Unknown country: app="India", stored="OTHER"
  // → MUST preserve questionnaire (lenient: can't prove mismatch)
  // -----------------------------------------------------------
  {
    const app = await createApplication({
      studentId: student.id, universityName: "IIT", programName: "MTech",
      degree: "MTech", country: "India", intake: "Fall", intakeYear: "2027",
    });
    const questionnaire = { countryCode: "OTHER", answers: { whyCountry: "Unknown config" } };
    const ctx = buildContextDataForSave(app, { countryQuestionnaire: questionnaire }, {});
    await saveApplicationContext(app.id, ctx);

    const resolved = resolveApplicationContext(
      await getApplication(app.id),
      await getStudentProfile(student.id) || {},
    );
    check("C: unknown-country questionnaire preserved (lenient)",
      resolved.profile.countryQuestionnaire?.countryCode === "OTHER",
      JSON.stringify(resolved.profile.countryQuestionnaire));

    await deleteApplicationCascade(app.id);
  }

  // -----------------------------------------------------------
  // Scenario D — Browser reload: save, resolve, change, resolve again
  // → counts must remain stable after reload
  // -----------------------------------------------------------
  {
    const app = await createApplication({
      studentId: student.id, universityName: "Imperial", programName: "MSc",
      degree: "MSc", country: "United Kingdom", intake: "Fall", intakeYear: "2027",
    });
    const q1 = { countryCode: "UK", answers: { whyCountry: "A", postStudyIntentions: "B" } };
    await saveApplicationContext(app.id, buildContextDataForSave(app, { countryQuestionnaire: q1 }, {}));

    // First resolve
    const r1 = resolveApplicationContext(await getApplication(app.id), await getStudentProfile(student.id) || {});
    const ans1 = Object.keys(r1.profile.countryQuestionnaire?.answers || {}).length;

    // Simulate browser reload — re-save identical data
    await saveApplicationContext(app.id, buildContextDataForSave(await getApplication(app.id), { countryQuestionnaire: r1.profile.countryQuestionnaire }, {}));

    // Second resolve
    const r2 = resolveApplicationContext(await getApplication(app.id), await getStudentProfile(student.id) || {});
    const ans2 = Object.keys(r2.profile.countryQuestionnaire?.answers || {}).length;

    check("D: answer count stable across reload",
      ans1 === 2 && ans2 === 2,
      `ans1=${ans1} ans2=${ans2}`);

    await deleteApplicationCascade(app.id);
  }

  // -----------------------------------------------------------
  // Scenario E — Direct code match: app.country="USA", stored="USA"
  // → MUST preserve (no normalization needed path)
  // -----------------------------------------------------------
  {
    const app = await createApplication({
      studentId: student.id, universityName: "Stanford", programName: "PhD",
      degree: "PhD", country: "USA", intake: "Fall", intakeYear: "2027",
    });
    const q = { countryCode: "USA", answers: { whyCountry: "Direct" } };
    await saveApplicationContext(app.id, buildContextDataForSave(app, { countryQuestionnaire: q }, {}));

    const resolved = resolveApplicationContext(await getApplication(app.id), await getStudentProfile(student.id) || {});
    check("E: direct code match preserved",
      resolved.profile.countryQuestionnaire?.countryCode === "USA",
      JSON.stringify(resolved.profile.countryQuestionnaire));

    await deleteApplicationCascade(app.id);
  }

  // Cleanup
  await pool.execute("DELETE FROM students WHERE id = ?", [student.id]);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log("OPENAI CALLS: 0\nPRODUCTION DB MUTATIONS: 0");
  process.exit(failed === 0 ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(3); })
  .finally(() => closeDbPool().catch(() => undefined));
