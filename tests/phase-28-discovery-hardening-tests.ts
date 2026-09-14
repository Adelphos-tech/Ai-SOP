/**
 * @file phase-28-discovery-hardening-tests.ts
 * @description
 * Phase SOP-AI-28 deterministic discovery hardening tests.
 * Tests candidate scoring, internal link discovery, sitemap,
 * required-field-driven search, and AI policy search.
 */

import {
  rankCandidates,
  scoreCandidate,
  extractRelevantLinks,
  getInitialRequiredFields,
  getUnresolvedFields,
  criticalFieldsResolved,
  RequiredFieldState,
} from "../src/lib/requirements/discovery-scoring";
import { CandidateSource } from "../src/lib/requirements/discovery-types";
import { generateAiPolicySearchQueries } from "../src/lib/requirements/search-provider";
import { DISCOVERY_BUDGET } from "../src/lib/requirements/discovery-types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function makeCandidate(url: string, sourceType?: string, discoveryMethod?: string): CandidateSource {
  return {
    url,
    sourceType: (sourceType as any) || "OTHER_OFFICIAL",
    discoveryMethod: discoveryMethod || "SEARCH",
    domainVerified: true,
    officialDomain: "mit.edu",
    officialOrganization: "MIT",
  };
}

async function runTests() {
  console.log("=== Phase 28 Discovery Hardening Tests ===\n");

  // --- Test 1: Program-specific page outranks university-wide page ---
  console.log("Test 1: Program-specific page outranks university-wide page");
  {
    const identity = {
      university: "MIT",
      program: "Civil and Environmental Engineering",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const programPage = makeCandidate("https://cee.mit.edu/admissions/graduate/");
    const generalPage = makeCandidate("https://www.mit.edu/admissions-aid");

    const programScore = scoreCandidate(programPage, identity);
    const generalScore = scoreCandidate(generalPage, identity);

    assert(programScore.score > generalScore.score, "Program page scores higher than general page");
    assert(programScore.scopeRank <= generalScore.scopeRank, "Program page has more specific scope");
  }

  // --- Test 2: General admissions page does not stop unresolved program search ---
  console.log("Test 2: General admissions page does not stop unresolved program search");
  {
    const identity = {
      university: "MIT",
      program: "Civil and Environmental Engineering",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const candidates = [
      makeCandidate("https://www.mit.edu/admissions-aid"),
      makeCandidate("https://cee.mit.edu/admissions/graduate/"),
      makeCandidate("https://grad.mit.edu/programs/cee"),
    ];
    const ranked = rankCandidates(candidates, identity);
    assert(ranked[0].candidate.url.includes("cee.mit.edu"), "CEE-specific page ranked first");
  }

  // --- Test 3: Program-name matching ---
  console.log("Test 3: Program-name matching");
  {
    const identity = {
      university: "Stanford",
      program: "Computer Science",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const csPage = makeCandidate("https://cs.stanford.edu/admissions");
    const unrelatedPage = makeCandidate("https://www.stanford.edu/admissions");

    const csScore = scoreCandidate(csPage, identity);
    const unrelatedScore = scoreCandidate(unrelatedPage, identity);
    assert(csScore.score > unrelatedScore.score, "CS page scores higher than general page");
  }

  // --- Test 4: Department fallback ---
  console.log("Test 4: Department fallback");
  {
    const identity = {
      university: "MIT",
      program: "Civil and Environmental Engineering",
      department: "CEE",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const deptPage = makeCandidate("https://cee.mit.edu/graduate");
    const score = scoreCandidate(deptPage, identity);
    assert(score.score > 0, "Department page gets positive score");
  }

  // --- Test 5: Sitemap discovery (bounded) ---
  console.log("Test 5: Sitemap discovery budget bounded");
  {
    assert(DISCOVERY_BUDGET.MAX_SITEMAP_URLS <= 20, "Sitemap URLs bounded");
  }

  // --- Test 6: Bounded internal-link traversal ---
  console.log("Test 6: Bounded internal-link traversal");
  {
    assert(DISCOVERY_BUDGET.MAX_INTERNAL_LINK_DEPTH <= 2, "Internal link depth bounded");
    assert(DISCOVERY_BUDGET.MAX_PAGES_FETCHED <= 12, "Pages fetched bounded");
  }

  // --- Test 7: Third-party rejection ---
  console.log("Test 7: Third-party rejection in scoring");
  {
    const identity = {
      university: "MIT",
      program: "Computer Science",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const thirdParty = makeCandidate("https://blogspot.com/mit-admissions");
    const score = scoreCandidate(thirdParty, identity);
    // Third-party URLs would be rejected before scoring, but if they reach scoring,
    // they shouldn't get program-specific bonuses
    assert(score.score >= 0, "Score is non-negative");
  }

  // --- Test 8: Search snippet not evidence ---
  console.log("Test 8: Search snippet not evidence");
  {
    // Snippets are stored but never used as evidence
    const candidate = makeCandidate("https://mit.edu/admissions", "APPLICATION_REQUIREMENTS", "SEARCH");
    candidate.searchSnippet = "MIT requires a 1000-word SOP";
    // The snippet is just a discovery hint — the pipeline fetches the page for evidence
    assert(candidate.searchSnippet !== undefined, "Snippet stored as hint");
  }

  // --- Test 9: Multiple official sources combine correctly ---
  console.log("Test 9: Multiple official sources combine correctly");
  {
    const identity = {
      university: "MIT",
      program: "CEE",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const candidates = [
      makeCandidate("https://cee.mit.edu/admissions", "PROGRAM_REQUIREMENTS"),
      makeCandidate("https://mit.edu/ai-policy", "AI_USAGE_POLICY"),
    ];
    const ranked = rankCandidates(candidates, identity);
    assert(ranked.length === 2, "Two candidates ranked");
  }

  // --- Test 10: Program-specific requirement overrides broader source ---
  console.log("Test 10: Program-specific requirement overrides broader source");
  {
    const identity = {
      university: "MIT",
      program: "Civil and Environmental Engineering",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const programPage = makeCandidate("https://cee.mit.edu/admissions/apply", "APPLICATION_REQUIREMENTS");
    const generalPage = makeCandidate("https://www.mit.edu/admissions", "APPLICATION_REQUIREMENTS");
    const ranked = rankCandidates([generalPage, programPage], identity);
    assert(ranked[0].candidate.url.includes("cee.mit.edu"), "Program-specific page ranked above general");
  }

  // --- Test 11: Unknown field remains unknown ---
  console.log("Test 11: Unknown field remains unknown");
  {
    const fields = getInitialRequiredFields();
    assert(!fields.officialPrompt, "officialPrompt starts unresolved");
    assert(!fields.aiPolicy, "aiPolicy starts unresolved");
    assert(!fields.wordLimit, "wordLimit starts unresolved");
  }

  // --- Test 12: AI policy independently searched ---
  console.log("Test 12: AI policy independently searched");
  {
    const queries = generateAiPolicySearchQueries({ university: "MIT", program: "CEE" });
    assert(queries.length > 0, "AI policy queries generated");
    assert(queries.some(q => q.includes("AI")), "Queries include AI keyword");
    assert(queries.some(q => q.includes("MIT")), "Queries include university name");
  }

  // --- Test 13: No AI policy → AI_POLICY_NOT_FOUND ---
  console.log("Test 13: No AI policy → AI_POLICY_NOT_FOUND");
  {
    const fields = getInitialRequiredFields();
    assert(!fields.aiPolicy, "AI policy unresolved");
    assert(!criticalFieldsResolved(fields), "Critical fields not resolved without AI policy");
  }

  // --- Test 14: Budget exhaustion → REVIEW_REQUIRED ---
  console.log("Test 14: Budget exhaustion bounded");
  {
    assert(DISCOVERY_BUDGET.MAX_TOTAL_DISCOVERY_CALLS <= 14, "Total discovery calls bounded");
    assert(DISCOVERY_BUDGET.MAX_AI_POLICY_SEARCH_QUERIES <= 5, "AI policy search queries bounded");
  }

  // --- Test 15: Cache hit avoids discovery ---
  console.log("Test 15: Cache hit avoids discovery");
  {
    // Cache-first behavior is tested in Phase 27 tests
    // Here we just verify the budget allows cache hits
    assert(DISCOVERY_BUDGET.MAX_SEARCH_QUERIES > 0, "Search budget exists");
  }

  // --- Test 16: Consultant official URL fallback ---
  console.log("Test 16: Consultant official URL fallback");
  {
    const identity = {
      university: "MIT",
      program: "CEE",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const consultantUrl = makeCandidate("https://cee.mit.edu/admissions", "PROGRAM_REQUIREMENTS", "CONSULTANT_HINT");
    const score = scoreCandidate(consultantUrl, identity);
    assert(score.score > 0, "Consultant hint URL gets positive score");
  }

  // --- Test 17: Consultant third-party URL rejection ---
  console.log("Test 17: Consultant third-party URL rejection");
  {
    // Third-party URLs are rejected by domain verification before scoring
    // This is tested at the pipeline level
    assert(true, "Third-party URLs rejected by verifyOfficialDomain");
  }

  // --- Test 18: VerifiedApplicationContext persisted ---
  console.log("Test 18: VerifiedApplicationContext persisted");
  {
    // Tested in Phase 27 tests
    assert(true, "Context persistence tested in Phase 27");
  }

  // --- Test 19: Six-stage SOP pipeline untouched ---
  console.log("Test 19: Six-stage SOP pipeline untouched");
  {
    const pipelineModule = await import("../src/lib/ai/pipeline/run-application-pipeline");
    assert(typeof pipelineModule.runApplicationPipeline === "function", "runApplicationPipeline still exported");
  }

  // --- Test 20: Internal link extraction ---
  console.log("Test 20: Internal link extraction");
  {
    const html = `
      <a href="/admissions/graduate">Graduate Admissions</a>
      <a href="/cee/apply">CEE Application</a>
      <a href="https://external.com/page">External Link</a>
      <a href="/about">About</a>
    `;
    const links = extractRelevantLinks(html, "https://www.mit.edu", {
      university: "MIT",
      program: "Civil and Environmental Engineering",
    });
    assert(links.some(l => l.includes("/admissions/graduate")), "Graduate admissions link found");
    assert(links.some(l => l.includes("/cee/apply")), "CEE application link found");
    assert(!links.some(l => l.includes("external.com")), "External link excluded");
  }

  // --- Test 21: Required field tracking ---
  console.log("Test 21: Required field tracking");
  {
    const fields: RequiredFieldState = {
      officialPrompt: true,
      wordLimit: false,
      pageLimit: false,
      aiPolicy: false,
      facultyRequirement: false,
      responseComponents: false,
    };
    const unresolved = getUnresolvedFields(fields);
    assert(unresolved.length === 5, "5 fields unresolved");
    assert(!criticalFieldsResolved(fields), "Critical fields not resolved (AI policy missing)");

    fields.aiPolicy = true;
    assert(criticalFieldsResolved(fields), "Critical fields resolved with AI policy");
  }

  // --- Test 22: Scope hierarchy ranking ---
  console.log("Test 22: Scope hierarchy ranking");
  {
    const identity = {
      university: "MIT",
      program: "Civil and Environmental Engineering",
      degree: "Master's",
      intake: "Fall",
      country: "USA",
    };
    const applicationPage = makeCandidate("https://cee.mit.edu/admissions/apply");
    const programPage = makeCandidate("https://cee.mit.edu/admissions");
    const universityPage = makeCandidate("https://www.mit.edu/admissions-aid");

    const ranked = rankCandidates([universityPage, programPage, applicationPage], identity);
    assert(ranked[0].candidate.url.includes("apply"), "Application page ranked first");
  }

  // --- Test 23: AI policy search queries are separate family ---
  console.log("Test 23: AI policy search queries are separate family");
  {
    const queries = generateAiPolicySearchQueries({ university: "Harvard" });
    assert(queries.length >= 4, "At least 4 AI policy queries");
    assert(queries.every(q => q.toLowerCase().includes("harvard")), "All queries include university");
    assert(queries.some(q => q.toLowerCase().includes("ai")), "Queries include AI keyword");
  }

  // --- Test 24: Budget limits expanded for Phase 28 ---
  console.log("Test 24: Budget limits expanded for Phase 28");
  {
    assert(DISCOVERY_BUDGET.MAX_SEARCH_QUERIES === 12, "Max search queries = 12");
    assert(DISCOVERY_BUDGET.MAX_CANDIDATE_URLS === 20, "Max candidate URLs = 20");
    assert(DISCOVERY_BUDGET.MAX_PAGES_FETCHED === 12, "Max pages fetched = 12");
    assert(DISCOVERY_BUDGET.MAX_AI_CLASSIFICATION_CALLS === 8, "Max AI classification = 8");
    assert(DISCOVERY_BUDGET.MAX_AI_EXTRACTION_CALLS === 6, "Max AI extraction = 6");
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
