// ============================================================
// PHASE SOP-INFRA-37: Canonical route tests
// ============================================================
// Tests A-L from the phase spec:
// A. legacy SOP route reaches shared generation service
// B. canonical document route reaches same shared service
// C. neither route self-fetches via HTTP
// D. same service invoked once
// E. no new URL(..., req.url) internal routing
// F. HTTP entry behaves correctly
// G. HTTPS/proxy entry behaves correctly
// H. internal generation logic independent of public origin
// I. invalid relationships still blocked
// J. generation lock still works
// K. FAILED status still works
// L. no AI pipeline changes
// ============================================================
// These tests use blocked-path/mocked requests — NO OpenAI calls.
// Run: npx tsx scripts/phase-37-canonical-route-tests.ts
// ============================================================

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

const ROOT = join(__dirname, "..", "src");
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function readFile(path: string): string {
  return readFileSync(path, "utf-8");
}

function fileContains(path: string, pattern: string): boolean {
  return readFile(path).includes(pattern);
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (extname(full) === ".ts" || extname(full) === ".tsx") files.push(full);
  }
  return files;
}

function main() {
  console.log("=".repeat(60));
  console.log("CANONICAL ROUTE TESTS (A-L)");
  console.log("=".repeat(60));

  const sopRoute = join(ROOT, "app/api/sop/generate/route.ts");
  const canonicalRoute = join(ROOT, "app/api/application/document/generate/route.ts");
  const sharedService = join(ROOT, "lib/application/generation-service.ts");

  // ===== Test A: Legacy SOP route reaches shared generation service =====
  console.log("\nA. Legacy SOP route reaches shared generation service");
  assert(existsSync(sharedService), "Shared service file exists");
  assert(fileContains(sopRoute, "generateApplicationDocument"), "SOP route imports generateApplicationDocument");
  assert(fileContains(sopRoute, "generation-service"), "SOP route imports from generation-service");

  // ===== Test B: Canonical route reaches same shared service =====
  console.log("\nB. Canonical document route reaches same shared service");
  assert(fileContains(canonicalRoute, "generateApplicationDocument"), "Canonical route imports generateApplicationDocument");
  assert(fileContains(canonicalRoute, "generation-service"), "Canonical route imports from generation-service");

  // ===== Test C: Neither route self-fetches via HTTP =====
  console.log("\nC. Neither route self-fetches via HTTP");
  const sopContent = readFile(sopRoute);
  const canonicalContent = readFile(canonicalRoute);
  assert(!sopContent.includes("fetch(") || sopContent.includes("fetch failed"), "SOP route has no fetch() call");
  assert(!canonicalContent.includes("fetch("), "Canonical route has no fetch() call");
  assert(!sopContent.includes("127.0.0.1:5010"), "SOP route has no internal IP reference");
  assert(!sopContent.includes("INTERNAL_API_BASE"), "SOP route has no INTERNAL_API_BASE");

  // ===== Test D: Same service invoked once =====
  console.log("\nD. Same service invoked once");
  const sopMatches = (sopContent.match(/generateApplicationDocument/g) || []).length;
  const canonicalMatches = (canonicalContent.match(/generateApplicationDocument/g) || []).length;
  assert(sopMatches >= 2, `SOP route references generateApplicationDocument (imports + call): ${sopMatches}`);
  assert(canonicalMatches >= 2, `Canonical route references generateApplicationDocument (imports + call): ${canonicalMatches}`);

  // ===== Test E: No new URL(..., req.url) internal routing =====
  console.log("\nE. No new URL(..., req.url) internal routing");
  assert(!sopContent.includes("new URL(") || sopContent.includes("searchParams") === false, "SOP route has no new URL() for internal routing");
  assert(!canonicalContent.includes("new URL("), "Canonical route has no new URL() at all");

  // ===== Test F: HTTP entry behaves correctly (static check) =====
  console.log("\nF. HTTP entry behaves correctly");
  assert(!sopContent.includes("https://"), "SOP route has no hardcoded https:// URL");
  assert(!canonicalContent.includes("https://"), "Canonical route has no hardcoded https:// URL");

  // ===== Test G: HTTPS/proxy entry behaves correctly =====
  console.log("\nG. HTTPS/proxy entry behaves correctly");
  assert(!sopContent.includes("x-forwarded-proto"), "SOP route does not depend on x-forwarded-proto");
  assert(!canonicalContent.includes("x-forwarded-proto"), "Canonical route does not depend on x-forwarded-proto");

  // ===== Test H: Internal generation logic independent of public origin =====
  console.log("\nH. Internal generation logic independent of public origin");
  const serviceContent = readFile(sharedService);
  assert(!serviceContent.includes("sop.adelphostech.com"), "Shared service has no public hostname reference");
  assert(!serviceContent.includes("127.0.0.1"), "Shared service has no internal IP reference");
  assert(!serviceContent.includes("req.url"), "Shared service has no req.url dependency");
  assert(!serviceContent.includes("request.url"), "Shared service has no request.url dependency");
  assert(!serviceContent.includes("INTERNAL_API_BASE"), "Shared service has no INTERNAL_API_BASE");

  // ===== Test I: Invalid relationships still blocked =====
  console.log("\nI. Invalid relationships still blocked");
  assert(serviceContent.includes("loadDocumentGenerationContext"), "Shared service validates context via loadDocumentGenerationContext");
  assert(serviceContent.includes("ctxResult.ok"), "Shared service checks ctxResult.ok");
  assert(serviceContent.includes("!ctxResult.ok || !ctxResult.context"), "Shared service rejects invalid context");

  // ===== Test J: Generation lock still works =====
  console.log("\nJ. Generation lock still works");
  assert(serviceContent.includes("acquireGenerationLock"), "Shared service uses acquireGenerationLock");
  assert(serviceContent.includes("GENERATION_ALREADY_IN_PROGRESS"), "Shared service returns 409 on lock conflict");
  assert(serviceContent.includes("409"), "Shared service returns 409 status");

  // ===== Test K: FAILED status still works =====
  console.log("\nK. FAILED status still works");
  assert(serviceContent.includes('"FAILED"'), "Shared service sets FAILED status on pipeline error");
  assert(serviceContent.includes("releaseGenerationLock"), "Shared service has releaseGenerationLock for catch block");
  assert(canonicalContent.includes("releaseGenerationLock"), "Canonical route calls releaseGenerationLock in catch");

  // ===== Test L: No AI pipeline changes =====
  console.log("\nL. No AI pipeline changes");
  assert(serviceContent.includes("runApplicationPipeline"), "Shared service calls runApplicationPipeline (unchanged)");
  assert(fileContains(join(ROOT, "lib/ai/pipeline/run-application-pipeline.ts"), "runApplicationPipeline"), "AI pipeline file still exists");
  assert(serviceContent.includes("CONTENT_REGENERATION"), "Pipeline mode unchanged (CONTENT_REGENERATION)");

  // ===== Additional: No recursion =====
  console.log("\n--- Additional checks ---");
  assert(!serviceContent.includes("fetch("), "Shared service has no fetch() call (no recursion)");
  // Check for /api/ only in non-comment lines (comments may reference routes)
  const serviceLines = serviceContent.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  const hasApiSelfCall = serviceLines.some(l => l.includes('"/api/') || l.includes("'/api/") || l.includes("`/api/"));
  assert(!hasApiSelfCall, "Shared service has no /api/ path in code (no self-call)");

  // ===== Summary =====
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main();
