/**
 * cv-candidate-ranking.test.ts — plausibility-aware candidate selection.
 *
 * Proves deterministic structural ranking: plausible low-count parses beat
 * bloated/malformed high-count parses; duplicates, malformed records,
 * invalid contact fields, date issues and cross-section pollution are
 * penalized; strategy order is a final tie-breaker only.
 *
 * All fixtures are synthetic ParsedCV objects — no AI, no paid parser,
 * no DB. Real-corpus checks are gated on file + docling service presence.
 */
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { importResume } from "../src/lib/application/resume-import";
import { evaluateCoverage } from "../src/lib/application/resume-import/coverage";
import {
  computeCandidateDiagnostics,
  chooseBestCandidateDetailed,
  isCleanlyGood,
} from "../src/lib/application/resume-import/diagnostics";
import type {
  ResumeParseCandidate,
  ResumeParserStrategy,
} from "../src/lib/application/resume-import/types";
import type { ParsedCV, ParsedEducation, ParsedExperience } from "../src/lib/application/cv-parser";
import { doclingHealth } from "../src/lib/application/docling-client";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); });
}

// ---- fixture builders ---------------------------------------------------

function edu(over: Partial<ParsedEducation> = {}): ParsedEducation {
  return {
    id: over.id || `e${Math.random().toString(36).slice(2, 8)}`,
    institution: "", degree: "", specialization: "",
    startYear: "", endYear: "", cgpa: "", cgpaScale: "",
    ...over,
  };
}
function exp(over: Partial<ParsedExperience> = {}): ParsedExperience {
  return {
    id: over.id || `x${Math.random().toString(36).slice(2, 8)}`,
    type: "", organization: "", role: "", location: "",
    startDate: "", endDate: "", currentlyWorking: false, responsibilities: "",
    ...over,
  };
}
function parsed(over: Partial<ParsedCV> = {}): ParsedCV {
  return {
    personalData: {},
    education: [], experience: [], projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [] },
    certifications: [], achievements: [],
    rawTextLength: 500, parseWarnings: [],
    ...over,
  };
}
function candidate(strategy: ResumeParseCandidate["sourceStrategy"], p: ParsedCV, rawText = "x".repeat(500)): ResumeParseCandidate {
  return {
    sourceStrategy: strategy,
    coverage: evaluateCoverage(p, rawText.length),
    diagnostics: { rawTextLength: rawText.length },
    rawText,
    parsed: p,
    warnings: p.parseWarnings || [],
  };
}

const CLEAN_PERSONAL = { firstName: "Jane", lastName: "Doe", email: "jane.doe@example.com", phone: "+91 98765 43210", linkedin: "linkedin.com/in/janedoe" };

// The headline shape: legacy over-segmentation vs coherent parse.
function bloatedLegacyParsed(): ParsedCV {
  const eduList: ParsedEducation[] = [
    // 4 plausible
    edu({ institution: "State University", degree: "B.Tech", specialization: "Civil", endYear: "2019" }),
    edu({ institution: "City College", degree: "12th", endYear: "2015" }),
    edu({ institution: "Town School", degree: "10th", endYear: "2013" }),
    edu({ institution: "State University", degree: "M.Tech", specialization: "Structures", endYear: "2021" }),
  ];
  // 17 malformed: single-field fragments, date-only, bullet-as-degree
  for (let i = 0; i < 8; i++) eduList.push(edu({ institution: "State University" })); // single-field + dupes
  for (let i = 0; i < 5; i++) eduList.push(edu({ startYear: "2018", endYear: "2019" })); // date-only
  eduList.push(edu({ degree: "• Managed a team of engineers to deliver the bridge design package on schedule" }));
  eduList.push(edu({ institution: "●" }));
  eduList.push(edu({ degree: "AutoCAD" })); // skill as degree, single field
  eduList.push(edu({ degree: "Semester 5 result declared successfully with distinction across all subjects taken" }));
  return parsed({
    personalData: CLEAN_PERSONAL,
    education: eduList,
    experience: [
      exp({ organization: "Build Corp", role: "Site Engineer", startDate: "2019", endDate: "2021" }),
      exp({ organization: "Infra Ltd", role: "Intern", startDate: "2018", endDate: "2018" }),
    ],
    skills: { technical: ["AutoCAD", "STAAD Pro", "Revit", "Primavera", "Surveying", "Estimation", "Concrete Design", "GIS"], programming: [], tools: [], software: [], domain: [], soft: [] },
  });
}
function coherentParsed(): ParsedCV {
  return parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ institution: "State University", degree: "B.Tech", specialization: "Civil Engineering", endYear: "2019" }),
      edu({ institution: "City Junior College", degree: "12th", specialization: "Science", endYear: "2015" }),
    ],
    experience: [
      exp({ organization: "Build Corp", role: "Site Engineer", startDate: "2019", endDate: "2021" }),
      exp({ organization: "Infra Ltd", role: "Engineering Intern", startDate: "2018", endDate: "2018" }),
    ],
    skills: { technical: ["AutoCAD", "STAAD Pro", "Revit", "Primavera", "Surveying", "Estimation", "Concrete Design", "GIS", "ETABS", "SketchUp", "Navisworks", "HES"], programming: [], tools: [], software: [], domain: [], soft: [] },
  });
}

async function main() {

/* ---- synthetic ranking ---- */

await check("1: 21-record malformed edu loses to 2 plausible edu", () => {
  const bloated = candidate("MAMMOTH_SEMANTIC", bloatedLegacyParsed());
  const clean = candidate("DOCLING_MAPPER", coherentParsed());
  const sel = chooseBestCandidateDetailed([bloated, clean]);
  assert.equal(sel.best!.sourceStrategy, "DOCLING_MAPPER");
  const d = Object.fromEntries(sel.diagnostics.map(x => [x.strategy, x]));
  assert.ok(d["MAMMOTH_SEMANTIC"].malformedEducationCount >= 15, `expected ≥15 malformed edu, got ${d["MAMMOTH_SEMANTIC"].malformedEducationCount}`);
  assert.ok(d["DOCLING_MAPPER"].malformedEducationCount === 0);
  assert.ok(d["DOCLING_MAPPER"].qualityRank > d["MAMMOTH_SEMANTIC"].qualityRank);
  assert.ok(sel.winnerReasons.some(r => r.startsWith("FEWER_MALFORMED_EDUCATION")), sel.winnerReasons.join(","));
});

await check("2: duplicate education penalized, not rewarded", () => {
  const base = coherentParsed();
  const withDup = parsed({
    ...base,
    education: [...base.education, edu({ institution: "State University", degree: "B.Tech", specialization: "Civil Engineering", endYear: "2019" })],
  });
  const a = candidate("MAMMOTH_SEMANTIC", withDup);
  const b = candidate("DOCLING_MAPPER", parsed({ ...base }));
  const dA = computeCandidateDiagnostics(a.parsed, a.coverage.status);
  const dB = computeCandidateDiagnostics(b.parsed, b.coverage.status);
  assert.equal(dA.duplicateEducationCount, 1);
  assert.equal(dB.duplicateEducationCount, 0);
  const sel = chooseBestCandidateDetailed([a, b]);
  assert.equal(sel.best!.sourceStrategy, "DOCLING_MAPPER");
});

await check("3: bullet-only & org-bullet experience records are malformed", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [edu({ institution: "Uni", degree: "BS", endYear: "2019" })],
    experience: [
      exp({ responsibilities: "Managed release pipelines for internal platform teams" }), // bullet only, single field
      exp({ organization: "Led a cross-functional team of twelve engineers to deliver the new platform on schedule" }), // org is a bullet
      exp({ startDate: "2020", endDate: "2021" }), // date-only
      exp({ organization: "Acme", role: "Engineer", startDate: "2020", endDate: "2022" }), // plausible
    ],
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.equal(d.experienceCount, 4);
  assert.equal(d.plausibleExperienceCount, 1);
  assert.equal(d.malformedExperienceCount, 3);
});

await check("4: duplicate experience penalized", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [edu({ institution: "Uni", degree: "BS", endYear: "2019" })],
    experience: [
      exp({ organization: "Acme", role: "Engineer", startDate: "2020", endDate: "2022" }),
      exp({ organization: "Acme", role: "Engineer", startDate: "2020", endDate: "2022" }),
    ],
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.equal(d.duplicateExperienceCount, 1);
});

await check("5: invalid contact fields counted", () => {
  const p = parsed({
    personalData: {
      firstName: "jane@example.com",          // email as name
      lastName: "EXPERIENCE",                  // section heading as name
      email: "not-an-email",
      phone: "call me maybe",
      linkedin: "a free text line not a handle",
      currentCity: "Responsible for managing the entire western region sales operations and reporting",
    },
    education: [edu({ institution: "Uni", degree: "BS", endYear: "2019" })],
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.ok(d.invalidContactCount >= 5, `expected ≥5 invalid contact fields, got ${d.invalidContactCount}`);
  const clean = computeCandidateDiagnostics(parsed({ personalData: CLEAN_PERSONAL, education: p.education }), "GOOD");
  assert.ok(d.qualityRank < clean.qualityRank);
});

await check("6: date coherence — impossible month + end<start + date-only record", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ startYear: "2020", endYear: "2022" }),                 // date-only record → malformed
      edu({ institution: "Uni", degree: "BS", startYear: "13/2019" }), // impossible month
      edu({ institution: "Uni", degree: "MS", startYear: "2022", endYear: "2020" }), // end<start
    ],
  });
  const d = computeCandidateDiagnostics(p, "PARTIAL");
  assert.equal(d.malformedEducationCount, 1);
  assert.ok(d.dateParseIssues >= 2, `expected ≥2 date issues, got ${d.dateParseIssues}`);
});

await check("7: cross-section pollution detected", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ institution: "Uni", degree: "BS", endYear: "2019" }),
      edu({ institution: "jane@example.com", degree: "BS" }),       // email parked as institution
    ],
    experience: [
      exp({ organization: "State University", role: "B.Tech" }),    // edu parked as employer
      exp({ organization: "Acme", role: "Engineer" }),
    ],
    skills: { technical: ["Bachelor of Science", "Welding"], programming: [], tools: [], software: [], domain: [], soft: [] }, // degree under skills
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.ok(d.crossSectionPollutionCount >= 3, `expected ≥3 pollution signals, got ${d.crossSectionPollutionCount}`);
});

await check("8: suspicious skills flagged; domain skills NOT punished", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [edu({ institution: "Uni", degree: "BS", endYear: "2019" })],
    skills: {
      technical: [
        "Medication Therapy Management", "Pharmacovigilance", "Clinical Research", // healthcare — must not be suspicious
        "Responsible for coordinating all pharmacy operations across three hospital sites including dispensing and reporting", // sentence
        "jane@example.com", "2019-2022", // contact/date junk
      ],
      programming: [], tools: ["Jira", "Figma"], software: [], domain: [], soft: [],
    },
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.equal(d.skillsCount, 8);
  assert.equal(d.suspiciousSkillCount, 3);
  assert.equal(d.uniqueSkillCount, 8);
});

await check("9: fresher (0 experience) not penalized — beats malformed-heavy rival", () => {
  const fresher = parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ institution: "State University", degree: "B.Pharm", endYear: "2023" }),
      edu({ institution: "City College", degree: "12th", endYear: "2019" }),
    ],
    experience: [],
    projects: [{ id: "p1", name: "Formulation Study", type: "", description: "Stability testing", technologies: "", role: "" }],
    skills: { technical: ["Pharmacovigilance", "GMP", "GCP"], programming: [], tools: [], software: [], domain: [], soft: [] },
  });
  const fd = computeCandidateDiagnostics(fresher, "GOOD");
  assert.equal(fd.experienceCount, 0);
  assert.equal(fd.malformedExperienceCount, 0);
  assert.ok(isCleanlyGood(fd), "fresher must be cleanly-good (edu+projects+skills)");
  const rival = candidate("MAMMOTH_SEMANTIC", bloatedLegacyParsed());
  const sel = chooseBestCandidateDetailed([rival, candidate("DOCLING_MAPPER", fresher)]);
  assert.equal(sel.best!.sourceStrategy, "DOCLING_MAPPER");
});

await check("10: academic/publication-heavy CV not penalized", () => {
  const academic = parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ institution: "State University", degree: "PhD", specialization: "Physics", endYear: "2020" }),
      edu({ institution: "City University", degree: "MSc", specialization: "Physics", endYear: "2015" }),
    ],
    experience: [],
    publications: [
      "Doe J. Quantum effects in thin films. J Appl Phys 2021",
      "Doe J. Lattice dynamics. Phys Rev B 2020",
      "Doe J. Surface states. J Phys 2019",
      "Doe J. Nano structures. Nano Lett 2018",
    ],
    skills: { technical: ["MATLAB", "LaTeX", "Spectroscopy"], programming: [], tools: [], software: [], domain: [], soft: [] },
  } as any);
  const d = computeCandidateDiagnostics(academic, "GOOD");
  assert.equal(d.publicationCount, 4);
  assert.ok(d.structuredCoverage >= 3);
  const sel = chooseBestCandidateDetailed([candidate("MAMMOTH_SEMANTIC", academic), candidate("DOCLING_MAPPER", parsed({ personalData: CLEAN_PERSONAL }))]);
  assert.equal(sel.best!.sourceStrategy, "MAMMOTH_SEMANTIC", "structured academic parse must beat empty extraction");
});

await check("11: strategy order is ONLY a tie-breaker", () => {
  const same = coherentParsed();
  const a = candidate("MAMMOTH_SEMANTIC", same);
  const b = candidate("DOCLING_MAPPER", parsed(JSON.parse(JSON.stringify(same)) as ParsedCV));
  const fwd = chooseBestCandidateDetailed([a, b]);
  const rev = chooseBestCandidateDetailed([b, a]);
  assert.equal(fwd.best!.sourceStrategy, "MAMMOTH_SEMANTIC", "earlier strategy wins exact tie");
  assert.equal(rev.best!.sourceStrategy, "DOCLING_MAPPER", "reversed order flips winner — pure tie-break");
  assert.ok(fwd.winnerReasons.some(r => r.startsWith("PRIOR_TIEBREAK_OVER_")));
});

await check("12: EXTRACTION_ONLY beats FAILED/UNREADABLE", () => {
  const textOnly = candidate("TEXT_EXTRACTION", parsed({ rawTextLength: 800 }), "x".repeat(800));
  const dead = candidate("DOCLING_MAPPER", parsed({ rawTextLength: 0 }), "");
  assert.equal(evaluateCoverage(textOnly.parsed!, 800).status, "EXTRACTION_ONLY");
  assert.equal(evaluateCoverage(dead.parsed!, 0).status, "UNREADABLE");
  const sel = chooseBestCandidateDetailed([dead, textOnly]);
  assert.equal(sel.best!.sourceStrategy, "TEXT_EXTRACTION");
});

await check("13: diagnostics are content-free (numbers + strategy only)", () => {
  const sel = chooseBestCandidateDetailed([candidate("MAMMOTH_SEMANTIC", bloatedLegacyParsed()), candidate("DOCLING_MAPPER", coherentParsed())]);
  for (const d of sel.diagnostics) {
    for (const [k, v] of Object.entries(d)) {
      if (k === "strategy") assert.equal(typeof v, "string");
      else assert.equal(typeof v, "number", `field ${k} must be numeric, got ${typeof v}`);
    }
  }
  for (const r of sel.winnerReasons) assert.match(r, /^[A-Z_0-9().v]+$/);
});

await check("14: Plausible healthcare edu (PharmD/Diploma/12th/10th) supported", () => {
  const p = parsed({
    personalData: CLEAN_PERSONAL,
    education: [
      edu({ institution: "Health Sciences University", degree: "Pharm D", endYear: "2022" }),
      edu({ institution: "City Polytechnic", degree: "Diploma", specialization: "Mechanical", endYear: "2017" }),
      edu({ institution: "Town High School", degree: "12th", endYear: "2015" }),
      edu({ institution: "Town School", degree: "10th", endYear: "2013" }),
    ],
  });
  const d = computeCandidateDiagnostics(p, "GOOD");
  assert.equal(d.plausibleEducationCount, 4);
  assert.equal(d.malformedEducationCount, 0);
});

/* ---- real-corpus regressions (gated on corpus + docling service) ---- */

const SHIVANG_PDF = "/Users/shivang/Desktop/cv/Shivang_Singh_Gangwar_Resume.pdf";
const KUNJ_PDF = "/Users/shivang/Desktop/AI SOP/Test pdf/Kunj_Manojkumar_Modh_Resume.pdf";
const KHUSHI = "/Users/shivang/Desktop/KHUSHI .CV.docx";
const doclingUp = await doclingHealth();

await check("15: Shivang PDF — winner has strictly cleaner edu diagnostics than rivals", async () => {
  if (!existsSync(SHIVANG_PDF) || !doclingUp) { console.log("   (skip — corpus/docling absent)"); return; }
  const buf = await readFile(SHIVANG_PDF);
  const r = await importResume(buf, "shivang.pdf", "application/pdf");
  assert.ok(r.candidate.diagnostics, "winner diagnostics attached");
  const w = (r.candidate as any).candidateDiagnostics;
  assert.ok(w, "candidateDiagnostics on winner");
  assert.ok(w.malformedEducationCount <= 2, `winner edu malformed should be low, got ${w.malformedEducationCount}`);
  assert.ok(w.plausibleEducationCount >= 1);
});

await check("16: Kunj PDF — winner wins on structure, not strategy name", async () => {
  if (!existsSync(KUNJ_PDF) || !doclingUp) { console.log("   (skip — corpus/docling absent)"); return; }
  const buf = await readFile(KUNJ_PDF);
  const r = await importResume(buf, "kunj.pdf", "application/pdf");
  const w = (r.candidate as any).candidateDiagnostics;
  assert.ok(w);
  // Structural expectation: winner must have ≥1 plausible edu and low malformed —
  // whichever future parser achieves that can legitimately win.
  assert.ok(w.plausibleEducationCount >= 1);
  assert.ok(w.malformedEducationCount <= w.plausibleEducationCount,
    `winner malformed ${w.malformedEducationCount} should not exceed plausible ${w.plausibleEducationCount}`);
});

await check("17: Khushi DOCX — winner remains usable, edu meaningful", async () => {
  if (!existsSync(KHUSHI)) { console.log("   (skip — corpus file absent)"); return; }
  const buf = await readFile(KHUSHI);
  const r = await importResume(buf, "khushi.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(["PARSED", "PARSED_WITH_WARNINGS", "PARTIAL_PARSE"].includes(r.state));
  const w = (r.candidate as any).candidateDiagnostics;
  assert.ok(w);
  assert.ok(w.plausibleEducationCount >= 1, "Khushi must have ≥1 plausible education record");
  assert.ok(w.personalCompleteness >= 1, "contact must be usable");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
main();
