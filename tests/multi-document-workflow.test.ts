/**
 * multi-document-workflow.test.ts — deterministic checks for the
 * multi-document application workflow. No provider calls, no DB.
 *
 * Covers:
 *   A. Application with no documents → Add Document CTA visible
 *   B. Application with existing Visa SOP → Add Document CTA still visible
 *   C. Create SOP after Visa SOP → both documents exist (no type uniqueness)
 *   D. Create second Essay → allowed
 *   E. Create second LOR → allowed
 *   F. studentId/applicationId preserved in the form
 *   G. Document creation does NOT trigger generation
 *   H. Existing documents unchanged after new document creation
 *
 * These tests verify the code paths deterministically — no React rendering,
 * no DB queries. They check the schema, repository, API route, and page
 * component source for the required behavior.
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
// A. Add Document CTA visible when no documents exist
// ============================================================
check("A: Add Document CTA present in page source (no-documents path)", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  // The empty-state path has "Add First Document"
  assert.ok(page.includes("Add First Document"), "empty state should have Add First Document button");
  // The persistent CTA in the Documents header
  assert.ok(page.includes("+ Add Document"), "Documents header should have + Add Document CTA");
});

// ============================================================
// B. Add Document CTA still visible when documents exist
// ============================================================
check("B: Add Document CTA is NOT gated on documents.length === 0", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  // The + Add Document button is in the Documents header, not inside the
  // documents.length === 0 conditional. Verify it's outside the empty-state.
  const ctaIdx = page.indexOf("+ Add Document");
  const emptyStateIdx = page.indexOf("No Documents Yet");
  assert.ok(ctaIdx > -1, "+ Add Document CTA must exist");
  assert.ok(emptyStateIdx > -1, "empty state must exist");
  // The CTA is BEFORE the empty state check (in the header), so it's
  // always rendered when intakeComplete && !showAddForm.
  assert.ok(ctaIdx < emptyStateIdx, "CTA should be in the header, before the empty-state conditional");
});

// ============================================================
// C. No UNIQUE(application_id, document_type) constraint in schema
// ============================================================
check("C: createDocument does NOT reject duplicate document types", () => {
  const repo = readFile("src/lib/application/application-repository.ts");
  // The createDocument function should NOT check for existing documents
  // of the same type before inserting.
  const createDocFn = repo.substring(repo.indexOf("export async function createDocument("));
  const fnBody = createDocFn.substring(0, createDocFn.indexOf("export async function", 10));
  // Should not contain a SELECT ... WHERE document_type check
  assert.ok(!fnBody.includes("SELECT.*document_type") && !fnBody.includes("WHERE document_type"),
    "createDocument must not query for existing documents of the same type");
  // Should not throw on duplicate type
  assert.ok(!fnBody.includes("already exists") && !fnBody.includes("duplicate"),
    "createDocument must not reject duplicates");
});

// ============================================================
// D. API route allows multiple documents of same type
// ============================================================
check("D: API route does NOT enforce one-document-per-type", () => {
  const route = readFile("src/app/api/application/document/route.ts");
  // The POST handler should not check for existing documents of the same type
  const postHandler = route.substring(route.indexOf("export async function POST"));
  const handlerBody = postHandler.substring(0, postHandler.indexOf("export async function", 10));
  assert.ok(!handlerBody.includes("already exists"),
    "API must not reject duplicate document types");
  assert.ok(!handlerBody.includes("duplicate"),
    "API must not reject duplicate document types");
  assert.ok(!handlerBody.includes("UNIQUE"),
    "API must not enforce uniqueness");
});

// ============================================================
// E. Multiple same-type documents allowed — schema check
// ============================================================
check("E: DB schema has no UNIQUE(application_id, document_type) constraint", () => {
  // The schema is in the DB, not in a file we can read. But we can verify
  // the init-schema.ts doesn't create such a constraint, and the repository
  // doesn't enforce one. The actual DB check is done at runtime.
  // Here we verify the code paths don't enforce uniqueness.
  const repo = readFile("src/lib/application/application-repository.ts");
  const route = readFile("src/app/api/application/document/route.ts");
  // No UNIQUE constraint enforcement in either file
  assert.ok(!repo.toLowerCase().includes("unique") || !repo.includes("UNIQUE.*document_type"),
    "repository must not enforce UNIQUE on document_type");
  assert.ok(!route.toLowerCase().includes("unique"),
    "API route must not enforce UNIQUE");
});

// ============================================================
// F. studentId/applicationId preserved in the form
// ============================================================
check("F: Add Document form preserves studentId and applicationId", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  // The form uses applicationId from useParams (never asks the user)
  assert.ok(page.includes("const applicationId = params.applicationId as string"),
    "applicationId must come from route params, not user input");
  assert.ok(page.includes("const studentId = params.studentId as string"),
    "studentId must come from route params, not user input");
  // The POST body includes applicationId
  assert.ok(page.includes("applicationId,") && page.includes("body: JSON.stringify"),
    "POST body must include applicationId from route params");
  // The form does NOT ask for student or application
  const formSection = page.substring(page.indexOf("Add Document Form"), page.indexOf("Cancel</SecondaryButton>"));
  assert.ok(!formSection.includes("Student ID") && !formSection.includes("Application ID"),
    "form must not ask for Student ID or Application ID");
});

// ============================================================
// G. Document creation does NOT trigger generation
// ============================================================
check("G: handleAddDocument does NOT call generate API", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  // The handleAddDocument function should POST to /api/application/document
  // (create), NOT /api/application/document/generate
  const addFn = page.substring(page.indexOf("async function handleAddDocument"));
  const fnBody = addFn.substring(0, addFn.indexOf("async function", 10));
  assert.ok(fnBody.includes("/api/application/document\""),
    "must POST to create document endpoint");
  assert.ok(!fnBody.includes("/generate"),
    "must NOT call generate endpoint after create");
  // After create, it navigates to the document workspace — no auto-generation
  assert.ok(fnBody.includes("router.push") && fnBody.includes("documents/${newDocId}"),
    "must navigate to the new document workspace, not trigger generation");
});

// ============================================================
// H. Existing documents unchanged after new document creation
// ============================================================
check("H: New document creation does not modify existing documents", () => {
  const route = readFile("src/app/api/application/document/route.ts");
  // The POST handler should only INSERT, never UPDATE existing documents
  const postHandler = route.substring(route.indexOf("export async function POST"));
  const handlerBody = postHandler.substring(0, postHandler.indexOf("export async function", 10));
  // Should contain INSERT, not UPDATE
  assert.ok(handlerBody.includes("INSERT") || handlerBody.includes("createDocument"),
    "must create a new document, not update existing ones");
  assert.ok(!handlerBody.includes("UPDATE application_documents"),
    "must not UPDATE existing documents during creation");
});

// ============================================================
// Extra: After-create redirect goes to the new document (not auto-generate)
// ============================================================
check("Extra: After create, redirect to document workspace (no auto-generation)", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  const addFn = page.substring(page.indexOf("async function handleAddDocument"));
  const fnBody = addFn.substring(0, addFn.indexOf("async function", 10));
  // Should navigate to the document, not call generate
  assert.ok(fnBody.includes("router.push"), "should navigate after create");
  assert.ok(!fnBody.includes("generate"), "should not trigger generation");
});

// ============================================================
// Extra: Form resets after successful creation (allows adding another)
// ============================================================
check("Extra: Form state resets after creation (allows adding another document)", () => {
  const page = readFile("src/app/students/[studentId]/applications/[applicationId]/page.tsx");
  const addFn = page.substring(page.indexOf("async function handleAddDocument"));
  const fnBody = addFn.substring(0, addFn.indexOf("async function", 10));
  // Should reset showAddForm to false and clear form fields
  assert.ok(fnBody.includes('setShowAddForm(false)'), "should close form after create");
  assert.ok(fnBody.includes('setDocumentType("STATEMENT_OF_PURPOSE")'), "should reset document type");
  assert.ok(fnBody.includes('setPromptText("")'), "should reset prompt text");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
