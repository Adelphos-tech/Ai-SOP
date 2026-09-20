// ============================================================
// CV PARSER SIDE-BY-SIDE COMPARISON (non-writing)
// ============================================================
// Usage: npx tsx scripts/compare-cv-parsers.ts <file.pdf|docx|txt>
//
// Requires the docling sidecar running (CV_PARSER_SERVICE_URL,
// default http://127.0.0.1:8099). Compares legacy vs docling output.
// NEVER writes to any profile. No AI calls.
// ============================================================

import { readFileSync } from "fs";
import { basename } from "path";
import { parseCVFile } from "../src/lib/application/cv-parser";
import { parseWithDocling } from "../src/lib/application/docling-client";
import { mapDoclingToParsedCV } from "../src/lib/application/cv-mapper-docling";
import type { ParsedCV } from "../src/lib/application/cv-parser";

function summarize(cv: ParsedCV) {
  return {
    name: `${cv.personalData.firstName} ${cv.personalData.lastName}`.trim(),
    email: cv.personalData.email || "—",
    phone: cv.personalData.phone || "—",
    city: cv.personalData.currentCity || "—",
    education: cv.education.map(e =>
      `${e.institution || "?"} | ${e.degree || "?"} | ${e.cgpa || "—"}/${e.cgpaScale || "—"} | ${e.startYear}-${e.endYear}`),
    experience: cv.experience.map(e =>
      `${e.organization || "?"} | ${e.role || "?"} | ${e.startDate}-${e.endDate}`),
    projects: cv.projects.map(p => p.name),
    skills: Object.values(cv.skills).flat().length,
    certifications: cv.certifications.length,
    achievements: cv.achievements.length,
    warnings: cv.parseWarnings,
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/compare-cv-parsers.ts <cv-file>");
    process.exit(1);
  }
  const buffer = readFileSync(file);
  const filename = basename(file);

  console.log("=".repeat(70));
  console.log(`CV: ${filename} (${buffer.length} bytes)`);
  console.log("=".repeat(70));

  let legacy: ParsedCV | null = null;
  try {
    legacy = await parseCVFile(buffer, filename);
  } catch (e: any) {
    console.log(`\nLEGACY: FAILED (${e?.code || e?.message})`);
  }

  let doclingCv: ParsedCV | null = null;
  try {
    const doc = await parseWithDocling(buffer, filename);
    doclingCv = mapDoclingToParsedCV(doc);
  } catch (e: any) {
    console.log(`\nDOCLING: FAILED (${e?.code || e?.message})`);
  }

  for (const [label, cv] of [["LEGACY", legacy], ["DOCLING", doclingCv]] as const) {
    if (!cv) continue;
    const s = summarize(cv);
    console.log(`\n--- ${label} ${cv.parserMeta ? `(${JSON.stringify(cv.parserMeta)})` : ""} ---`);
    console.log(`name: ${s.name} | email: ${s.email} | phone: ${s.phone}`);
    console.log(`education (${s.education.length}):`);
    s.education.forEach(e => console.log(`   ${e}`));
    console.log(`experience (${s.experience.length}):`);
    s.experience.forEach(e => console.log(`   ${e}`));
    console.log(`projects (${s.projects.length}): ${s.projects.join(" | ")}`);
    console.log(`skills: ${s.skills} | certs: ${s.certifications} | achievements: ${s.achievements}`);
    if (s.warnings.length) console.log(`warnings: ${s.warnings.join(" ; ")}`);
  }

  if (legacy && doclingCv) {
    console.log("\n--- DELTA ---");
    console.log(`education: legacy=${legacy.education.length} docling=${doclingCv.education.length}`);
    console.log(`experience: legacy=${legacy.experience.length} docling=${doclingCv.experience.length}`);
    console.log(`projects: legacy=${legacy.projects.length} docling=${doclingCv.projects.length}`);
    console.log(`skills: legacy=${Object.values(legacy.skills).flat().length} docling=${Object.values(doclingCv.skills).flat().length}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
