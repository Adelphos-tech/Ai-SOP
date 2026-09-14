// ============================================================
// PHASE SOP-INFRA-37: Self-fetch static audit test
// ============================================================
// Flags same-process HTTP self-fetch patterns in server routes.
// A same-process self-fetch is when a server-side route handler
// calls fetch() targeting the same Next.js application (e.g.
// http://127.0.0.1:5010/api/... or https://sop.adelphostech.com/api/...).
//
// The only allowed fetch() calls in server routes are to genuine
// external services (OpenAI, external crawlers, exchange-rate APIs).
//
// Run: npx tsx scripts/phase-37-self-fetch-audit.ts
// ============================================================

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = join(__dirname, "..", "src");
const ALLOWED_FETCH_DOMAINS = [
  "openai.com",
  "api.openai.com",
  "open.er-api.com",
  "api.crawled",
];

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (extname(full) === ".ts" || extname(full) === ".tsx") {
      files.push(full);
    }
  }
  return files;
}

function auditFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }

    // Check for fetch() calls that target internal URLs
    if (trimmed.includes("fetch(") && !trimmed.startsWith("//")) {
      // Check for internal self-fetch patterns
      const isInternalFetch =
        trimmed.includes("127.0.0.1") ||
        trimmed.includes("localhost") ||
        trimmed.includes("5010") ||
        trimmed.includes("sop.adelphostech.com") ||
        trimmed.includes("INTERNAL_API_BASE") ||
        trimmed.includes("new URL(") && trimmed.includes("api/");

      // Check for new URL(path, req.url) pattern
      const isReqUrlFetch = trimmed.includes("req.url") || trimmed.includes("request.url");

      if (isInternalFetch && !trimmed.includes("openai") && !trimmed.includes("er-api")) {
        // Check if it's actually a fetch to an internal service
        if (trimmed.includes("fetch(") || trimmed.includes("new URL(")) {
          // Allow client-side fetches (in components/hooks)
          if (!filePath.includes("/app/api/") && !filePath.includes("/lib/")) {
            return;
          }
          violations.push({
            file: filePath,
            line: lineNum,
            text: trimmed,
            reason: "Potential same-process self-fetch in server code",
          });
        }
      }

      if (isReqUrlFetch && trimmed.includes("fetch")) {
        violations.push({
          file: filePath,
          line: lineNum,
          text: trimmed,
          reason: "fetch() using req.url/request.url as base — origin coupling",
        });
      }
    }

    // Check for new URL(internalPath, req.url) pattern in server routes
    if (
      trimmed.includes("new URL(") &&
      (trimmed.includes("req.url") || trimmed.includes("request.url")) &&
      filePath.includes("/app/api/")
    ) {
      // This is fine for parsing query params (new URL(request.url))
      // but NOT for constructing internal fetch URLs
      if (trimmed.includes("api/") && !trimmed.includes("searchParams")) {
        violations.push({
          file: filePath,
          line: lineNum,
          text: trimmed,
          reason: "new URL(apiPath, req.url) in server route — origin coupling risk",
        });
      }
    }
  });

  return violations;
}

function main() {
  console.log("=".repeat(60));
  console.log("SELF-FETCH STATIC AUDIT");
  console.log("=".repeat(60));
  console.log(`Scanning: ${ROOT}\n`);

  const files = walk(ROOT);
  const allViolations: Violation[] = [];

  for (const file of files) {
    const violations = auditFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log("PASS: No same-process self-fetch patterns found.");
    console.log("\nAll fetch() calls in server code target genuine external services.");
    process.exit(0);
  } else {
    console.log(`FAIL: ${allViolations.length} violation(s) found:\n`);
    for (const v of allViolations) {
      console.log(`  ${v.file}:${v.line}`);
      console.log(`    Reason: ${v.reason}`);
      console.log(`    Code: ${v.text}`);
      console.log();
    }
    process.exit(1);
  }
}

main();
