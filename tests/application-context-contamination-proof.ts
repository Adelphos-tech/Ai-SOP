/**
 * application-context-contamination-proof.ts — PRE-FIX PROOF
 *
 * Deterministic, zero-token reproduction of cross-application
 * contamination on the CURRENT storage model:
 *   Student S → Application A (Germany MBA), Application B (USA MS).
 *   B's intake save writes app-scoped fields to shared
 *   students.profile_data; resolving A's generation context then
 *   returns B's values.
 *
 * This file exercises ONLY the current production paths
 * (saveStudentProfile = what PUT /api/application/profile does today;
 * loadDocumentGenerationContext = the generation context loader).
 * It does NOT use the new application-context module.
 *
 * Mutates ONLY sop_ai_app_test. OpenAI calls: 0.
 */

import { getDbPool, closeDbPool, assertTestDatabase } from "./test-setup";
import {
  createStudent, createApplication, createDocument,
  saveStudentProfile, getStudentProfile,
} from "../src/lib/application/application-repository";
import { loadDocumentGenerationContext } from "../src/lib/application/generation-context";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const APP_KEYS = [
  "mastersMotivation", "countryQuestionnaire", "careerGoals",
  "fieldMotivation", "subjectRequirements", "universityRequirements",
] as const;

function appFields(tag: string) {
  return {
    mastersMotivation: { whyField: `${tag}-whyField`, whyNow: `${tag}-whyNow` },
    countryQuestionnaire: { countryCode: tag, answers: { q1: `${tag}-answer` } },
    careerGoals: { shortTerm: { role: `${tag}-role` }, longTerm: { vision: `${tag}-vision` } },
    fieldMotivation: `${tag}-fieldMotivation`,
    subjectRequirements: { notes: [{ id: "n1", type: "note", content: `${tag}-subjectReq` }] },
    universityRequirements: { officialSourceUrl: `https://${tag}.example.edu`, wordMax: "500" },
  };
}

async function main() {
  await assertTestDatabase();
  const pool = getDbPool();
  console.log("=== Cross-Application Contamination Proof (pre-fix storage model) ===\n");

  // Student S with student-scope facts
  const student = await createStudent({
    firstName: "Contam", lastName: "Proof", email: `contam-${Date.now()}@example.test`,
  });
  const studentScope = {
    personalData: { firstName: "Contam", lastName: "Proof", email: student.email, nationality: "IN" },
    education: [{ id: "e1", level: "Bachelor's", institution: "Shared U", degree: "BTech" }],
  };

  // Application A (Germany MBA), Application B (USA MS)
  const appA = await createApplication({
    studentId: student.id, universityName: "TU Munich", programName: "MBA",
    degree: "MBA", country: "Germany", intake: "Fall", intakeYear: "2027",
  });
  const appB = await createApplication({
    studentId: student.id, universityName: "MIT", programName: "MS",
    degree: "MS", country: "USA", intake: "Fall", intakeYear: "2027",
  });

  // Force LEGACY (v1) — the pre-migration storage model this proof
  // documents: app-scope fields live only in shared profile_data.
  await pool.execute(
    "UPDATE applications SET application_context_version = 1, context_data = NULL WHERE id IN (?, ?)",
    [appA.id, appB.id],
  );

  // Save A's intake — the CURRENT write path (whole blob → shared profile_data)
  await saveStudentProfile(student.id, { ...studentScope, ...appFields("A") });
  // Save B's intake — same shared blob, B's values overwrite
  await saveStudentProfile(student.id, { ...studentScope, ...appFields("B") });

  // Resolve A's generation context — document required by the loader
  const docA = await createDocument({
    applicationId: appA.id, documentType: "STATEMENT_OF_PURPOSE",
    documentTitle: "A SOP", promptText: "Write an SOP", promptSource: "CONSULTANT_PROVIDED",
  });
  const docB = await createDocument({
    applicationId: appB.id, documentType: "STATEMENT_OF_PURPOSE",
    documentTitle: "B SOP", promptText: "Write an SOP", promptSource: "CONSULTANT_PROVIDED",
  });

  const ctxA = await loadDocumentGenerationContext(student.id, appA.id, docA.id);
  const ctxB = await loadDocumentGenerationContext(student.id, appB.id, docB.id);
  if (!ctxA.ok || !ctxA.context || !ctxB.ok || !ctxB.context) {
    check("context loads", false, ctxA.error || ctxB.error || "");
    return;
  }

  const profA: any = ctxA.context.profile;
  const profB: any = ctxB.context.profile;

  let contaminated = 0;
  for (const k of APP_KEYS) {
    const aVal = JSON.stringify(profA?.[k]);
    const bVal = JSON.stringify(profB?.[k]);
    const seesB = aVal === bVal && aVal?.includes('"B') === true || aVal === bVal;
    if (aVal === bVal && profA?.[k] !== undefined) contaminated++;
    console.log(`       ${k}: A=${aVal?.slice(0, 80)}`);
  }
  check(
    "PROOF: application A sees application B's saved values (all 6 app-scope groups)",
    contaminated === APP_KEYS.length,
    `${contaminated}/${APP_KEYS.length} groups identical — expected B-values on A`,
  );
  check(
    "PROOF: A.mastersMotivation contains B's marker, not A's",
    JSON.stringify(profA?.mastersMotivation).includes("B-whyField") &&
    !JSON.stringify(profA?.mastersMotivation).includes("A-whyField"),
  );

  // Cleanup fixture rows
  await pool.execute("DELETE FROM applications WHERE student_id = ?", [student.id]);
  await pool.execute("DELETE FROM students WHERE id = ?", [student.id]);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log("OPENAI CALLS: 0");
  process.exit(failed === 0 ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(3); })
  .finally(() => closeDbPool().catch(() => undefined));
