// ============================================================
// AFFINDA RESUME PARSER BENCHMARK RUNNER
// ============================================================
// Usage:
//   npx tsx scripts/affinda-benchmark/generate-fixtures.ts   # once
//   AFFINDA_API_KEY=... AFFINDA_WORKSPACE_ID=... \
//   AFFINDA_DOCUMENT_TYPE_ID=... \
//   npx tsx scripts/affinda-benchmark/run-benchmark.ts
//
// Behavior:
//   - Current parser(s): legacy + docling (if sidecar up) — no writes
//   - Affinda: POST /v3/documents wait=true — raw JSON persisted ONLY
//     to test-output/affinda/raw/<label>.json (gitignored)
//   - Adapter: Affinda -> ResumeCandidate, Zod-validated
//   - Grounding: each structured value checked against extracted
//     source text; unsupported values counted + listed in artifacts
//   - NO profile writes, NO production routing, NO OpenAI calls
// ============================================================

import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, join } from "path";

import { ALL_ENTRIES, type CorpusEntry } from "./corpus";
import {
  affindaConfigured,
  parseWithAffinda,
  type AffindaCallResult,
} from "./affinda-client";
import {
  mapAffindaToCandidate,
  summarizeAffinda,
  type AffindaSummary,
} from "./affinda-adapter";
import { parseCVFile, type ParsedCV } from "../../src/lib/application/cv-parser";
import { parseWithDocling, doclingHealth } from "../../src/lib/application/docling-client";
import { mapDoclingToParsedCV } from "../../src/lib/application/cv-mapper-docling";

const ART_DIR = join(process.cwd(), "test-output", "affinda");
const RAW_DIR = join(ART_DIR, "raw");

// ---------- summaries ----------

function summarizeParsedCV(cv: ParsedCV) {
  return {
    name: `${cv.personalData.firstName || ""} ${cv.personalData.lastName || ""}`.trim(),
    email: cv.personalData.email || "",
    phone: cv.personalData.phone || "",
    location: [cv.personalData.currentCity, cv.personalData.currentCountry].filter(Boolean).join(", "),
    linkedin: cv.personalData.linkedin || "",
    educationCount: cv.education.length,
    experienceCount: cv.experience.length,
    projectCount: cv.projects.length,
    skillCount:
      cv.skills.technical.length + cv.skills.programming.length +
      cv.skills.tools.length + (cv.skills.software?.length || 0) +
      cv.skills.domain.length + cv.skills.soft.length,
    certificationCount: cv.certifications.length,
    achievementCount: cv.achievements.length,
    publicationCount: 0, // no slot in ParsedCV
    languageCount: 0, // no slot in ParsedCV
    volunteerOtherCount: 0,
    experiences: cv.experience.map((e) => ({ role: e.role, org: e.organization, dates: `${e.startDate} - ${e.endDate}` })),
    educations: cv.education.map((e) => ({ degree: e.degree, inst: e.institution, dates: `${e.startYear} - ${e.endYear}` })),
    warnings: cv.parseWarnings,
  };
}

// ---------- invented-data (grounding) check ----------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** alpha token bag of source text */
function sourceBag(text: string): Set<string> {
  return new Set(norm(text).split(" ").filter((t) => t.length > 1));
}

/** Does a value have token-level support in the source text? */
function supported(value: string, src: string, bag: Set<string>): boolean {
  const v = norm(value);
  if (!v) return true;
  if (src.includes(v)) return true;
  const toks = v.split(" ").filter((t) => t.length > 2);
  if (!toks.length) return true;
  const hits = toks.filter((t) => bag.has(t) || src.includes(t));
  return hits.length / toks.length >= 0.6;
}

interface GroundingResult {
  checked: number;
  unsupported: number;
  unsupportedValues: string[];
}

function checkGrounding(data: any, sourceText: string): GroundingResult {
  const src = norm(sourceText);
  const bag = sourceBag(sourceText);
  const unsupportedValues: string[] = [];
  let checked = 0;
  const chk = (v: unknown, label: string) => {
    const t = typeof v === "string" ? v : "";
    if (!t.trim()) return;
    checked++;
    if (!supported(t, src, bag)) unsupportedValues.push(`${label}: ${t.slice(0, 120)}`);
  };

  const d = data ?? {};
  chk(d.name?.raw, "name");
  for (const e of d.emails || []) chk(e, "email");
  // phones: digit-substring check
  for (const ph of d.phoneNumbers || []) {
    const t = String(ph); checked++;
    const dv = digits(t);
    const srcDigits = digits(sourceText);
    if (dv && !srcDigits.includes(dv.slice(-7))) unsupportedValues.push(`phone: ${t.slice(0, 60)}`);
  }
  for (const w of d.websites || []) chk(w, "website");
  chk(d.linkedin, "linkedin");
  const loc = d.location || {};
  chk(loc.city, "location.city");
  chk(loc.country, "location.country");
  chk(loc.state, "location.state");

  for (const e of d.education || []) {
    chk(e.organization, "edu.org");
    chk(e.accreditation?.education, "edu.degree");
    chk(e.accreditation?.educationLevel, "edu.level");
    if (e.grade?.raw) chk(e.grade.raw, "edu.grade");
  }
  for (const w of d.workExperience || []) {
    chk(w.organization, "exp.org");
    chk(w.jobTitle, "exp.role");
    chk(w.location?.formatted, "exp.location");
  }
  for (const sk of d.skills || []) chk(sk?.name ?? sk, "skill");
  for (const c of d.certifications || []) chk(c, "certification");
  for (const p of d.publications || []) chk(typeof p === "string" ? p : p?.title, "publication");
  for (const l of d.languages || []) chk(l, "language");

  return { checked, unsupported: unsupportedValues.length, unsupportedValues };
}

// ---------- per-file run ----------

interface FileResult {
  label: string;
  file: string;
  format: string;
  kind: string;
  sizeBytes: number;
  legacy?: { ok: boolean; summary?: any; error?: string };
  docling?: { ok: boolean; summary?: any; error?: string; durationMs?: number };
  affinda?: {
    meta: AffindaCallResult["meta"];
    failureCode?: string;
    errorDetail?: string;
    summary?: AffindaSummary;
    zodOk?: boolean;
    zodErrors?: string[];
    unmapped?: Record<string, number>;
    grounding?: GroundingResult;
  };
}

async function extractSourceText(buffer: Buffer, filename: string): Promise<string> {
  try {
    const { extractTextFromFile } = await import("../../src/lib/application/cv-parser");
    return await extractTextFromFile(buffer, filename);
  } catch {
    return "";
  }
}

async function runEntry(entry: CorpusEntry): Promise<FileResult> {
  const result: FileResult = {
    label: entry.label,
    file: basename(entry.file),
    format: entry.format,
    kind: entry.kind,
    sizeBytes: 0,
  };
  if (!existsSync(entry.file)) {
    result.legacy = { ok: false, error: `file not found: ${entry.file}` };
    return result;
  }
  const buffer = await readFile(entry.file);
  result.sizeBytes = buffer.length;
  const filename = basename(entry.file);

  // --- current parsers ---
  try {
    const cv = await parseCVFile(buffer, filename);
    result.legacy = { ok: true, summary: summarizeParsedCV(cv) };
  } catch (e: any) {
    result.legacy = { ok: false, error: `${e?.code || "ERR"}: ${String(e?.userMessage || e?.message || e).slice(0, 120)}` };
  }

  if (await doclingHealth()) {
    try {
      const t0 = Date.now();
      const doc = await parseWithDocling(buffer, filename);
      const cv = mapDoclingToParsedCV(doc);
      result.docling = { ok: true, summary: summarizeParsedCV(cv), durationMs: Date.now() - t0 };
    } catch (e: any) {
      result.docling = { ok: false, error: `${e?.code || "ERR"}: ${String(e?.message || e).slice(0, 120)}` };
    }
  }

  // --- affinda ---
  if (affindaConfigured()) {
    const r = await parseWithAffinda(buffer, filename);
    const a: NonNullable<FileResult["affinda"]> = {
      meta: r.meta,
      failureCode: r.failureCode,
      errorDetail: r.errorDetail,
    };
    if (r.raw) {
      await writeFile(join(RAW_DIR, `${entry.label}.affinda.json`), JSON.stringify(r.raw, null, 2));
      const { candidate, zodOk, zodErrors, unmapped } = mapAffindaToCandidate(r.raw.data ?? r.raw);
      a.summary = summarizeAffinda(r.raw.data ?? r.raw, { candidate, zodOk, zodErrors, unmapped });
      a.zodOk = zodOk;
      a.zodErrors = zodErrors;
      a.unmapped = unmapped;
      const sourceText = await extractSourceText(buffer, filename);
      a.grounding = checkGrounding(r.raw.data ?? r.raw, sourceText);
    }
    result.affinda = a;
  }

  return result;
}

// ---------- report ----------

function row(label: string, s: any): string {
  if (!s) return `${label}: —`;
  return `${label}: name="${s.name}" email=${s.email || "—"} | edu=${s.educationCount} exp=${s.experienceCount} proj=${s.projectCount} skills=${s.skillCount} cert=${s.certificationCount} ach=${s.achievementCount} pub=${s.publicationCount ?? 0} lang=${s.languageCount ?? 0}`;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const affindaOn = affindaConfigured();
  const doclingUp = await doclingHealth();

  console.log("=".repeat(72));
  console.log("AFFINDA RESUME PARSER BENCHMARK");
  console.log(`affinda configured: ${affindaOn} | docling sidecar: ${doclingUp}`);
  console.log(`artifacts: ${ART_DIR}`);
  console.log("=".repeat(72));

  const results: FileResult[] = [];
  for (const entry of ALL_ENTRIES) {
    process.stdout.write(`\n>>> ${entry.label} (${entry.format}) ... `);
    const r = await runEntry(entry);
    results.push(r);
    console.log("done");
    console.log(`  ${row("LEGACY ", r.legacy?.summary)}${r.legacy && !r.legacy.ok ? " FAIL " + r.legacy.error : ""}`);
    console.log(`  ${row("DOCLING", r.docling?.summary)}${r.docling && !r.docling.ok ? " FAIL " + r.docling.error : ""}${r.docling?.durationMs ? ` (${r.docling.durationMs}ms)` : ""}`);
    if (r.affinda) {
      console.log(`  AFFINDA http=${r.affinda.meta.httpStatus} ${r.affinda.meta.durationMs}ms resumeP=${r.affinda.meta.isResumeProbability ?? "n/a"} qual=${r.affinda.meta.extractionQuality ?? "n/a"}${r.affinda.failureCode ? " CODE=" + r.affinda.failureCode : ""}`);
      console.log(`  ${row("AFFINDA", r.affinda.summary)}`);
      if (r.affinda.grounding)
        console.log(`    grounding: ${r.affinda.grounding.unsupported} unsupported of ${r.affinda.grounding.checked}`);
      if (r.affinda.unmapped && Object.keys(r.affinda.unmapped).length)
        console.log(`    unmapped vendor fields: ${JSON.stringify(r.affinda.unmapped)}`);
    } else {
      console.log("  AFFINDA: skipped (no credentials)");
    }
  }

  await writeFile(join(ART_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${join(ART_DIR, "results.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
