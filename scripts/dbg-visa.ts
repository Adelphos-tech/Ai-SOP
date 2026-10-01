import { assertTestDatabase, closeDbPool } from "../tests/test-setup";
import * as repo from "../src/lib/application/application-repository";
import * as gc from "../src/lib/application/generation-context";
async function main() {
  await assertTestDatabase();
  const s = await repo.createStudent({ firstName: "D", lastName: "B", email: "d2@b.x" } as any);
  await repo.saveStudentProfile(s.id, {
    personalData: { firstName: "D", lastName: "B" },
    education: [{ institution: "U", degree: "BS" }],
    careerGoals: { longTerm: { vision: "Return home and build X" } },
  } as any);
  const a = await repo.createApplication({ studentId: s.id, universityName: "U", programName: "P", degree: "Other", country: "", intake: "", intakeYear: "" } as any);
  const d = await repo.createDocument({ applicationId: a.id, documentType: "VISA_SOP", documentTitle: "V", promptText: "x", promptSource: "CONSULTANT_PROVIDED" } as any);
  const ctx = await gc.loadDocumentGenerationContext(s.id, a.id, d.id);
  console.log("blocked:", ctx.context!.blocked, "|", ctx.context!.blockReasons);
  const st = await repo.getStudent(s.id);
  console.log("careerGoals in db:", JSON.stringify(st!.profileData?.careerGoals));
  await closeDbPool(); process.exit(0);
}
main();
