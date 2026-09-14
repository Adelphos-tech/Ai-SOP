/**
 * @file phase-27-live-discovery-mit.ts
 * @description
 * Live discovery test for MIT CEE MEng Fall 2027.
 *
 * This performs LIVE discovery (search, fetch, AI extraction).
 * It does NOT generate an SOP.
 *
 * Compares discovery output against existing verified MIT fixture.
 */

import { discoverRequirements } from "../src/lib/requirements/discovery-pipeline";
import { ApplicationDiscoveryInput } from "../src/lib/requirements/discovery-types";
import { promises as fs } from "fs";
import path from "path";

async function main() {
  console.log("=== Phase 27 Live Discovery Test: MIT CEE MEng Fall 2027 ===\n");
  console.log("NOTE: This performs LIVE discovery. NO SOP generation.\n");

  const input: ApplicationDiscoveryInput = {
    university: "Massachusetts Institute of Technology",
    program: "Civil and Environmental Engineering",
    degree: "Master of Engineering",
    intake: "Fall",
    intakeYear: "2027",
    country: "USA",
  };

  console.log("Input:", JSON.stringify(input, null, 2));
  console.log("\nStarting discovery...\n");

  const result = await discoverRequirements(input);

  console.log("=== DISCOVERY RESULT ===\n");
  console.log("Status:", result.status);
  console.log("");
  console.log("Diagnostics:");
  console.log("  Cache status:", result.diagnostics.cacheStatus);
  console.log("  Search queries used:", result.diagnostics.searchQueriesUsed.length);
  console.log("  Candidate sources found:", result.diagnostics.candidateSourcesFound);
  console.log("  Pages fetched:", result.diagnostics.pagesFetched);
  console.log("  Pages classified:", result.diagnostics.pagesClassified);
  console.log("  Pages extracted:", result.diagnostics.pagesExtracted);
  console.log("  AI classification calls:", result.diagnostics.aiClassificationCalls);
  console.log("  AI extraction calls:", result.diagnostics.aiExtractionCalls);
  console.log("  Third-party rejections:", result.diagnostics.thirdPartyRejections);
  console.log("  JS-only pages:", result.diagnostics.jsOnlyPages);
  console.log("  PDF pages:", result.diagnostics.pdfPages);
  console.log("");
  console.log("Cost:");
  console.log("  Search operations:", result.cost.searchOperations);
  console.log("  Fetches:", result.cost.fetches);
  console.log("  AI classification calls:", result.cost.aiClassificationCalls);
  console.log("  AI extraction calls:", result.cost.aiExtractionCalls);
  console.log("  Duration (ms):", result.cost.duration);
  console.log("");

  if (result.candidateSources.length > 0) {
    console.log("Candidate sources:");
    for (const src of result.candidateSources) {
      console.log(`  [${src.discoveryMethod}] ${src.url}`);
      console.log(`    Type: ${src.sourceType}, Domain verified: ${src.domainVerified}`);
    }
    console.log("");
  }

  if (result.verifiedSources.length > 0) {
    console.log("Verified sources:");
    for (const src of result.verifiedSources) {
      console.log(`  ${src.title} — ${src.url}`);
      console.log(`    Domain: ${src.officialDomain}, Status: ${src.status}`);
    }
    console.log("");
  }

  if (result.context) {
    console.log("=== VERIFIED APPLICATION CONTEXT ===\n");
    console.log("Application ID:", result.context.applicationId);
    console.log("Verification status:", result.context.verificationStatus);
    console.log("");

    if (result.context.brief) {
      console.log("Brief:");
      console.log("  Verification:", result.context.brief.verification.status);
      console.log("  Documents:", result.context.brief.documents.length);
      for (const doc of result.context.brief.documents) {
        console.log(`    ${doc.documentTypeLabel}:`);
        console.log(`      Required: ${doc.required}`);
        console.log(`      Prompt: ${doc.officialPrompt.rawText?.substring(0, 100) || "null"} [${doc.officialPrompt.status}]`);
        console.log(`      Word limit: ${doc.wordLimit.min || "null"}-${doc.wordLimit.max || "null"} [${doc.wordLimit.status}]`);
      }
      console.log("");
    }

    console.log("AI Policy:");
    console.log("  Status:", result.context.aiPolicy.status);
    console.log("  Generation allowed:", result.context.aiPolicy.generationAllowed);
    console.log("  Sources:", result.context.aiPolicy.sources?.length || 0);
    console.log("");

    console.log("Response components:", result.context.responseComponents.length);
    for (const rc of result.context.responseComponents) {
      console.log(`  ${rc.componentId}: ${rc.label}`);
      console.log(`    Prompt: ${rc.exactPrompt?.substring(0, 100) || "null"}`);
      console.log(`    Word limit: ${rc.wordLimit.min || "null"}-${rc.wordLimit.max || "null"} [${rc.wordLimit.status}]`);
      console.log(`    Page limit: ${rc.pageLimit.maxPages || "null"} [${rc.pageLimit.status}]`);
      console.log(`    Topics: ${rc.requiredTopics.length}`);
    }
    console.log("");
  } else {
    console.log("No verified context produced.\n");
  }

  if (result.unresolvedFields.length > 0) {
    console.log("Unresolved fields:");
    for (const f of result.unresolvedFields) {
      console.log(`  ${f.fieldName}: ${f.reason} [${f.status}]`);
    }
    console.log("");
  }

  if (result.conflicts.length > 0) {
    console.log("Conflicts:");
    for (const c of result.conflicts) {
      console.log(`  ${c.field}: ${c.description}`);
    }
    console.log("");
  }

  // Compare with existing MIT fixture
  const fixturePath = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test", "verified-application-brief.json");
  try {
    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf-8"));
    console.log("=== COMPARISON WITH EXISTING MIT FIXTURE ===\n");
    console.log("Fixture verification:", fixture.verification?.status);
    console.log("Fixture documents:", fixture.documents?.length);
    if (fixture.documents?.[0]) {
      console.log("Fixture prompt:", fixture.documents[0].officialPrompt?.rawText?.substring(0, 100) || "null");
      console.log("Fixture word limit:", fixture.documents[0].wordLimit?.min, "-", fixture.documents[0].wordLimit?.max);
    }
    console.log("");
  } catch {
    console.log("(No existing MIT fixture found for comparison)\n");
  }

  console.log("=== WRITING CALLS: 0 ===");
  console.log("=== DISCOVERY AI CALLS:", result.diagnostics.aiClassificationCalls + result.diagnostics.aiExtractionCalls, "===");
  console.log("\nLive discovery test complete.");
}

main().catch(err => {
  console.error("Live discovery test error:", err);
  process.exit(1);
});
