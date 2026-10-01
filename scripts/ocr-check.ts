import { readFile } from "fs/promises";
import { importResume } from "../src/lib/application/resume-import";
async function main() {
  for (const f of process.argv.slice(2)) {
    const buf = await readFile(f);
    const name = f.split("/").pop()!;
    const ext = name.split(".").pop()!;
    const mime = ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    try {
      const r = await importResume(buf, name, mime);
      const w = (r.candidate as any).candidateDiagnostics;
      console.log(`=== ${name} ===`);
      console.log(`  state=${r.state} winner=${r.candidate.sourceStrategy} ocrRecovered=${!!r.ocrRecovered} engine=${r.ocrEngine || "-"}`);
      console.log(`  attempts: ${r.attempts.map(a => `${a.strategy}:${a.status}`).join(" | ")}`);
      if (w) console.log(`  winner diag: edu=${w.educationCount}/${w.plausibleEducationCount}p/${w.malformedEducationCount}m exp=${w.experienceCount}/${w.plausibleExperienceCount}p skills=${w.uniqueSkillCount}u contact=${w.personalCompleteness} textLen=${w.rawTextLength}`);
    } catch (e: any) {
      console.log(`=== ${name} ===`);
      console.log(`  FAILED: code=${e?.code} msg=${e?.userMessage?.slice(0,80) || e?.message?.slice(0,80)}`);
    }
  }
}
main();
