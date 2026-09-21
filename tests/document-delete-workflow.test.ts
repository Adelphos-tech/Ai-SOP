/**
 * document-delete-workflow.test.ts — deterministic checks for individual
 * document deletion. No provider calls, no DB.
 *
 * Covers:
 *   A. deleteDocumentCascade function exists with correct signature
 *   B. API route exists with auth + ownership checks
 *   C. Delete by documentId (not documentType)
 *   D. Active generation safety (GENERATING rejected)
 *   E. Transactional delete (cleanup order: stage_responses → runs → versions → doc)
 *   F. Other documents preserved (no cross-document deletion)
 *   G. Application/student/profile not touched
 *   H. Confirmation UI present in application page
 *   I. Confirmation UI present in document review page
 *   J. Wrong applicationId/documentId rejected
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const repoRoot = resolve(import.meta.dirname, "..");
const readFile = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf-8");

// ============================================================
// A. deleteDocumentCascade function exists with correct signature
// ============================================================
check("A: deleteDocumentCascade exists in repository", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  assert.ok(repo.includes("export async function deleteDocumentCascade"),
    "deleteDocumentCascade must be exported");
  assert.ok(repo.includes("documentId: string"),
    "must take documentId parameter");
  assert.ok(repo.includes("applicationId: string"),
    "must take applicationId parameter");
  // Returns a result code
  assert.ok(repo.includes('"DELETED" | "NOT_FOUND" | "MISMATCH" | "GENERATING"'),
    "must return DELETED/NOT_FOUND/MISMATCH/GENERATING");
});

// ============================================================
// B. API route exists with auth + ownership checks
// ============================================================
check("B: API route has auth + ownership checks", () => {
  const route = readFile("src/app/api/application/document/delete/route.ts");
  assert.ok(route.includes("requireConsultantSession"),
    "must require consultant session");
  assert.ok(route.includes("authorizeStudentAccess"),
    "must authorize student access");
  assert.ok(route.includes("getDocument"),
    "must verify document exists");
  assert.ok(route.includes("getApplication"),
    "must verify application exists");
  assert.ok(route.includes("DOCUMENT_APPLICATION_MISMATCH"),
    "must check document belongs to application");
  assert.ok(route.includes("APPLICATION_STUDENT_MISMATCH"),
    "must check application belongs to student");
});

// ============================================================
// C. Delete by documentId (not documentType)
// ============================================================
check("C: deletion uses documentId, never documentType", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  const fn = repo.substring(repo.indexOf("export async function deleteDocumentCascade"));
  const body = fn.substring(0, fn.indexOf("}", fn.indexOf("}") + 1) + 1);
  // Must use documentId in WHERE clauses
  assert.ok(body.includes("WHERE id = ?") && body.includes("[documentId]"),
    "must delete by documentId");
  // Must NOT use document_type in any DELETE
  assert.ok(!body.includes("document_type"),
    "must NOT delete by document_type");
});

// ============================================================
// D. Active generation safety
// ============================================================
check("D: active generation rejected (GENERATING)", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  const fn = repo.substring(repo.indexOf("export async function deleteDocumentCascade"));
  const body = fn.substring(0, 5000);
  assert.ok(body.includes("GENERATING"),
    "must check generation_status === GENERATING");
  assert.ok(body.includes("QUEUED") && body.includes("RUNNING") && body.includes("CANCEL_REQUESTED"),
    "must check generation_runs for active status");
  assert.ok(body.includes('return "GENERATING"'),
    "must return GENERATING when active");
  // API route must return 409 for GENERATING
  const route = readFile("src/app/api/application/document/delete/route.ts");
  assert.ok(route.includes("DOCUMENT_GENERATION_IN_PROGRESS"),
    "API must return DOCUMENT_GENERATION_IN_PROGRESS code");
  assert.ok(route.includes("409"),
    "API must return 409 status for active generation");
});

// ============================================================
// E. Transactional delete with correct cleanup order
// ============================================================
check("E: transactional delete with correct cleanup order", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  const fn = repo.substring(repo.indexOf("export async function deleteDocumentCascade"));
  const body = fn.substring(0, 5000);
  // Must use transaction
  assert.ok(body.includes("beginTransaction"),
    "must begin transaction");
  assert.ok(body.includes("commit"),
    "must commit on success");
  assert.ok(body.includes("rollback"),
    "must rollback on failure");
  // Cleanup order: stage_responses → runs → versions → document
  const gsrIdx = body.indexOf("generation_stage_responses");
  const runsIdx = body.indexOf("DELETE FROM generation_runs");
  const versionsIdx = body.indexOf("DELETE FROM document_versions");
  const docIdx = body.indexOf("DELETE FROM application_documents WHERE id = ?");
  assert.ok(gsrIdx > -1 && runsIdx > -1 && versionsIdx > -1 && docIdx > -1,
    "all cleanup steps must exist");
  assert.ok(gsrIdx < runsIdx, "stage_responses before runs");
  assert.ok(runsIdx < versionsIdx, "runs before versions");
  assert.ok(versionsIdx < docIdx, "versions before document");
});

// ============================================================
// F. Other documents preserved
// ============================================================
check("F: only the specified document is deleted", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  const fn = repo.substring(repo.indexOf("export async function deleteDocumentCascade"));
  const body = fn.substring(0, 5000);
  // DELETE FROM application_documents must use WHERE id = ? (documentId)
  assert.ok(body.includes("DELETE FROM application_documents WHERE id = ?"),
    "must delete only the specific document by id");
  // Must NOT delete all documents for an application
  assert.ok(!body.includes("DELETE FROM application_documents WHERE application_id"),
    "must NOT delete all documents by application_id");
});

// ============================================================
// G. Application/student/profile not touched
// ============================================================
check("G: application/student/profile not deleted", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  // Extract only the deleteDocumentCascade function body
  const fnStart = repo.indexOf("export async function deleteDocumentCascade");
  const fnEnd = repo.indexOf("/**", fnStart + 10); // next comment block = next function
  const body = repo.substring(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 5000);
  assert.ok(!body.includes("DELETE FROM applications"),
    "must NOT delete application");
  assert.ok(!body.includes("DELETE FROM students"),
    "must NOT delete student");
  assert.ok(!body.includes("DELETE FROM profile_data"),
    "must NOT delete profile_data");
});

// ============================================================
// H. Confirmation UI in application page
// ============================================================
check("H: application page has delete confirmation UI", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  assert.ok(page.includes("docToDelete"),
    "must have docToDelete state");
  assert.ok(page.includes("handleDeleteDocument"),
    "must have handleDeleteDocument function");
  assert.ok(page.includes("/api/application/document/delete"),
    "must call the delete API");
  assert.ok(page.includes("Delete Document"),
    "must have Delete Document button");
  assert.ok(page.includes("permanently delete"),
    "must show confirmation warning");
  assert.ok(page.includes("Cancel"),
    "must have Cancel button");
  // Delete button is secondary/destructive (not PrimaryButton)
  assert.ok(page.includes("text-dvivid-error"),
    "delete button must be visually destructive");
});

// ============================================================
// I. Confirmation UI in document review page
// ============================================================
check("I: document review page has delete confirmation UI", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/documents/[documentId]/page.tsx");
  assert.ok(page.includes("confirmDocDelete"),
    "must have confirmDocDelete state");
  assert.ok(page.includes("handleDeleteDocument"),
    "must have handleDeleteDocument function");
  assert.ok(page.includes("/api/application/document/delete"),
    "must call the delete API");
  assert.ok(page.includes("Delete document"),
    "must have Delete document button");
  assert.ok(page.includes("permanently delete"),
    "must show confirmation warning");
  // After delete, navigates back to application page
  assert.ok(page.includes("router.push") && page.includes("applications/${applicationId}"),
    "must navigate back to application page after delete");
});

// ============================================================
// J. Wrong applicationId/documentId rejected
// ============================================================
check("J: wrong applicationId/documentId rejected with controlled errors", () => {
  const route = readFile("src/app/api/application/document/delete/route.ts");
  assert.ok(route.includes("DOCUMENT_NOT_FOUND"),
    "must return DOCUMENT_NOT_FOUND for missing document");
  assert.ok(route.includes("DOCUMENT_APPLICATION_MISMATCH"),
    "must return DOCUMENT_APPLICATION_MISMATCH for wrong application");
  assert.ok(route.includes("404"),
    "must return 404 for not found");
  assert.ok(route.includes("403"),
    "must return 403 for mismatch");
  assert.ok(route.includes("DELETE_FAILED"),
    "must return DELETE_FAILED for errors");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
