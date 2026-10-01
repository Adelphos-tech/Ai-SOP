/**
 * cv-candidate-diagnose.ts — run every strategy on a CV file and show
 * current coverageRank vs plausibility diagnostics + winner reasons.
 * Debug/audit tool — no DB, no OpenAI.
 *
 *   npx tsx scripts/cv-candidate-diagnose.ts <file> [file2 ...]
 */
import { readFileSync } from "fs";
import { basename } from "path";

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: cv-candidate-diagnose <file>...");
    process.exit(1);
  }
  const { strategiesFor } = await import("../src/lib/application/resume-import/strategies");
  const { coverageRank } = await import("../src/lib/application/resume-import/coverage");
  const { computeCandidateDiagnostics } = await import("../src/lib/application/resume-import/diagnostics");

  for (const f of files) {
    const buf = readFileSync(f);
    const name = basename(f);
    console.log(`\n=== ${name} ===`);
    const cands: any[] = [];
    for (const s of strategiesFor(name)) {
      const t = Date.now();
      try {
        const c = await s.parse(buf, name, "");
        cands.push(c);
        const d = computeCandidateDiagnostics(c.parsed, c.coverage.status);
        console.log(
          `  ${s.id.padEnd(18)} cov=${c.coverage.status.padEnd(15)} ` +
          `rank=${coverageRank(c.coverage)} q=${d.qualityRank} ` +
          `edu=${d.educationCount}/${d.plausibleEducationCount}p/${d.duplicateEducationCount}d/${d.malformedEducationCount}m ` +
          `exp=${d.experienceCount}/${d.plausibleExperienceCount}p/${d.duplicateExperienceCount}d/${d.malformedExperienceCount}m ` +
          `skills=${d.skillsCount}/${d.uniqueSkillCount}u/${d.suspiciousSkillCount}s ` +
          `contact-bad=${d.invalidContactCount} pollution=${d.crossSectionPollutionCount} dates=${d.dateParseIssues} ` +
          `(${Date.now() - t}ms)`,
        );
      } catch (e: any) {
        console.log(`  ${s.id.padEnd(18)} FAILED ${e?.code || e?.name} (${Date.now() - t}ms)`);
      }
    }
    if (cands.length) {
      const { chooseBestCandidateDetailed } = await import("../src/lib/application/resume-import/diagnostics");
      const sel = chooseBestCandidateDetailed(cands);
      console.log(`  → winner: ${sel.best?.sourceStrategy}`);
      for (const r of sel.winnerReasons) console.log(`     ${r}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
