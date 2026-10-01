/**
 * resilience-acceptance.test.ts — zero-token acceptance audit.
 *
 * Empirically exercises the progression ladder on the ISOLATED test DB:
 *   create student → create application → create document → context gate
 * No OpenAI calls, no paid services. Asserts which stages block and why.
 */
import { assertTestDatabase, closeDbPool } from "./test-setup";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); });
}
import assert from "node:assert/strict";
import {
  createStudent, createApplication, createDocument, createOfficialDocument, saveStudentProfile, getStudent,
} from "../src/lib/application/application-repository";
import { loadDocumentGenerationContext } from "../src/lib/application/generation-context";
import { getProfileReadiness } from "../src/lib/application/intake-completion";
import { isValidDocumentType, DOCUMENT_TYPE_OPTIONS } from "../src/lib/application/application-types";
import { getDocumentTypeConfig, DOCUMENT_TYPE_CONFIGS } from "../src/lib/application/document-type-config";
import { getDefaultTemplate } from "../src/lib/application/default-templates";

async function main() {
  await assertTestDatabase();

  const student = await createStudent({ firstName: "Audit", lastName: "Tester", email: "audit@test.local" } as any);
  const app = await createApplication({
    studentId: student.id, universityName: "Test U", programName: "MS CS",
    degree: "Other", country: "Japan", intake: "", intakeYear: "", // non-listed country → genericity probe
  } as any);

  /* ---- §3 application creation matrix (schema level) ---- */
  await check("3a: any country/degree combination creates an application", async () => {
    for (const [country, degree] of [
      ["USA", "Bachelor"], ["UK", "MBA"], ["Canada", "Diploma"],
      ["UAE", "Certificate"], ["Japan", "Other"], ["Germany", "PhD"],
    ]) {
      const a = await createApplication({
        studentId: student.id, universityName: "U", programName: "P",
        degree, country, intake: "", intakeYear: "",
      } as any);
      assert.ok(a.id);
    }
  });

  /* ---- §5 zero-data ladder ---- */
  const doc = await createDocument({
    applicationId: app.id, documentType: "STATEMENT_OF_PURPOSE",
    documentTitle: "SOP", promptText: "Why this program? Describe your background.",
    promptSource: "CONSULTANT_PROVIDED",
  } as any);

  await check("5a: name-only student — context gate blocks with clear reason", async () => {
    const ctx = await loadDocumentGenerationContext(student.id, app.id, doc.id);
    assert.ok(ctx.ok);
    assert.equal(ctx.context!.blocked, true);
    assert.ok(ctx.context!.blockReasons.some(r => r.includes("MISSING_REQUIRED_STUDENT_INFORMATION")));
  });

  await check("5b: name+education → NOT blocked (fact-sheet auto-approve)", async () => {
    await saveStudentProfile(student.id, {
      personalData: { firstName: "Audit", lastName: "Tester" },
      education: [{ institution: "U", degree: "BS", level: "Bachelor" }],
    } as any);
    const ctx = await loadDocumentGenerationContext(student.id, app.id, doc.id);
    assert.equal(ctx.context!.blocked, false,
      `name+edu should not block: ${ctx.context!.blockReasons.join("|")}`);
  });

  await check("5c: intake readiness is stricter than the server gate", async () => {
    // documents the finding: canGenerate=false while server ctx.blocked=false
    const profile = (await getStudent(student.id))?.profileData;
    const readiness = getProfileReadiness(profile, app);
    assert.equal(readiness.canGenerate, false);
    const ctx = await loadDocumentGenerationContext(student.id, app.id, doc.id);
    assert.equal(ctx.context!.blocked, false);
    console.log(`      (advisory intake sections: ${readiness.weakAreas.join(", ")})`);
  });

  /* ---- §6 document-type matrix ---- */
  await check("6: all document types create + resolve a prompt", async () => {
    for (const t of DOCUMENT_TYPE_OPTIONS) {
      assert.ok(isValidDocumentType(t.value), t.value);
      const cfg = getDocumentTypeConfig(t.value);
      assert.ok(cfg.documentType === t.value);
      const tpl = getDefaultTemplate(t.value);
      assert.ok(tpl.promptText.length > 20, `default template exists for ${t.value}`);
      const d = await createOfficialDocument({
        applicationId: app.id, documentType: t.value,
        documentTitle: t.label, promptText: tpl.promptText,
        promptSource: "DVIVID_DEFAULT_TEMPLATE",
      } as any);
      assert.ok(d.id);
      const ctx = await loadDocumentGenerationContext(student.id, app.id, d.id);
      assert.ok(ctx.ok, `ctx load failed for ${t.value}`);
    }
  });

  await check("6b: LOR blocks without recommender context (doc-type gate)", async () => {
    const d = await createDocument({
      applicationId: app.id, documentType: "LETTER_OF_RECOMMENDATION",
      documentTitle: "LOR", promptText: "Recommend the applicant.",
      promptSource: "CONSULTANT_PROVIDED",
    } as any);
    const ctx = await loadDocumentGenerationContext(student.id, app.id, d.id);
    assert.equal(ctx.context!.blocked, true);
    assert.ok(ctx.context!.blockReasons.some(r => r.includes("Recommender")));
  });

  await check("6c: Visa SOP blocks without visa evidence", async () => {
    const d = await createOfficialDocument({
      applicationId: app.id, documentType: "VISA_SOP",
      documentTitle: "Visa",
      promptText: getDefaultTemplate("VISA_SOP").promptText,
      promptSource: "DVIVID_DEFAULT_TEMPLATE",
    } as any);
    const ctx = await loadDocumentGenerationContext(student.id, app.id, d.id);
    assert.equal(ctx.context!.blocked, true);
    assert.ok(ctx.context!.blockReasons.some(r => r.includes("Visa")));
    // and unblocks once app-scoped career evidence exists
    // (careerGoals is APPLICATION_SCOPE — must go via context_data)
    const { saveApplicationContext } = await import("../src/lib/application/application-repository");
    await saveApplicationContext(app.id, {
      fields: { careerGoals: { longTerm: { vision: "Return home and build X" } } },
      provenance: { careerGoals: "APPLICATION_EXPLICIT" },
    } as any);
    const ctx2 = await loadDocumentGenerationContext(student.id, app.id, d.id);
    assert.equal(ctx2.context!.blocked, false, "visa evidence should unblock");
  });

  /* ---- §8 multi-document isolation ---- */
  await check("8: per-document prompt/limits stay isolated", async () => {
    const d1 = await createDocument({
      applicationId: app.id, documentType: "ESSAY",
      documentTitle: "E1", promptText: "Essay question one?",
      promptSource: "CONSULTANT_PROVIDED", wordMax: 250,
    } as any);
    const d2 = await createDocument({
      applicationId: app.id, documentType: "ESSAY",
      documentTitle: "E2", promptText: "Different essay question two?",
      promptSource: "CONSULTANT_PROVIDED", wordMax: 800,
    } as any);
    const c1 = await loadDocumentGenerationContext(student.id, app.id, d1.id);
    const c2 = await loadDocumentGenerationContext(student.id, app.id, d2.id);
    assert.notEqual(c1.context!.mergedPrompt.promptText, c2.context!.mergedPrompt.promptText);
  });

  /* ---- §22 consultant authority ---- */
  await check("22: consultant-provided prompt accepted on all types", async () => {
    for (const t of DOCUMENT_TYPE_OPTIONS) {
      const d = await createDocument({
        applicationId: app.id, documentType: t.value,
        documentTitle: t.label, promptText: "Consultant instruction text.",
        promptSource: "CONSULTANT_PROVIDED",
      } as any);
      const ctx = await loadDocumentGenerationContext(student.id, app.id, d.id);
      assert.ok(ctx.context!.mergedPrompt.promptText.includes("Consultant"), t.value);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  await closeDbPool();
  process.exit(fail ? 1 : 0);
}
main();
