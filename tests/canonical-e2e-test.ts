/**
 * @file canonical-e2e-test.ts
 * @description
 * PHASE RELEASE-40 Part S: End-to-end canonical consultant journey.
 *
 * NEW APPLICANT flow (all through real API handlers + test DB):
 *   create student → create application → save full 9-section profile
 *   → resolve prompt (no intake/year — the production bug path)
 *   → create document from DEFAULT_TEMPLATE resolution
 *   → verify generation gate is UNBLOCKED (profile complete)
 *   → consultant saves a version → approves it → exports final PDF
 *
 * EXISTING STUDENT flow:
 *   second application on same student → profile reused
 *   → resolve prompt → create document
 *
 * No OpenAI calls — generation itself is exercised via the 422 contract
 * in api-contract-tests.ts and the readiness gate here.
 *
 * Run: npx tsx tests/canonical-e2e-test.ts
 */

import "./test-setup";
import { NextRequest } from "next/server";
import { closeDbPool, assertTestDatabase, cleanupTestDb } from "./test-setup";
import { POST as createStudentPOST } from "../src/app/api/application/student/route";
import { POST as createApplicationPOST } from "../src/app/api/application/create/route";
import { PUT as profilePUT, GET as profileGET } from "../src/app/api/application/profile/route";
import { POST as documentPOST } from "../src/app/api/application/document/route";
import { POST as resolvePromptPOST } from "../src/app/api/requirements/resolve-prompt/route";
import { POST as versionPOST, GET as versionGET } from "../src/app/api/application/version/route";
import { POST as approvePOST } from "../src/app/api/application/version/approve/route";
import { POST as exportPOST } from "../src/app/api/application/document/export/route";
import { GET as listGET } from "../src/app/api/application/list/route";
import { getProfileReadiness } from "../src/lib/application/intake-completion";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ FAIL: ${message}`); }
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function put(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "GET" });
}

// ~900 real words so approval passes the SOP template's 800-1000 word gate
const sopText = Array.from({ length: 36 }, (_, i) =>
  `Paragraph ${i + 1}. During my studies and internships I built practical systems, learned from mentors, and shipped measurable outcomes that prepared me for graduate research and professional growth.`
).join("\n\n");

// Full canonical profile — every required intake section filled
const fullProfile = {
  personalData: {
    firstName: "E2E", lastName: "Tester", nationality: "Indian",
    currentCountry: "India", currentCity: "Mumbai",
  },
  education: [{
    id: "edu-1", institution: "Test University", degree: "B.Tech",
    field: "Computer Science", startDate: "2020-08", endDate: "2024-05",
    percentage: "8.9",
  }],
  experience: [{
    id: "exp-1", type: "Internship", organization: "Acme",
    role: "SWE Intern", startDate: "2023-01", endDate: "2023-06",
  }],
  projects: [{ id: "p1", name: "ML Pipeline", description: "Built a pipeline", role: "Lead" }],
  skills: { programming: ["Python"], technical: ["ML"] },
  mastersMotivation: { whyNow: "Career pivot", whyField: "Love ML", academicMotivation: "Deep dive" },
  countryQuestionnaire: { countryCode: "US", answers: { q1: "Top programs", q2: "Return to India" } },
  careerGoals: {
    shortTerm: { role: "ML Engineer", industry: "Tech" },
    longTerm: { vision: "CTO", goals: "Lead AI teams", homeCountryPlans: "Return and build" },
  },
};

async function run() {
  await assertTestDatabase();
  console.log("=== Canonical E2E: New Applicant ===\n");

  // 1. Create student
  const sRes = await createStudentPOST(post("/api/application/student", {
    firstName: "E2E", lastName: "Tester", email: `e2e.${Date.now()}@test.com`, country: "India",
  }));
  assert(sRes.status === 200, `create student -> ${sRes.status}`);
  const studentId = (await sRes.json()).student.id;

  // 2. Create application — NO intake/intakeYear (reproduces customer bug path)
  const aRes = await createApplicationPOST(post("/api/application/create", {
    studentId,
    universityName: "E2E University",
    programName: "MS Computer Science",
    degree: "Master of Science",
    country: "United States",
  }));
  assert(aRes.status === 200, `create application -> ${aRes.status}`);
  const applicationId = (await aRes.json()).application.id;

  // 3. Save full profile (simulates completing all 9 intake sections)
  const pRes = await profilePUT(put("/api/application/profile", {
    studentId, profileData: fullProfile,
  }));
  assert(pRes.status === 200, `save profile -> ${pRes.status}`);

  // 4. Readiness gate must be green
  const pg = await profileGET(get(`/api/application/profile?studentId=${studentId}`));
  const profile = (await pg.json()).profile;
  const readiness = getProfileReadiness(profile, { universityName: "E2E University" });
  assert(readiness.canGenerate === true,
    `readiness.canGenerate true (${readiness.requiredComplete}/${readiness.requiredTotal})`);

  // 5. Resolve prompt — no intake/year (Bug 1 path) → DEFAULT_TEMPLATE
  const rRes = await resolvePromptPOST(post("/api/requirements/resolve-prompt", {
    university: "E2E University",
    program: "MS Computer Science",
    degree: "Master of Science",
    country: "United States",
    documentType: "STATEMENT_OF_PURPOSE",
    attemptDiscovery: false,
  }));
  assert(rRes.status === 200, `resolve-prompt no intake/year -> ${rRes.status}`);
  const resolved = (await rRes.json()).resolved;
  assert(resolved.resolutionPath === "DEFAULT_TEMPLATE", `resolution DEFAULT_TEMPLATE (${resolved.resolutionPath})`);

  // 6. Create document from resolved template (C1 path — previously 403)
  const dRes = await documentPOST(post("/api/application/document", {
    applicationId,
    documentType: "STATEMENT_OF_PURPOSE",
    promptText: resolved.promptText,
    promptSource: resolved.source,
    wordMin: resolved.wordMin,
    wordMax: resolved.wordMax,
  }));
  assert(dRes.status === 200, `create doc from resolved template -> ${dRes.status}`);
  const documentId = (await dRes.json()).document.id;

  // 7. Consultant saves a version (post-generation edit path)
  const vRes = await versionPOST(post("/api/application/version", {
    studentId, applicationId, documentId, content: sopText,
  }));
  assert(vRes.status === 200, `save consultant version -> ${vRes.status}`);
  const version = (await vRes.json()).version;
  assert(!!version?.id, "version.id present");

  // 8. Approve the version
  const apRes = await approvePOST(post("/api/application/version/approve", {
    studentId, applicationId, documentId, versionId: version.id,
  }));
  assert(apRes.status === 200, `approve version -> ${apRes.status}`);

  // 9. Final export (PDF) — must produce a real file
  const eRes = await exportPOST(post("/api/application/document/export", {
    studentId, applicationId, documentId,
    versionId: version.id, format: "PDF", mode: "FINAL",
  }));
  assert(eRes.status === 200, `final PDF export -> ${eRes.status}`);
  const buf = Buffer.from(await eRes.arrayBuffer());
  assert(buf.length > 1000 && buf.subarray(0, 5).toString() === "%PDF-", "PDF bytes valid");

  // 10. Draft DOCX export
  const eRes2 = await exportPOST(post("/api/application/document/export", {
    studentId, applicationId, documentId,
    versionId: version.id, format: "DOCX", mode: "PREVIEW",
  }));
  assert(eRes2.status === 200, `draft DOCX export -> ${eRes2.status}`);

  // ---------------------------------------------------------------
  console.log("\n=== Canonical E2E: Existing Student (2nd application) ===\n");

  // 11. Second application reusing the same student (no profile re-entry)
  const a2Res = await createApplicationPOST(post("/api/application/create", {
    studentId,
    universityName: "Second University",
    programName: "MS Data Science",
    degree: "Master of Science",
  }));
  assert(a2Res.status === 200, `second application -> ${a2Res.status}`);
  const applicationId2 = (await a2Res.json()).application.id;

  // 12. Profile still resolves readiness (reused, not re-entered)
  const pg2 = await profileGET(get(`/api/application/profile?studentId=${studentId}`));
  const profile2 = (await pg2.json()).profile;
  const readiness2 = getProfileReadiness(profile2, {});
  assert(readiness2.canGenerate === true, "profile reused — still ready");

  // 13. Resolve + create document on 2nd application
  const r2 = await resolvePromptPOST(post("/api/requirements/resolve-prompt", {
    university: "Second University", program: "MS Data Science",
    degree: "Master of Science", documentType: "STATEMENT_OF_PURPOSE",
    attemptDiscovery: false,
  }));
  assert(r2.status === 200, `resolve for app2 -> ${r2.status}`);
  const d2Res = await documentPOST(post("/api/application/document", {
    applicationId: applicationId2,
    documentType: "STATEMENT_OF_PURPOSE",
    promptText: (await r2.json()).resolved.promptText,
    promptSource: "DVIVID_DEFAULT_TEMPLATE",
  }));
  assert(d2Res.status === 200, `create doc for app2 -> ${d2Res.status}`);

  // 14. Version list round-trip on doc 1
  const vlRes = await versionGET(get(`/api/application/version?documentId=${documentId}`));
  const versions = (await vlRes.json()).versions;
  assert(Array.isArray(versions) && versions.length >= 1, `version list (${versions?.length})`);

  // 15. Application list shows both documents
  const lRes = await listGET(get(`/api/application/list?applicationId=${applicationId2}&studentId=${studentId}`));
  const lData = await lRes.json();
  assert(lData.documents?.length === 1, `app2 has 1 document (${lData.documents?.length})`);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  await cleanupTestDb();
  await closeDbPool();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (e) => {
  console.error("FATAL:", e);
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
