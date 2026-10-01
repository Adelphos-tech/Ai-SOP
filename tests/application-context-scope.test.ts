/**
 * application-context-scope.test.ts — application-scoped intake isolation
 *
 * Proves the scope model on the test database (sop_ai_app_test only):
 *   STUDENT  — reusable facts shared across applications
 *   APPLICATION — motivation/context isolated per application
 *   DOCUMENT — writing requirements unchanged (document columns)
 *
 * Simulates the intake PUT split at the repository seam
 * (stripApplicationScopeFields + extractApplicationScopeFields +
 * buildContextDataForSave + saveApplicationContext), resolves through
 * resolveApplicationContext and loadDocumentGenerationContext — the
 * same functions the routes call.
 *
 * OpenAI calls: 0. Production DB: untouched (hard guard).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createStudent, createApplication, createDocument, deleteApplicationCascade,
  saveStudentProfile, getStudentProfile, getApplication,
  saveApplicationContext,
} from "../src/lib/application/application-repository";
import {
  extractApplicationScopeFields,
  stripApplicationScopeFields,
  buildContextDataForSave,
  resolveApplicationContext,
  APPLICATION_SCOPE_FIELDS,
  APPLICATION_CONTEXT_VERSION,
} from "../src/lib/application/application-context";
import { loadDocumentGenerationContext } from "../src/lib/application/generation-context";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

function appFields(tag: string) {
  return {
    mastersMotivation: { whyField: `${tag}-whyField`, whyNow: `${tag}-whyNow` },
    countryQuestionnaire: { countryCode: tag, answers: { q1: `${tag}-answer` } },
    careerGoals: { shortTerm: { role: `${tag}-role` }, longTerm: { vision: `${tag}-vision` } },
    fieldMotivation: `${tag}-fieldMotivation`,
    subjectRequirements: { notes: [{ id: "n1", type: "note", content: `${tag}-subjectReq` }] },
    universityRequirements: { officialSourceUrl: `https://${tag}.example.edu`, wordMax: "999" },
  };
}

const studentScope = {
  personalData: { firstName: "Scope", lastName: "Test", email: "scope@test.dev", nationality: "IN" },
  education: [{ id: "e1", level: "Bachelor's", institution: "Shared U", degree: "BTech" }],
  skills: { technical: ["python"] },
};

/** Mirror of PUT /api/application/profile (applicationId branch):
 *  student fields → profile_data; app fields → context_data (v2). */
async function scopedIntakeSave(studentId: string, applicationId: string, submitted: any) {
  const application = await getApplication(applicationId);
  const studentFields = stripApplicationScopeFields(submitted);
  const appFields = extractApplicationScopeFields(submitted);
  const existing = (await getStudentProfile(studentId)) || {};
  await saveStudentProfile(studentId, { ...existing, ...studentFields });
  await saveApplicationContext(
    applicationId,
    buildContextDataForSave(application!, appFields, { ...existing, ...studentFields }),
  );
}

async function resolveProfile(applicationId: string, studentId: string) {
  const app = await getApplication(applicationId);
  return resolveApplicationContext(app, (await getStudentProfile(studentId)) || {});
}

async function main() {
  await assertTestDatabase();
  const pool = getDbPool();
  console.log("=== Application Context Scope Tests ===\n");

  const student = await createStudent({
    firstName: "Scope", lastName: "Test", email: `scope-${Date.now()}@example.test`,
  });
  const appA = await createApplication({
    studentId: student.id, universityName: "TU Munich", programName: "MBA",
    degree: "MBA", country: "Germany", intake: "Fall", intakeYear: "2027",
  });
  const appB = await createApplication({
    studentId: student.id, universityName: "MIT", programName: "MS",
    degree: "MS", country: "USA", intake: "Fall", intakeYear: "2027",
  });
  const docA = await createDocument({
    applicationId: appA.id, documentType: "STATEMENT_OF_PURPOSE",
    documentTitle: "A SOP", promptText: "Write an SOP for A", promptSource: "CONSULTANT_PROVIDED",
  });
  const docB = await createDocument({
    applicationId: appB.id, documentType: "STATEMENT_OF_PURPOSE",
    documentTitle: "B SOP", promptText: "Write an SOP for B", promptSource: "CONSULTANT_PROVIDED",
  });

  check("new applications are APP_SCOPED (v2) at creation",
    appA.applicationContextVersion === 2 && appB.applicationContextVersion === 2,
    `A=${appA.applicationContextVersion} B=${appB.applicationContextVersion}`);

  // Both apps' intake saves through the scoped seam
  await scopedIntakeSave(student.id, appA.id, { ...studentScope, ...appFields("A") });
  await scopedIntakeSave(student.id, appB.id, { ...studentScope, ...appFields("B") });

  const resA = await resolveProfile(appA.id, student.id);
  const resB = await resolveProfile(appB.id, student.id);

  // 1. student reusable facts shared
  check("1: student facts shared across A/B",
    JSON.stringify(resA.profile.education) === JSON.stringify(resB.profile.education) &&
    resA.profile.personalData?.nationality === "IN",
    "education + personalData identical");

  // 2-7. each app-scope field isolated
  const iso = (key: string, marker: string) =>
    JSON.stringify(resA.profile[key]).includes(`A-${marker}`) &&
    JSON.stringify(resB.profile[key]).includes(`B-${marker}`) &&
    !JSON.stringify(resA.profile[key]).includes(`B-${marker}`) &&
    !JSON.stringify(resB.profile[key]).includes(`A-${marker}`);
  check("2: mastersMotivation isolated", iso("mastersMotivation", "whyField"));
  check("3: countryQuestionnaire isolated", iso("countryQuestionnaire", "answer"));
  check("4: careerGoals isolated", iso("careerGoals", "role"));
  check("5: fieldMotivation isolated", iso("fieldMotivation", "fieldMotivation"));
  check("6: subjectRequirements isolated", iso("subjectRequirements", "subjectReq"));
  check("7: universityRequirements isolated",
    resA.profile.universityRequirements?.officialSourceUrl === "https://A.example.edu" &&
    resB.profile.universityRequirements?.officialSourceUrl === "https://B.example.edu");
  check("  → no shared fallback used for scoped apps",
    !resA.crossApplicationFallbackUsed && !resB.crossApplicationFallbackUsed);

  // 8. editing B does not mutate A
  const beforeA = JSON.stringify(resA.profile);
  await scopedIntakeSave(student.id, appB.id, { ...studentScope, ...appFields("B2") });
  const resA2 = await resolveProfile(appA.id, student.id);
  check("8: editing B does not mutate A's context",
    JSON.stringify(resA2.profile) === beforeA,
    resA2.profile.mastersMotivation?.whyField);
  const resB2 = await resolveProfile(appB.id, student.id);
  check("8b: B reflects its own edit",
    JSON.stringify(resB2.profile.mastersMotivation).includes("B2-whyField"));

  // 9. CV apply semantics: cv-apply writes ONLY student-scope keys via
  //    saveStudentProfileConditional — replay that write and verify
  //    neither application's context moved.
  {
    const appCtxBeforeA = (await getApplication(appA.id))?.contextData;
    const appCtxBeforeB = (await getApplication(appB.id))?.contextData;
    const existing = (await getStudentProfile(student.id)) || {};
    await saveStudentProfile(student.id, {
      ...existing,
      experience: [{ id: "cv-1", organization: "CV Corp", role: "Dev" }],
      skills: { technical: ["python", "sql"] },
    });
    const appCtxAfterA = (await getApplication(appA.id))?.contextData;
    const appCtxAfterB = (await getApplication(appB.id))?.contextData;
    check("9: CV-style student write leaves A/B context_data untouched",
      JSON.stringify(appCtxBeforeA) === JSON.stringify(appCtxAfterA) &&
      JSON.stringify(appCtxBeforeB) === JSON.stringify(appCtxAfterB));
    const resA3 = await resolveProfile(appA.id, student.id);
    check("9b: CV fields land in student scope, app fields still A's",
      resA3.profile.experience?.[0]?.organization === "CV Corp" &&
      JSON.stringify(resA3.profile.mastersMotivation).includes("A-whyField"));
    // static guard: the route source must not write app-scope keys
    const cvSrc = readFileSync(resolve(__dirname, "../src/app/api/application/cv-apply/route.ts"), "utf-8");
    check("9c: cv-apply route never names app-scope fields",
      !APPLICATION_SCOPE_FIELDS.some(k => cvSrc.includes(`merged.${k}`) || cvSrc.includes(`"${k}"`)));
  }

  // 10-11. generation context per document/application
  {
    const ctxA = await loadDocumentGenerationContext(student.id, appA.id, docA.id);
    const ctxB = await loadDocumentGenerationContext(student.id, appB.id, docB.id);
    check("10: document A context receives A's values only",
      ctxA.ok === true &&
      JSON.stringify((ctxA.context as any)?.profile?.mastersMotivation).includes("A-whyField") &&
      !JSON.stringify((ctxA.context as any)?.profile?.mastersMotivation).includes("B"),
      ctxA.ok ? "" : ctxA.error);
    check("11: document B context receives B's values only",
      ctxB.ok === true &&
      JSON.stringify((ctxB.context as any)?.profile?.mastersMotivation).includes("B2-whyField") &&
      !JSON.stringify((ctxB.context as any)?.profile?.mastersMotivation).includes("A-"));
    check("11b: context reports APPLICATION_CONTEXT source, no fallback",
      ctxA.ok === true &&
      (ctxA.context as any)?.applicationContextSource === "APPLICATION_CONTEXT" &&
      (ctxA.context as any)?.crossApplicationFallbackUsed === false &&
      (ctxA.context as any)?.applicationContextId === appA.id);
  }

  // 12. legacy application compatibility
  {
    const legacyApp = await createApplication({
      studentId: student.id, universityName: "Oxford", programName: "MSc",
      degree: "MSc", country: "UK", intake: "Fall", intakeYear: "2027",
    });
    await pool.execute(
      "UPDATE applications SET application_context_version = 1, context_data = NULL WHERE id = ?",
      [legacyApp.id],
    );
    // Legacy app reads shared profile_data — which still carries the last
    // student-scope + app-scope residue (B2 wrote app keys to context_data,
    // not shared; shared residue holds whatever the legacy blob had).
    await saveStudentProfile(student.id, { ...studentScope, ...appFields("SHARED") });
    const legacyResolved = await resolveProfile(legacyApp.id, student.id);
    check("12: legacy app falls back to shared profile (compat)",
      legacyResolved.applicationContextSource === "LEGACY_SHARED_PROFILE" &&
      legacyResolved.crossApplicationFallbackUsed === true &&
      JSON.stringify(legacyResolved.profile.mastersMotivation).includes("SHARED-whyField"));
    check("12b: legacy provenance marked LEGACY_SHARED",
      legacyResolved.provenance.mastersMotivation === "LEGACY_SHARED");

    // 13. first scoped save migrates legacy app — no more fallback
    await scopedIntakeSave(student.id, legacyApp.id, {
      ...studentScope,
      ...appFields("SHARED"),
      mastersMotivation: { whyField: "LEGACY-EDITED" },
    });
    const migrated = await getApplication(legacyApp.id);
    const migratedResolved = await resolveProfile(legacyApp.id, student.id);
    check("13: migrated app advances to APP_SCOPED",
      migrated?.applicationContextVersion === APPLICATION_CONTEXT_VERSION.APP_SCOPED &&
      migratedResolved.crossApplicationFallbackUsed === false);
    check("13b: explicit edit is APPLICATION_EXPLICIT, untouched seed stays LEGACY_SHARED",
      migratedResolved.provenance.mastersMotivation === "APPLICATION_EXPLICIT" &&
      migratedResolved.provenance.countryQuestionnaire === "LEGACY_SHARED",
      JSON.stringify(migratedResolved.provenance));
    check("13c: migrated app resolves edited value",
      JSON.stringify(migratedResolved.profile.mastersMotivation).includes("LEGACY-EDITED"));
    // shared profile changed afterwards → migrated app unaffected
    await saveStudentProfile(student.id, { ...studentScope, ...appFields("LATER-SHARED") });
    const afterShared = await resolveProfile(legacyApp.id, student.id);
    check("13d: migrated app immune to later shared-profile writes",
      JSON.stringify(afterShared.profile.mastersMotivation).includes("LEGACY-EDITED"));
    // other legacy apps still read shared (residue preserved)
    const resA4 = await resolveProfile(appA.id, student.id);
    check("13e: A's context unaffected by shared residue writes",
      JSON.stringify(resA4.profile.mastersMotivation).includes("A-whyField"));
    await pool.execute("DELETE FROM applications WHERE id = ?", [legacyApp.id]);
  }

  // 8c. deleting B does not mutate A
  {
    const ctxAData = (await getApplication(appA.id))?.contextData;
    await deleteApplicationCascade(appB.id);
    const resA5 = await resolveProfile(appA.id, student.id);
    check("8c: deleting B leaves A's context + resolution intact",
      JSON.stringify((await getApplication(appA.id))?.contextData) === JSON.stringify(ctxAData) &&
      JSON.stringify(resA5.profile.mastersMotivation).includes("A-whyField"));
    check("8d: B is gone, A remains",
      (await getApplication(appB.id)) === null && (await getApplication(appA.id)) !== null);
  }

  // New APP_SCOPED app does NOT inherit shared residue
  {
    const appC = await createApplication({
      studentId: student.id, universityName: "NUS", programName: "MS",
      degree: "MS", country: "Singapore", intake: "Spring", intakeYear: "2028",
    });
    const resC = await resolveProfile(appC.id, student.id);
    check("new v2 app starts clean — shared app values NOT inherited",
      resC.profile.mastersMotivation === undefined &&
      resC.profile.careerGoals === undefined &&
      resC.profile.education?.length === 1,
      JSON.stringify(resC.profile.mastersMotivation));
    await pool.execute("DELETE FROM applications WHERE id = ?", [appC.id]);
  }

  // Cleanup fixtures
  await pool.execute("DELETE FROM applications WHERE student_id = ?", [student.id]);
  await pool.execute("DELETE FROM students WHERE id = ?", [student.id]);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log("OPENAI CALLS: 0\nPRODUCTION DB MUTATIONS: 0");
  process.exit(failed === 0 ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(3); })
  .finally(() => closeDbPool().catch(() => undefined));
