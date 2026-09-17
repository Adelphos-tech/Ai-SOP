/**
 * @file api-contract-tests.ts
 * @description
 * PHASE RELEASE-40: API contract tests for the canonical consultant
 * workflow endpoints.
 *
 * Exercises the real route handlers with a real (isolated) test DB.
 * No OpenAI calls are made.
 *
 * Covers:
 *   - required-field validation (400)
 *   - invalid enums / types (400)
 *   - missing resources (404)
 *   - ownership mismatch (403)
 *   - business-rule blocking (422 GENERATION_BLOCKED)
 *   - prompt-source contract (OFFICIAL_VERIFIED / DVIVID_DEFAULT_TEMPLATE)
 *   - resolve-prompt without intake/intakeYear (must NOT 400)
 *
 * Run: npx tsx tests/api-contract-tests.ts
 */

import "./test-setup";
import { NextRequest } from "next/server";
import { closeDbPool, assertTestDatabase, cleanupTestDb } from "./test-setup";
import {
  createStudent,
  createApplication,
  saveStudentProfile,
} from "../src/lib/application/application-repository";
import { getDefaultTemplate } from "../src/lib/application/default-templates";

// Route handlers under test
import { POST as createStudentPOST } from "../src/app/api/application/student/route";
import { POST as createApplicationPOST } from "../src/app/api/application/create/route";
import { PUT as profilePUT, GET as profileGET } from "../src/app/api/application/profile/route";
import { POST as documentPOST, GET as documentGET } from "../src/app/api/application/document/route";
import { POST as resolvePromptPOST } from "../src/app/api/requirements/resolve-prompt/route";
import { POST as generatePOST } from "../src/app/api/application/document/generate/route";
import { POST as versionPOST } from "../src/app/api/application/version/route";
import { POST as approvePOST } from "../src/app/api/application/version/approve/route";
import { POST as exportPOST } from "../src/app/api/application/document/export/route";
import { GET as listGET } from "../src/app/api/application/list/route";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function jsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "GET" });
}

async function run() {
  await assertTestDatabase();
  console.log("=== API Contract Tests ===\n");

  // ---------------------------------------------------------------
  // POST /api/application/student
  // ---------------------------------------------------------------
  console.log("POST /api/application/student");
  {
    const r = await createStudentPOST(jsonReq("/api/application/student", {}));
    assert(r.status === 400, `missing fields -> 400 (got ${r.status})`);

    const r2 = await createStudentPOST(jsonReq("/api/application/student", {
      firstName: "Contract", lastName: "Test", email: `contract.${Date.now()}@test.com`,
    }));
    assert(r2.status === 200, `valid student -> 200 (got ${r2.status})`);
    const d2 = await r2.json();
    assert(!!d2.student?.id, "response contains student.id");
  }

  // ---------------------------------------------------------------
  // POST /api/application/create
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/create");
  const student = await createStudent({
    firstName: "Contract", lastName: "Host", email: `contract-host.${Date.now()}@test.com`,
  });
  let applicationId = "";
  {
    const r = await createApplicationPOST(jsonReq("/api/application/create", { studentId: student.id }));
    assert(r.status === 400, `missing university/program/degree -> 400 (got ${r.status})`);

    // intake/intakeYear intentionally OMITTED — they are optional at creation
    const r2 = await createApplicationPOST(jsonReq("/api/application/create", {
      studentId: student.id,
      universityName: "Contract University",
      programName: "MS Test",
      degree: "Master of Science",
    }));
    assert(r2.status === 200, `valid create (no intake/year) -> 200 (got ${r2.status})`);
    const d2 = await r2.json();
    applicationId = d2.application?.id;
    assert(!!applicationId, "response contains application.id");
  }

  // ---------------------------------------------------------------
  // PUT /api/application/profile
  // ---------------------------------------------------------------
  console.log("\nPUT /api/application/profile");
  {
    const r = await profilePUT(jsonReq("/api/application/profile", {}, "PUT"));
    assert(r.status === 400, `missing studentId/profileData -> 400 (got ${r.status})`);

    const r2 = await profilePUT(jsonReq("/api/application/profile", {
      studentId: student.id,
      profileData: { personalData: { firstName: "Contract", lastName: "Host" } },
    }, "PUT"));
    assert(r2.status === 200, `valid profile save -> 200 (got ${r2.status})`);
  }

  // ---------------------------------------------------------------
  // POST /api/requirements/resolve-prompt  (Bug 1 regression)
  // ---------------------------------------------------------------
  console.log("\nPOST /api/requirements/resolve-prompt");
  {
    const r = await resolvePromptPOST(jsonReq("/api/requirements/resolve-prompt", {}));
    assert(r.status === 400, `empty body -> 400 (got ${r.status})`);

    const r2 = await resolvePromptPOST(jsonReq("/api/requirements/resolve-prompt", {
      university: "Nowhere University",
      program: "MS Nothing",
      degree: "Master of Science",
      documentType: "NOT_A_TYPE",
    }));
    assert(r2.status === 400, `invalid documentType -> 400 (got ${r2.status})`);

    // THE BUG 1 REGRESSION: no intake/intakeYear must NOT 400
    const r3 = await resolvePromptPOST(jsonReq("/api/requirements/resolve-prompt", {
      university: "Nowhere University",
      program: "MS Nothing",
      degree: "Master of Science",
      documentType: "STATEMENT_OF_PURPOSE",
      attemptDiscovery: false,
    }));
    assert(r3.status === 200, `no intake/intakeYear -> 200 (got ${r3.status})`);
    const d3 = await r3.json();
    assert(d3.resolved?.resolutionPath === "DEFAULT_TEMPLATE", `falls back to DEFAULT_TEMPLATE (got ${d3.resolved?.resolutionPath})`);
    assert(d3.resolved?.source === "DVIVID_DEFAULT_TEMPLATE", `source is DVIVID_DEFAULT_TEMPLATE (got ${d3.resolved?.source})`);
    assert(!!d3.resolved?.promptText, "resolved prompt text present");
  }

  // ---------------------------------------------------------------
  // POST /api/application/document  (C1 regression)
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/document");
  let documentId = "";
  {
    const r = await documentPOST(jsonReq("/api/application/document", {}));
    assert(r.status === 400, `missing fields -> 400 (got ${r.status})`);

    const r2 = await documentPOST(jsonReq("/api/application/document", {
      applicationId, documentType: "BOGUS", promptText: "x",
    }));
    assert(r2.status === 400, `invalid documentType -> 400 (got ${r2.status})`);

    // CONSULTANT_PROVIDED — must succeed
    const r3 = await documentPOST(jsonReq("/api/application/document", {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      promptText: "Write an SOP about your background.",
      promptSource: "CONSULTANT_PROVIDED",
    }));
    assert(r3.status === 200, `CONSULTANT_PROVIDED -> 200 (got ${r3.status})`);
    const d3 = await r3.json();
    documentId = d3.document?.id;
    assert(!!documentId, "response contains document.id");

    // DVIVID_DEFAULT_TEMPLATE + actual template text — must succeed (C1 fix)
    const template = getDefaultTemplate("STATEMENT_OF_PURPOSE");
    const r4 = await documentPOST(jsonReq("/api/application/document", {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      promptText: template.promptText,
      promptSource: "DVIVID_DEFAULT_TEMPLATE",
    }));
    assert(r4.status === 200, `DVIVID_DEFAULT_TEMPLATE + template text -> 200 (got ${r4.status})`);
    const d4 = await r4.json();
    assert(d4.document?.promptSource === "DVIVID_DEFAULT_TEMPLATE",
      `template doc keeps DVIVID_DEFAULT_TEMPLATE source (got ${d4.document?.promptSource})`);

    // DVIVID_DEFAULT_TEMPLATE + EDITED text — stored as CONSULTANT_PROVIDED
    const r5 = await documentPOST(jsonReq("/api/application/document", {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      promptText: "Customized prompt text the consultant wrote.",
      promptSource: "DVIVID_DEFAULT_TEMPLATE",
    }));
    assert(r5.status === 200, `edited template text -> 200 (got ${r5.status})`);
    const d5 = await r5.json();
    assert(d5.document?.promptSource === "CONSULTANT_PROVIDED",
      `edited template stored as CONSULTANT_PROVIDED (got ${d5.document?.promptSource})`);

    // OFFICIAL_VERIFIED without writingRequirementId -> 400
    const r6 = await documentPOST(jsonReq("/api/application/document", {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      promptText: "Some prompt",
      promptSource: "OFFICIAL_VERIFIED",
    }));
    assert(r6.status === 400, `OFFICIAL_VERIFIED without WR id -> 400 (got ${r6.status})`);

    // OFFICIAL_VERIFIED with bogus writingRequirementId -> 400
    const r7 = await documentPOST(jsonReq("/api/application/document", {
      applicationId,
      documentType: "STATEMENT_OF_PURPOSE",
      promptText: "Some prompt",
      promptSource: "OFFICIAL_VERIFIED",
      writingRequirementId: "00000000-0000-0000-0000-000000000000",
    }));
    assert(r7.status === 400, `OFFICIAL_VERIFIED bogus WR id -> 400 (got ${r7.status})`);
    const d7 = await r7.json();
    assert(d7.code === "WRITING_REQUIREMENT_NOT_FOUND", `code WRITING_REQUIREMENT_NOT_FOUND (got ${d7.code})`);
  }

  // ---------------------------------------------------------------
  // GET /api/application/document
  // ---------------------------------------------------------------
  console.log("\nGET /api/application/document");
  {
    const r = await documentGET(getReq("/api/application/document"));
    assert(r.status === 400, `no params -> 400 (got ${r.status})`);

    const r2 = await documentGET(getReq("/api/application/document?id=00000000-0000-0000-0000-000000000000"));
    assert(r2.status === 404, `unknown document -> 404 (got ${r2.status})`);

    const r3 = await documentGET(getReq(`/api/application/document?id=${documentId}&studentId=${student.id}`));
    assert(r3.status === 200, `valid document fetch -> 200 (got ${r3.status})`);
  }

  // ---------------------------------------------------------------
  // POST /api/application/document/generate  (Bug 2 regression)
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/document/generate");
  {
    const r = await generatePOST(jsonReq("/api/application/document/generate", {}));
    assert(r.status === 400, `missing ids -> 400 (got ${r.status})`);

    // Ownership mismatch: wrong studentId -> 403 (real authz)
    const r2 = await generatePOST(jsonReq("/api/application/document/generate", {
      studentId: "00000000-0000-0000-0000-000000000000",
      applicationId,
      documentId,
    }));
    assert(r2.status === 403 || r2.status === 404, `ownership mismatch -> 403/404 (got ${r2.status})`);

    // Incomplete profile -> 422 GENERATION_BLOCKED (NOT 403) with reasons
    const r3 = await generatePOST(jsonReq("/api/application/document/generate", {
      studentId: student.id,
      applicationId,
      documentId,
    }));
    assert(r3.status === 422, `incomplete profile -> 422 not 403 (got ${r3.status})`);
    const d3 = await r3.json();
    assert(d3.error === "GENERATION_BLOCKED", `error code GENERATION_BLOCKED (got ${d3.error})`);
    assert(Array.isArray(d3.blockReasons) && d3.blockReasons.length > 0, "blockReasons present");
  }

  // ---------------------------------------------------------------
  // POST /api/application/version
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/version");
  {
    const r = await versionPOST(jsonReq("/api/application/version", {}));
    assert(r.status === 400, `missing fields -> 400 (got ${r.status})`);

    const r2 = await versionPOST(jsonReq("/api/application/version", {
      studentId: student.id, applicationId, documentId,
      content: "Consultant-written version content.",
    }));
    assert(r2.status === 200 || r2.status === 201, `consultant version save -> 200 (got ${r2.status})`);
  }

  // ---------------------------------------------------------------
  // POST /api/application/version/approve
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/version/approve");
  {
    const r = await approvePOST(jsonReq("/api/application/version/approve", {}));
    assert(r.status === 400, `missing fields -> 400 (got ${r.status})`);
  }

  // ---------------------------------------------------------------
  // POST /api/application/document/export
  // ---------------------------------------------------------------
  console.log("\nPOST /api/application/document/export");
  {
    const r = await exportPOST(jsonReq("/api/application/document/export", {}));
    assert(r.status === 400, `missing fields -> 400 (got ${r.status})`);
  }

  // ---------------------------------------------------------------
  // GET /api/application/list
  // ---------------------------------------------------------------
  console.log("\nGET /api/application/list");
  {
    const r = await listGET(getReq(`/api/application/list?applicationId=${applicationId}&studentId=${student.id}`));
    assert(r.status === 200, `application+student list -> 200 (got ${r.status})`);
    const d = await r.json();
    assert(!!d.application && Array.isArray(d.documents), "returns {application, documents}");

    const r2 = await listGET(getReq(`/api/application/list?applicationId=${applicationId}&studentId=00000000-0000-0000-0000-000000000000`));
    assert(r2.status === 403 || r2.status === 404, `ownership mismatch -> 403/404 (got ${r2.status})`);
  }

  // ---------------------------------------------------------------
  // GET /api/application/profile
  // ---------------------------------------------------------------
  console.log("\nGET /api/application/profile");
  {
    const r = await profileGET(getReq(`/api/application/profile?studentId=${student.id}`));
    assert(r.status === 200, `profile fetch -> 200 (got ${r.status})`);
    const d = await r.json();
    assert(!!d.profile?.personalData?.firstName, "profile.personalData present");
  }

  // ---------------------------------------------------------------
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
