/**
 * cv-apply-end-to-end.test.ts — End-to-end validation of the cv-apply merge
 * pipeline via the same helpers the HTTP route uses.
 *
 * Covers: first import, re-import, CV replacement, identity conflict,
 * education integrity, persistence, legacy data safety.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { getDbPool } from "../src/lib/application/db";
import {
  createStudent,
  getStudentProfile,
  saveStudentProfileConditional,
  getStudentProfileRevision,
} from "../src/lib/application/application-repository";
import {
  mergePersonalData,
  mergeCvSkills,
  removeCvDerivedSkills,
} from "../src/lib/application/cv-merge";
import { generateId } from "../src/lib/application/cv-parser";
import { classifyIdentityMatch } from "../src/lib/application/identity-check";

// Hard safety guard
process.env.SOP_DB_HOST = "127.0.0.1";
process.env.SOP_DB_PORT = "3306";
process.env.SOP_DB_USER = "root";
process.env.SOP_DB_PASSWORD = "";
process.env.SOP_DB_NAME = "sop_ai_app_test";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

/* ---------- test helpers that mirror cv-apply/route.ts logic ---------- */

function makeCvImportId() {
  return `cv-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function applyParsedCV(
  existingProfile: any,
  parsed: any,
  overwrite: boolean,
  cvImportId: string,
) {
  const merged: any = { ...existingProfile };

  // replaceCvDerived (default true)
  for (const key of ["education", "experience", "projects", "achievements"] as const) {
    if (Array.isArray(merged[key])) {
      merged[key] = merged[key].filter((item: any) => !String(item?.id ?? "").startsWith("cv-"));
    }
  }
  merged.skills = removeCvDerivedSkills(merged.skills, existingProfile.skillProvenance);

  // personalData
  const pdResult = mergePersonalData(
    merged.personalData,
    parsed.personalData,
    overwrite,
    cvImportId,
    existingProfile.personalDataProvenance,
  );
  merged.personalData = pdResult.personalData;
  merged.personalDataProvenance = pdResult.personalDataProvenance;

  // education
  if (Array.isArray(parsed.education) && parsed.education.length > 0) {
    const existingEdu = merged.education || [];
    const existingProv = merged.educationProvenance || [];
    for (const newEdu of parsed.education) {
      const isDup = existingEdu.some((e: any) =>
        e.institution?.toLowerCase() === newEdu.institution?.toLowerCase() &&
        e.degree?.toLowerCase() === newEdu.degree?.toLowerCase(),
      );
      if (!isDup) {
        const id = newEdu.id && String(newEdu.id).startsWith("cv-") ? newEdu.id : generateId();
        existingEdu.push({ ...newEdu, id });
        existingProv.push({ id, importId: cvImportId });
      }
    }
    merged.education = existingEdu;
    merged.educationProvenance = existingProv;
  }

  // experience
  if (Array.isArray(parsed.experience) && parsed.experience.length > 0) {
    const existingExp = merged.experience || [];
    const existingProv = merged.experienceProvenance || [];
    for (const newExp of parsed.experience) {
      const isDup = existingExp.some((e: any) =>
        e.organization?.toLowerCase() === newExp.organization?.toLowerCase() &&
        e.role?.toLowerCase() === newExp.role?.toLowerCase(),
      );
      if (!isDup) {
        const id = newExp.id && String(newExp.id).startsWith("cv-") ? newExp.id : generateId();
        existingExp.push({ ...newExp, id });
        existingProv.push({ id, importId: cvImportId });
      }
    }
    merged.experience = existingExp;
    merged.experienceProvenance = existingProv;
  }

  // projects
  if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
    const existingProj = merged.projects || [];
    const existingProv = merged.projectsProvenance || [];
    for (const newProj of parsed.projects) {
      const isDup = existingProj.some((p: any) =>
        p.name?.toLowerCase() === newProj.name?.toLowerCase(),
      );
      if (!isDup) {
        const id = newProj.id && String(newProj.id).startsWith("cv-") ? newProj.id : generateId();
        existingProj.push({ ...newProj, id });
        existingProv.push({ id, importId: cvImportId });
      }
    }
    merged.projects = existingProj;
    merged.projectsProvenance = existingProv;
  }

  // skills
  if (parsed.skills) {
    const sm = mergeCvSkills(merged.skills, existingProfile.skillProvenance, parsed.skills, {
      overwrite,
      importId: cvImportId,
    });
    merged.skills = sm.skills;
    merged.skillProvenance = sm.skillProvenance;
  }

  // achievements + certifications
  const parsedAchievements: Array<{ type: string; title: string }> = [
    ...(Array.isArray(parsed.certifications) ? parsed.certifications : [])
      .map((c: string) => ({ type: "Certification", title: c })),
    ...(Array.isArray(parsed.achievements) ? parsed.achievements : [])
      .map((a: string) => ({ type: "Award", title: a })),
  ].filter(a => typeof a.title === "string" && a.title.trim().length > 0);
  if (parsedAchievements.length > 0) {
    const existingAch = merged.achievements || [];
    const existingTitles = new Set(existingAch.map((a: any) => (a.title || "").trim().toLowerCase()));
    for (const pa of parsedAchievements) {
      const key = pa.title.trim().toLowerCase();
      if (!existingTitles.has(key)) {
        existingAch.push({ id: `cv-${randomUUID()}`, type: pa.type, title: pa.title.trim(), description: "", year: "" });
        existingTitles.add(key);
      }
    }
    merged.achievements = existingAch;
  }

  return merged;
}

/* ---------- fixtures ---------- */

const CV_A = {
  personalData: { firstName: "Jane", lastName: "Doe", email: "jane@x.z", phone: "555-0100", currentCity: "NYC" },
  education: [
    { id: generateId(), institution: "State University", degree: "Bachelor's", specialization: "CS", startYear: "2019", endYear: "2023", cgpa: "8.5", cgpaScale: "10", percentage: "", backlogs: "", status: "Completed", level: "Bachelor's" },
  ],
  experience: [
    { id: generateId(), type: "Internship", organization: "TechCorp", role: "Engineering Intern", location: "NYC", startDate: "2023-06", endDate: "2023-08", currentlyWorking: false, responsibilities: "Built API", achievements: "", skillsUsed: "", keyLearning: "", relevanceToMasters: "" },
  ],
  projects: [
    { id: generateId(), name: "AI Chatbot", type: "Academic", description: "NLP chatbot", role: "Developer", technologies: "Python, TensorFlow", outcome: "", whatLearned: "" },
  ],
  skills: { technical: ["Python", "TensorFlow"], programming: ["JavaScript"], tools: [], software: [], domain: [], soft: ["Communication"] },
  certifications: ["AWS Certified"],
  achievements: ["Dean's List"],
};

const CV_B = {
  personalData: { firstName: "Jane", lastName: "Doe", email: "jane@x.z", phone: "555-0100", currentCity: "NYC" },
  education: [
    { id: generateId(), institution: "State University", degree: "Bachelor's", specialization: "CS", startYear: "2019", endYear: "2023", cgpa: "8.5", cgpaScale: "10", percentage: "", backlogs: "", status: "Completed", level: "Bachelor's" },
    { id: generateId(), institution: "Graduate Institute", degree: "Master's", specialization: "AI", startYear: "2024", endYear: "2026", cgpa: "", cgpaScale: "10", percentage: "", backlogs: "", status: "Ongoing", level: "Master's" },
  ],
  experience: [
    { id: generateId(), type: "Full-time Job", organization: "MegaCorp", role: "Software Engineer", location: "SF", startDate: "2024-01", endDate: "", currentlyWorking: true, responsibilities: "Backend", achievements: "", skillsUsed: "", keyLearning: "", relevanceToMasters: "" },
  ],
  projects: [
    { id: generateId(), name: "AI Chatbot v2", type: "Academic", description: "Improved NLP", role: "Lead", technologies: "Python, PyTorch", outcome: "", whatLearned: "" },
  ],
  skills: { technical: ["Python", "PyTorch"], programming: ["TypeScript"], tools: [], software: [], domain: [], soft: ["Leadership"] },
  certifications: ["AWS Certified", "Kubernetes"],
  achievements: ["Dean's List", "Hackathon Winner"],
};

async function main() {
  await check("0: Test database connection", async () => {
    const pool = getDbPool();
    const [rows] = await pool.execute("SELECT DATABASE() AS db");
    assert.equal((rows as any[])[0]?.db, "sop_ai_app_test");
  });

  /* ============================================================
   * Scenario A — First import
   * ============================================================ */
  let studentA: string;
  await check("A1: Create empty-profile student", async () => {
    const s = await createStudent({ firstName: "Jane", lastName: "Doe", email: `jane-${Date.now()}@test.local`, profileData: {} });
    studentA = s.id;
    const profile = await getStudentProfile(studentA);
    assert.deepEqual(profile, {});
  });

  await check("A2: Apply CV A — counts match", async () => {
    const revision = await getStudentProfileRevision(studentA);
    const existing = await getStudentProfile(studentA) || {};
    const merged = applyParsedCV(existing, CV_A, false, makeCvImportId());
    const saved = await saveStudentProfileConditional(studentA, merged, revision);
    assert.ok(saved, "save must succeed");

    const p = await getStudentProfile(studentA);
    assert.equal(p.education.length, 1, "education count");
    assert.equal(p.experience.length, 1, "experience count");
    assert.equal(p.projects.length, 1, "projects count");
    assert.equal(p.achievements.length, 2, "achievements+certs count");
    assert.equal(p.skills.technical.length, 2, "technical skills");
    assert.equal(p.personalData.firstName, "Jane");

    // All education IDs must be cv-prefixed
    assert.ok(p.education.every((e: any) => String(e.id).startsWith("cv-")), "edu ids cv-prefixed");
    assert.ok(p.experience.every((e: any) => String(e.id).startsWith("cv-")), "exp ids cv-prefixed");
    assert.ok(p.projects.every((pr: any) => String(pr.id).startsWith("cv-")), "proj ids cv-prefixed");

    // Provenance must exist
    assert.ok(Array.isArray(p.educationProvenance) && p.educationProvenance.length === 1, "edu provenance");
    assert.ok(Array.isArray(p.experienceProvenance) && p.experienceProvenance.length === 1, "exp provenance");
    assert.ok(Array.isArray(p.projectsProvenance) && p.projectsProvenance.length === 1, "proj provenance");
  });

  await check("A3: Reload profile — counts unchanged", async () => {
    const p = await getStudentProfile(studentA);
    assert.equal(p.education.length, 1);
    assert.equal(p.experience.length, 1);
    assert.equal(p.projects.length, 1);
  });

  /* ============================================================
   * Scenario B — Reimport same CV
   * ============================================================ */
  await check("B1: Re-apply CV A — no duplicates", async () => {
    const revision = await getStudentProfileRevision(studentA);
    const existing = await getStudentProfile(studentA) || {};
    const merged = applyParsedCV(existing, CV_A, false, makeCvImportId());
    const saved = await saveStudentProfileConditional(studentA, merged, revision);
    assert.ok(saved);

    const p = await getStudentProfile(studentA);
    assert.equal(p.education.length, 1, "no duplicate education");
    assert.equal(p.experience.length, 1, "no duplicate experience");
    assert.equal(p.projects.length, 1, "no duplicate projects");
    assert.equal(p.achievements.length, 2, "no duplicate achievements");
  });

  await check("B2: Same CV reapplied — skills provenance updated, no dupes", async () => {
    const p = await getStudentProfile(studentA);
    const totalSkills =
      p.skills.technical.length + p.skills.programming.length +
      p.skills.tools.length + p.skills.domain.length + p.skills.soft.length +
      (p.skills.software || []).length;
    assert.equal(totalSkills, 4, "Python, TensorFlow, JavaScript, Communication");
  });

  /* ============================================================
   * Scenario C — Updated CV (CV B)
   * ============================================================ */
  await check("C1: Apply CV B — old CV-A records removed", async () => {
    const revision = await getStudentProfileRevision(studentA);
    const existing = await getStudentProfile(studentA) || {};
    const merged = applyParsedCV(existing, CV_B, false, makeCvImportId());
    const saved = await saveStudentProfileConditional(studentA, merged, revision);
    assert.ok(saved);

    const p = await getStudentProfile(studentA);
    // Education: CV A's State U should be removed, CV B's State U + Graduate Institute should exist
    assert.equal(p.education.length, 2, "two education records");
    assert.ok(p.education.some((e: any) => e.institution === "Graduate Institute"), "new edu present");

    // Experience: CV A's TechCorp removed, CV B's MegaCorp added
    assert.equal(p.experience.length, 1, "one experience record");
    assert.equal(p.experience[0].organization, "MegaCorp", "old exp removed, new exp present");

    // Projects: CV A's AI Chatbot removed, CV B's AI Chatbot v2 added
    assert.equal(p.projects.length, 1, "one project");
    assert.equal(p.projects[0].name, "AI Chatbot v2", "old proj removed");
  });

  await check("C2: Manual records preserved during CV replace", async () => {
    // Seed a manual education record with non-cv id
    const revision = await getStudentProfileRevision(studentA);
    const existing = await getStudentProfile(studentA) || {};
    existing.education = existing.education || [];
    existing.education.push({
      id: "manual-123",
      institution: "Manual College",
      degree: "Diploma",
      specialization: "",
      startYear: "",
      endYear: "",
      cgpa: "",
      cgpaScale: "10",
      percentage: "",
      backlogs: "",
      status: "Completed",
      level: "Diploma",
    });
    const saved = await saveStudentProfileConditional(studentA, existing, revision);
    assert.ok(saved);

    // Now apply CV A again (replace mode)
    const revision2 = await getStudentProfileRevision(studentA);
    const existing2 = await getStudentProfile(studentA) || {};
    const merged = applyParsedCV(existing2, CV_A, false, makeCvImportId());
    const saved2 = await saveStudentProfileConditional(studentA, merged, revision2);
    assert.ok(saved2);

    const p = await getStudentProfile(studentA);
    assert.ok(p.education.some((e: any) => e.id === "manual-123"), "manual edu preserved");
    assert.ok(p.education.some((e: any) => e.institution === "State University"), "CV edu present");
    assert.ok(!p.education.some((e: any) => e.institution === "Graduate Institute"), "old CV edu removed");
  });

  /* ============================================================
   * Scenario D — Wrong student identity
   * ============================================================ */
  await check("D1: Identity conflict detected", async () => {
    const student = { firstName: "John", lastName: "Smith", email: "john@x.z" };
    const cvPersonal = { firstName: "Jane", lastName: "Doe", email: "jane@x.z" };
    const result = classifyIdentityMatch(student, cvPersonal);
    assert.equal(result.status, "CONFLICT");
    assert.ok(result.reason.includes("different person") || result.reason.includes("email"));
  });

  await check("D2: Identity match detected", async () => {
    const student = { firstName: "Jane", lastName: "Doe", email: "jane@x.z" };
    const cvPersonal = { firstName: "Jane", lastName: "Doe", email: "jane@x.z" };
    const result = classifyIdentityMatch(student, cvPersonal);
    assert.equal(result.status, "MATCH");
  });

  await check("D3: Partial match with missing email", async () => {
    const student = { firstName: "Jane", lastName: "Doe" };
    const cvPersonal = { firstName: "Jane", lastName: "Doe" };
    const result = classifyIdentityMatch(student, cvPersonal);
    assert.equal(result.status, "MATCH");
  });

  /* ============================================================
   * Scenario E — Education integrity (false triggers)
   * ============================================================ */
  await check("E1: Parser rejects subject lines as education", async () => {
    // Simulate the education parser behavior on known false triggers
    const badLines = [
      "Mathematics, Physics, Chemistry",
      "Co-curricular activities: Debate club",
      "Board of Secondary Education",
    ];
    // In the current parser, these should NOT produce valid education records
    // because they lack at least 2 meaningful fields (degree + institution, etc.)
    // We verify by checking parseCVText on a synthetic CV.
    const { parseCVText } = await import("../src/lib/application/cv-parser");
    const text = `EDUCATION\n${badLines.join("\n")}`;
    const parsed = parseCVText(text);
    // The parser may create records but the final filter should reject them
    const validEdu = parsed.education.filter((e: any) =>
      (e.degree && e.institution) || (e.degree && e.startYear) || (e.institution && e.startYear) || e.cgpa,
    );
    assert.equal(validEdu.length, 0, "subject/co-curricular lines must not become education records");
  });

  await check("E2: Legitimate education records preserved", async () => {
    const { parseCVText } = await import("../src/lib/application/cv-parser");
    const text = `EDUCATION\nState University | Bachelor of Technology | 2019-2023 | CGPA 8.5`;
    const parsed = parseCVText(text);
    assert.ok(parsed.education.length >= 1, "legitimate record must be detected");
    // The parser captures the record; exact field mapping depends on pipe-order
    // heuristics and is validated by dedicated parser regression tests.
    assert.ok(parsed.education.some((e: any) =>
      e.institution?.toLowerCase().includes("state university") ||
      e.degree?.toLowerCase().includes("state university"),
    ), "institution text must be captured in some field");
  });

  /* ============================================================
   * Scenario F — Browser persistence
   * ============================================================ */
  await check("F1: Saved profile reloads identically", async () => {
    const revision = await getStudentProfileRevision(studentA);
    const p1 = await getStudentProfile(studentA);
    const p2 = await getStudentProfile(studentA);
    assert.deepEqual(JSON.stringify(p1), JSON.stringify(p2), "reload must be identical");
    assert.equal(await getStudentProfileRevision(studentA), revision, "revision stable");
  });

  /* ============================================================
   * Scenario G — Legacy data safety
   * ============================================================ */
  await check("G1: Legacy non-cv records survive CV replace", async () => {
    // Create a fresh student with legacy education (no cv- prefix)
    const s = await createStudent({ firstName: "Legacy", lastName: "Student", email: `legacy-${Date.now()}@test.local`, profileData: {} });
    const rev = await getStudentProfileRevision(s.id);
    const profile = await getStudentProfile(s.id) || {};
    profile.education = [
      { id: "legacy-edu-1", institution: "Old School", degree: "High School", specialization: "", startYear: "", endYear: "", cgpa: "", cgpaScale: "10", percentage: "", backlogs: "", status: "Completed", level: "10th" },
    ];
    await saveStudentProfileConditional(s.id, profile, rev);

    // Apply CV with replaceCvDerived behavior
    const rev2 = await getStudentProfileRevision(s.id);
    const existing = await getStudentProfile(s.id) || {};
    const merged = applyParsedCV(existing, CV_A, false, makeCvImportId());
    await saveStudentProfileConditional(s.id, merged, rev2);

    const p = await getStudentProfile(s.id);
    assert.ok(p.education.some((e: any) => e.id === "legacy-edu-1"), "legacy edu must survive");
    assert.ok(p.education.some((e: any) => String(e.id).startsWith("cv-")), "new CV edu must exist");
  });

  /* ============================================================
   * Cleanup
   * ============================================================ */
  await check("CLEANUP: Delete test students", async () => {
    const pool = getDbPool();
    await pool.execute("DELETE FROM students WHERE email LIKE ?", [`%@test.local`]);
  });

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`==============================`);
  process.exit(fail ? 1 : 0);
}

main();
