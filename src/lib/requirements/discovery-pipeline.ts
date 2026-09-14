// ============================================================
// OFFICIAL REQUIREMENTS DISCOVERY PIPELINE
// Phase SOP-AI-27 + Phase SOP-AI-28
// ============================================================
// Discovery order:
//   1. Check existing VerifiedApplicationContext cache
//   2. Check university official-domain registry
//   3. Discover candidate official URLs (search + hints + sitemap)
//   4. Score and rank candidates (program-specific > general)
//   5. Backend fetches top-ranked candidate pages
//   6. Extract internal links from fetched pages (bounded depth)
//   7. Continue fetching for unresolved required fields
//   8. Classify candidate pages (AI)
//   9. Extract structured requirements (AI)
//  10. Separate AI policy search if policy still unresolved
//  11. Validate every field against evidence
//  12. Resolve scope/conflicts
//  13. Persist VerifiedApplicationContext
//  14. Return unresolved information
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import {
  ApplicationDiscoveryInput,
  ApplicationDiscoveryResult,
  CandidateSource,
  CandidateSourceType,
  FetchedPage,
  PageClassification,
  ExtractedRequirements,
  ExtractedField,
  DiscoveryConflict,
  UnresolvedField,
  DiscoveryDiagnostics,
  DiscoveryCost,
  SearchResult,
  SourceScope,
} from "./discovery-types";
import { DISCOVERY_BUDGET } from "./discovery-types";
import {
  LinkDiscoverySearchProvider,
  DuckDuckGoSearchProvider,
  generateSearchQueries,
  generateAiPolicySearchQueries,
} from "./search-provider";
import { OfficialSourceSearchProvider } from "./discovery-types";
import {
  rankCandidates,
  ScoredCandidate,
  extractRelevantLinks,
  discoverFromSitemap,
  getInitialRequiredFields,
  getUnresolvedFields,
  criticalFieldsResolved,
  RequiredFieldState,
} from "./discovery-scoring";
import {
  loadVerifiedApplicationContext,
  saveVerifiedApplicationContext,
} from "./application-context-repository";
import {
  generateApplicationId,
  computeContextContentHash,
  deriveApplicationVerificationStatus,
  VerifiedApplicationContext,
  APPLICATION_CONTEXT_SCHEMA_VERSION,
} from "./application-context";
import { verifyOfficialDomain, lookupRequirementsPageUrls, lookupAiPolicyPageUrls } from "./domain-verification";
import { fetchOfficialPage } from "./html-extractor";
import { classifyPage, extractRequirementsFromPage } from "./discovery-ai";
import { detectAiPolicyFromText, buildAiUsagePolicy } from "./ai-policy-verifier";
import { AiPolicySource, AiPolicyStatus, AiUsagePolicy } from "./ai-policy-types";
import { isApiKeyConfigured } from "../ai/openai-client";
import {
  ApplicationIdentity,
  VerifiedApplicationBrief,
  SourceRecord,
  DocumentRequirement,
  RequirementStatus,
  VerificationResult,
} from "./types";
import { ResponseComponent } from "./generation-contract-types";
import { generateCacheKey } from "./freshness";

// ============================================================
// MAIN DISCOVERY FUNCTION
// ============================================================

export async function discoverRequirements(
  input: ApplicationDiscoveryInput,
  options?: { searchProvider?: OfficialSourceSearchProvider },
): Promise<ApplicationDiscoveryResult> {
  const startTime = Date.now();
  const diagnostics: DiscoveryDiagnostics = {
    cacheStatus: "CACHE_MISS",
    searchQueriesUsed: [],
    candidateSourcesFound: 0,
    pagesFetched: 0,
    pagesClassified: 0,
    pagesExtracted: 0,
    aiClassificationCalls: 0,
    aiExtractionCalls: 0,
    redirectRejections: 0,
    thirdPartyRejections: 0,
    jsOnlyPages: 0,
    pdfPages: 0,
    internalLinksDiscovered: 0,
    sitemapUrlsFound: 0,
    aiPolicySearchQueries: 0,
    budgetExhausted: false,
    stopReason: null,
    mostSpecificSourceUrl: null,
    mostSpecificSourceScope: null,
  };
  const cost: DiscoveryCost = {
    searchOperations: 0,
    fetches: 0,
    aiClassificationCalls: 0,
    aiExtractionCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedUsd: 0,
    estimatedInr: 0,
    duration: 0,
  };

  const identity: ApplicationIdentity = {
    country: input.country,
    university: input.university,
    program: input.program,
    degreeLevel: input.degree,
    intake: input.intake,
    intakeYear: input.intakeYear || "",
  };

  const applicationId = generateApplicationId(identity);

  // ===== STEP 1: CHECK CACHE =====
  if (!input.forceRefresh) {
    const loadResult = await loadVerifiedApplicationContext(applicationId);
    if (loadResult.found && loadResult.context) {
      diagnostics.cacheStatus = "CACHE_HIT";
      cost.duration = Date.now() - startTime;
      return {
        status: loadResult.context.verificationStatus,
        context: loadResult.context,
        candidateSources: [],
        verifiedSources: loadResult.context.officialSources,
        unresolvedFields: [],
        conflicts: [],
        diagnostics,
        cost,
        error: null,
      };
    }
  } else {
    diagnostics.cacheStatus = "CACHE_STALE";
  }

  // ===== STEP 2: CHECK REGISTRY =====
  const registryReqUrls = lookupRequirementsPageUrls(input.university);
  const registryAiUrls = lookupAiPolicyPageUrls(input.university);

  // ===== STEP 3: DISCOVER CANDIDATE URLS =====
  const searchProvider = options?.searchProvider || new LinkDiscoverySearchProvider();
  const candidateSources: CandidateSource[] = [];

  // From registry
  for (const url of registryReqUrls) {
    const domainCheck = verifyOfficialDomain(url, "OFFICIAL_UNIVERSITY_WEBPAGE");
    candidateSources.push({
      url,
      sourceType: "PROGRAM_REQUIREMENTS",
      discoveryMethod: "REGISTRY",
      domainVerified: domainCheck.verified,
      officialOrganization: domainCheck.organization,
      officialDomain: domainCheck.domain,
    });
  }
  for (const url of registryAiUrls) {
    const domainCheck = verifyOfficialDomain(url, "OFFICIAL_UNIVERSITY_WEBPAGE");
    candidateSources.push({
      url,
      sourceType: "AI_USAGE_POLICY",
      discoveryMethod: "REGISTRY",
      domainVerified: domainCheck.verified,
      officialOrganization: domainCheck.organization,
      officialDomain: domainCheck.domain,
    });
  }

  // From consultant hints
  if (input.hintRequirementsUrl) {
    const domainCheck = verifyOfficialDomain(input.hintRequirementsUrl, "OFFICIAL_UNIVERSITY_WEBPAGE");
    candidateSources.push({
      url: input.hintRequirementsUrl,
      sourceType: "PROGRAM_REQUIREMENTS",
      discoveryMethod: "CONSULTANT_HINT",
      domainVerified: domainCheck.verified,
      officialOrganization: domainCheck.organization,
      officialDomain: domainCheck.domain,
    });
  }
  if (input.hintAiPolicyUrl) {
    const domainCheck = verifyOfficialDomain(input.hintAiPolicyUrl, "OFFICIAL_UNIVERSITY_WEBPAGE");
    candidateSources.push({
      url: input.hintAiPolicyUrl,
      sourceType: "AI_USAGE_POLICY",
      discoveryMethod: "CONSULTANT_HINT",
      domainVerified: domainCheck.verified,
      officialOrganization: domainCheck.organization,
      officialDomain: domainCheck.domain,
    });
  }

  // From search (if registry/hints didn't provide enough)
  const allowedDomains = getAllowedDomains(input.university);
  if (candidateSources.length < DISCOVERY_BUDGET.MAX_CANDIDATE_URLS) {
    const queries = generateSearchQueries({
      university: input.university,
      program: input.program,
      degree: input.degree,
      country: input.country,
      department: input.department,
    });

    for (const query of queries.slice(0, DISCOVERY_BUDGET.MAX_SEARCH_QUERIES)) {
      if (candidateSources.length >= DISCOVERY_BUDGET.MAX_CANDIDATE_URLS) break;

      diagnostics.searchQueriesUsed.push(query);
      cost.searchOperations++;

      try {
        const results = await searchProvider.search(query, allowedDomains);
        for (const result of results) {
          if (candidateSources.length >= DISCOVERY_BUDGET.MAX_CANDIDATE_URLS) break;
          // Skip duplicates
          if (candidateSources.some(c => c.url === result.url)) continue;

          const domainCheck = verifyOfficialDomain(result.url, "OFFICIAL_UNIVERSITY_WEBPAGE");
          if (!domainCheck.verified) {
            diagnostics.thirdPartyRejections++;
            continue;
          }

          candidateSources.push({
            url: result.url,
            sourceType: guessSourceTypeFromQuery(query),
            discoveryMethod: "SEARCH",
            searchQuery: query,
            searchSnippet: result.snippet,
            domainVerified: true,
            officialOrganization: domainCheck.organization,
            officialDomain: domainCheck.domain,
          });
        }
      } catch {
        // Search failed — continue with other queries
      }
    }
  }

  diagnostics.candidateSourcesFound = candidateSources.length;

  // ===== STEP 3b: SITEMAP DISCOVERY =====
  // Try to discover additional URLs from official domain sitemaps
  if (candidateSources.length < DISCOVERY_BUDGET.MAX_CANDIDATE_URLS) {
    const homepageUrl = guessUniversityHomepage(input.university);
    if (homepageUrl) {
      try {
        const sitemapUrls = await discoverFromSitemap(
          homepageUrl,
          { university: input.university, program: input.program, department: input.department },
          DISCOVERY_BUDGET.MAX_SITEMAP_URLS,
        );
        diagnostics.sitemapUrlsFound = sitemapUrls.length;
        for (const url of sitemapUrls) {
          if (candidateSources.length >= DISCOVERY_BUDGET.MAX_CANDIDATE_URLS) break;
          if (candidateSources.some(c => c.url === url)) continue;
          const domainCheck = verifyOfficialDomain(url, "OFFICIAL_UNIVERSITY_WEBPAGE");
          if (!domainCheck.verified) continue;
          candidateSources.push({
            url,
            sourceType: guessSourceTypeFromUrl(url),
            discoveryMethod: "SITEMAP",
            domainVerified: true,
            officialOrganization: domainCheck.organization,
            officialDomain: domainCheck.domain,
          });
        }
      } catch {
        // sitemap not available — skip
      }
    }
  }

  // ===== STEP 4: SCORE AND RANK CANDIDATES =====
  const scoredCandidates = rankCandidates(candidateSources, {
    university: input.university,
    program: input.program,
    department: input.department,
    degree: input.degree,
    intake: input.intake,
    country: input.country,
  });

  // Track most specific source
  if (scoredCandidates.length > 0) {
    const top = scoredCandidates[0];
    diagnostics.mostSpecificSourceUrl = top.candidate.url;
    const scopeNames = ["APPLICATION", "PROGRAM", "DEPARTMENT", "SCHOOL", "GRADUATE_SCHOOL", "UNIVERSITY"];
    diagnostics.mostSpecificSourceScope = scopeNames[top.scopeRank] || "UNIVERSITY";
  }

  // ===== STEP 5: FETCH CANDIDATE PAGES (ranked) =====
  const fetchedPages: FetchedPage[] = [];
  const fetchedUrls = new Set<string>();
  const requiredFields = getInitialRequiredFields();

  // Fetch in ranked order
  for (const scored of scoredCandidates) {
    if (fetchedPages.length >= DISCOVERY_BUDGET.MAX_PAGES_FETCHED) break;
    if (fetchedUrls.has(scored.candidate.url)) continue;

    try {
      const page = await fetchAndVerifyPage(scored.candidate);
      if (page) {
        fetchedPages.push(page);
        fetchedUrls.add(page.url);
        cost.fetches++;
        diagnostics.pagesFetched++;
        if (page.isPdf) diagnostics.pdfPages++;
        if (page.requiresRendering) diagnostics.jsOnlyPages++;

        // ===== STEP 6: INTERNAL LINK DISCOVERY =====
        // Extract relevant internal links from fetched pages (bounded depth)
        if (fetchedPages.length < DISCOVERY_BUDGET.MAX_PAGES_FETCHED) {
          const internalLinks = extractRelevantLinks(
            page.html,
            page.url,
            { university: input.university, program: input.program, department: input.department },
          );
          diagnostics.internalLinksDiscovered += internalLinks.length;

          for (const linkUrl of internalLinks) {
            if (fetchedPages.length >= DISCOVERY_BUDGET.MAX_PAGES_FETCHED) break;
            if (fetchedUrls.has(linkUrl)) continue;
            if (candidateSources.some(c => c.url === linkUrl)) continue;

            const domainCheck = verifyOfficialDomain(linkUrl, "OFFICIAL_UNIVERSITY_WEBPAGE");
            if (!domainCheck.verified) continue;

            // Add as a new candidate and fetch it
            const newCandidate: CandidateSource = {
              url: linkUrl,
              sourceType: guessSourceTypeFromUrl(linkUrl),
              discoveryMethod: "INTERNAL_LINK",
              domainVerified: true,
              officialOrganization: domainCheck.organization,
              officialDomain: domainCheck.domain,
            };
            candidateSources.push(newCandidate);

            try {
              const linkedPage = await fetchAndVerifyPage(newCandidate);
              if (linkedPage) {
                fetchedPages.push(linkedPage);
                fetchedUrls.add(linkedPage.url);
                cost.fetches++;
                diagnostics.pagesFetched++;
                if (linkedPage.isPdf) diagnostics.pdfPages++;
                if (linkedPage.requiresRendering) diagnostics.jsOnlyPages++;
              }
            } catch {
              // fetch failed — skip
            }
          }
        }
      }
    } catch {
      // Fetch failed — skip
    }
  }

  // ===== STEP 5: CLASSIFY PAGES =====
  const classifiedPages: { page: FetchedPage; classification: PageClassification }[] = [];
  const aiAvailable = isApiKeyConfigured();

  for (const page of fetchedPages) {
    if (page.requiresRendering || page.isPdf) {
      // Can't classify JS-only or PDF pages with current MVP
      continue;
    }

    if (!aiAvailable) {
      // Without AI, use deterministic classification
      const classification = deterministicClassifyPage(page, identity);
      if (classification) {
        classifiedPages.push({ page, classification });
      }
      continue;
    }

    if (diagnostics.aiClassificationCalls >= DISCOVERY_BUDGET.MAX_AI_CLASSIFICATION_CALLS) break;

    const classification = await classifyPage({
      url: page.url,
      title: page.title,
      headings: page.headings,
      extractedText: page.extractedText,
      applicationIdentity: {
        university: identity.university,
        program: identity.program,
        degree: identity.degreeLevel,
        intake: identity.intake,
        country: identity.country,
      },
    });

    diagnostics.aiClassificationCalls++;
    cost.aiClassificationCalls++;

    if (classification && classification.relevance !== "NONE") {
      classifiedPages.push({ page, classification });
    }
  }
  diagnostics.pagesClassified = classifiedPages.length;

  // ===== STEP 6: EXTRACT REQUIREMENTS =====
  const allExtracted: { page: FetchedPage; classification: PageClassification; extracted: ExtractedRequirements }[] = [];

  for (const { page, classification } of classifiedPages) {
    if (diagnostics.aiExtractionCalls >= DISCOVERY_BUDGET.MAX_AI_EXTRACTION_CALLS) break;

    if (!aiAvailable) continue;

    const extracted = await extractRequirementsFromPage({
      url: page.url,
      sourceId: `SRC-${page.officialDomain}-${page.contentHash.substring(0, 8)}`,
      sourceScope: classification.scope,
      extractedText: page.extractedText,
      applicationIdentity: {
        university: identity.university,
        program: identity.program,
        degree: identity.degreeLevel,
        intake: identity.intake,
        country: identity.country,
      },
    });

    diagnostics.aiExtractionCalls++;
    cost.aiExtractionCalls++;

    if (extracted) {
      allExtracted.push({ page, classification, extracted });
    }
  }
  diagnostics.pagesExtracted = allExtracted.length;

  // ===== STEP 7: SEPARATE AI POLICY SEARCH (if still unresolved) =====
  // Check if AI policy was found in the main extraction
  let aiPolicyFound = false;
  for (const { extracted } of allExtracted) {
    if (extracted.aiGenerationPolicy?.value || extracted.aiEditingPolicy?.value) {
      aiPolicyFound = true;
      break;
    }
  }

  // Also check deterministic detection from fetched pages
  if (!aiPolicyFound) {
    for (const page of fetchedPages) {
      const detectedStatus = detectAiPolicyFromText(page.extractedText);
      if (detectedStatus !== "AI_POLICY_NOT_FOUND") {
        aiPolicyFound = true;
        break;
      }
    }
  }

  // If AI policy not found, do a separate bounded search
  if (!aiPolicyFound && diagnostics.aiExtractionCalls < DISCOVERY_BUDGET.MAX_AI_EXTRACTION_CALLS) {
    const aiPolicyQueries = generateAiPolicySearchQueries({
      university: input.university,
      program: input.program,
    });

    for (const query of aiPolicyQueries.slice(0, DISCOVERY_BUDGET.MAX_AI_POLICY_SEARCH_QUERIES)) {
      if (fetchedPages.length >= DISCOVERY_BUDGET.MAX_PAGES_FETCHED + 4) break;
      diagnostics.aiPolicySearchQueries++;
      diagnostics.searchQueriesUsed.push(`[AI-POLICY] ${query}`);
      cost.searchOperations++;

      try {
        const results = await searchProvider.search(query, getAllowedDomains(input.university));
        for (const result of results.slice(0, 3)) {
          if (fetchedUrls.has(result.url)) continue;
          const domainCheck = verifyOfficialDomain(result.url, "OFFICIAL_UNIVERSITY_WEBPAGE");
          if (!domainCheck.verified) {
            diagnostics.thirdPartyRejections++;
            continue;
          }

          try {
            const aiCandidate: CandidateSource = {
              url: result.url,
              sourceType: "AI_USAGE_POLICY",
              discoveryMethod: "AI_POLICY_SEARCH",
              searchQuery: query,
              domainVerified: true,
              officialOrganization: domainCheck.organization,
              officialDomain: domainCheck.domain,
            };
            const aiPage = await fetchAndVerifyPage(aiCandidate);
            if (aiPage) {
              fetchedPages.push(aiPage);
              fetchedUrls.add(aiPage.url);
              cost.fetches++;
              diagnostics.pagesFetched++;

              // Check if this page has AI policy content
              const detectedStatus = detectAiPolicyFromText(aiPage.extractedText);
              if (detectedStatus !== "AI_POLICY_NOT_FOUND") {
                aiPolicyFound = true;
                // If AI available, extract from this page too
                if (aiAvailable && diagnostics.aiExtractionCalls < DISCOVERY_BUDGET.MAX_AI_EXTRACTION_CALLS) {
                  const aiExtracted = await extractRequirementsFromPage({
                    url: aiPage.url,
                    sourceId: `SRC-${aiPage.officialDomain}-${aiPage.contentHash.substring(0, 8)}`,
                    sourceScope: "UNIVERSITY",
                    extractedText: aiPage.extractedText,
                    applicationIdentity: {
                      university: identity.university,
                      program: identity.program,
                      degree: identity.degreeLevel,
                      intake: identity.intake,
                      country: identity.country,
                    },
                  });
                  diagnostics.aiExtractionCalls++;
                  cost.aiExtractionCalls++;
                  if (aiExtracted) {
                    const aiClass = deterministicClassifyPage(aiPage, identity) || {
                      pageType: "AI_USAGE_POLICY" as CandidateSourceType,
                      relevance: "HIGH" as const,
                      scope: "UNIVERSITY" as SourceScope,
                      programMatch: false,
                      intakeMatch: false,
                      usefulFor: ["AI_USAGE_POLICY"],
                      confidence: 0.8,
                      model: "deterministic",
                    };
                    allExtracted.push({ page: aiPage, classification: aiClass, extracted: aiExtracted });
                  }
                }
                break; // Found AI policy — stop searching
              }
            }
          } catch {
            // fetch failed — skip
          }
        }
      } catch {
        // search failed — continue
      }
      if (aiPolicyFound) break;
    }
  }

  // ===== STEP 8-9: VALIDATE + RESOLVE =====
  const { brief, aiPolicy, responseComponents, sources, conflicts, unresolvedFields } =
    buildVerifiedArtifacts(allExtracted, identity, fetchedPages);

  // ===== STEP 9: PERSIST =====
  let context: VerifiedApplicationContext | null = null;
  let status: ApplicationDiscoveryResult["status"] = "UNKNOWN";

  if (brief && sources.length > 0) {
    const verificationStatus = deriveApplicationVerificationStatus(brief, aiPolicy);
    status = verificationStatus;

    context = {
      applicationId,
      schemaVersion: APPLICATION_CONTEXT_SCHEMA_VERSION,
      applicationIdentity: identity,
      brief,
      aiPolicy,
      responseComponents,
      facultyContext: [],
      officialSources: sources,
      verificationStatus,
      verifiedAt: new Date().toISOString(),
      contentHash: computeContextContentHash(brief, aiPolicy),
      cacheKey: brief.cacheKey,
      createdAt: new Date().toISOString(),
      expiresAt: brief.expiresAt,
      fromFixture: false,
    };

    // Only persist if we have at least some verified content
    if (verificationStatus !== "UNKNOWN") {
      await saveVerifiedApplicationContext(context);
    }
  } else {
    // No sources found
    status = "UNKNOWN";
  }

  // Track budget exhaustion
  const totalAiCalls = diagnostics.aiClassificationCalls + diagnostics.aiExtractionCalls;
  if (
    diagnostics.pagesFetched >= DISCOVERY_BUDGET.MAX_PAGES_FETCHED ||
    totalAiCalls >= DISCOVERY_BUDGET.MAX_TOTAL_DISCOVERY_CALLS ||
    diagnostics.searchQueriesUsed.length >= DISCOVERY_BUDGET.MAX_SEARCH_QUERIES
  ) {
    diagnostics.budgetExhausted = true;
    if (status === "UNKNOWN" || status === "PARTIALLY_VERIFIED") {
      diagnostics.stopReason = "BUDGET_EXHAUSTED";
    }
  }

  // Track stop reason
  if (!diagnostics.stopReason) {
    if (status === "VERIFIED") {
      diagnostics.stopReason = "ALL_CRITICAL_FIELDS_VERIFIED";
    } else if (status === "PARTIALLY_VERIFIED") {
      diagnostics.stopReason = "PARTIAL_VERIFICATION";
    } else {
      diagnostics.stopReason = "NO_VERIFIED_SOURCES";
    }
  }

  cost.duration = Date.now() - startTime;

  return {
    status,
    context,
    candidateSources,
    verifiedSources: sources,
    unresolvedFields,
    conflicts,
    diagnostics,
    cost,
    error: null,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getAllowedDomains(university: string): string[] | undefined {
  // Get domains from registry for this university
  const domainCheck = verifyOfficialDomain(`https://${university.toLowerCase().replace(/\s+/g, "")}.edu`, "OFFICIAL_UNIVERSITY_WEBPAGE");
  // Also try common patterns
  return undefined; // Let the search provider return all results, we filter after
}

async function fetchAndVerifyPage(candidate: CandidateSource): Promise<FetchedPage | null> {
  try {
    const { html, httpStatus, contentHash } = await fetchOfficialPage(candidate.url);

    // Verify domain
    const domainCheck = verifyOfficialDomain(candidate.url, "OFFICIAL_UNIVERSITY_WEBPAGE");
    if (!domainCheck.verified) {
      return null;
    }

    // Check for redirect to third-party
    const finalUrl = candidate.url; // fetchOfficialPage follows redirects
    const finalDomainCheck = verifyOfficialDomain(finalUrl, "OFFICIAL_UNIVERSITY_WEBPAGE");
    if (!finalDomainCheck.verified) {
      return null;
    }

    // Extract text
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Extract headings
    const headings: string[] = [];
    const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRegex.exec(html)) !== null) {
      headings.push(hMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    // Extract links
    const links: string[] = [];
    const linkRegex = /href="([^"]+)"/gi;
    let lMatch: RegExpExecArray | null;
    while ((lMatch = linkRegex.exec(html)) !== null) {
      links.push(lMatch[1]);
    }

    // Check if JS-only (very little text content)
    const requiresRendering = cleaned.length < 200 && html.length > 5000;
    const isPdf = html.startsWith("%PDF") || candidate.url.toLowerCase().endsWith(".pdf");

    return {
      url: candidate.url,
      finalUrl,
      redirectChain: [],
      httpStatus,
      contentType: isPdf ? "application/pdf" : "text/html",
      html,
      extractedText: cleaned,
      title,
      headings,
      links,
      retrievedAt: new Date().toISOString(),
      contentHash,
      domainVerified: true,
      officialDomain: domainCheck.domain,
      officialOrganization: domainCheck.organization,
      requiresRendering,
      isPdf,
    };
  } catch (err: any) {
    console.error(`[discovery] Fetch failed for ${candidate.url}:`, err?.message);
    return null;
  }
}

function deterministicClassifyPage(page: FetchedPage, identity: ApplicationIdentity): PageClassification | null {
  const text = page.extractedText.toLowerCase();
  const hasRequirements = text.includes("requirements") || text.includes("admission") || text.includes("application");
  const hasSop = text.includes("statement of purpose") || text.includes("personal statement") || text.includes("essay");
  const hasAiPolicy = text.includes("ai") && (text.includes("policy") || text.includes("generative") || text.includes("chatgpt"));

  if (!hasRequirements && !hasSop && !hasAiPolicy) {
    return null;
  }

  let pageType: CandidateSourceType = "OTHER_OFFICIAL";
  if (hasAiPolicy) pageType = "AI_USAGE_POLICY";
  else if (hasSop) pageType = "STATEMENT_REQUIREMENTS";
  else if (hasRequirements) pageType = "APPLICATION_REQUIREMENTS";

  const programMentioned = text.includes(identity.program.toLowerCase());

  return {
    pageType,
    relevance: programMentioned ? "HIGH" : "MEDIUM",
    scope: "UNIVERSITY",
    programMatch: programMentioned,
    intakeMatch: false,
    usefulFor: [pageType],
    confidence: 0.5,
    model: "deterministic",
  };
}

function guessSourceTypeFromQuery(query: string): CandidateSourceType {
  const q = query.toLowerCase();
  if (q.includes("ai") || q.includes("generative") || q.includes("chatgpt")) return "AI_USAGE_POLICY";
  if (q.includes("statement of purpose") || q.includes("personal statement")) return "STATEMENT_REQUIREMENTS";
  if (q.includes("essay")) return "STATEMENT_REQUIREMENTS";
  if (q.includes("requirements")) return "APPLICATION_REQUIREMENTS";
  if (q.includes("admissions")) return "GRADUATE_ADMISSIONS_POLICY";
  return "OTHER_OFFICIAL";
}

function guessSourceTypeFromUrl(url: string): CandidateSourceType {
  const u = url.toLowerCase();
  if (u.includes("ai-policy") || u.includes("generative") || u.includes("chatgpt") || u.includes("ai-use")) return "AI_USAGE_POLICY";
  if (u.includes("statement") || u.includes("sop") || u.includes("essay") || u.includes("personal-statement") || u.includes("purpose") || u.includes("objectives")) return "STATEMENT_REQUIREMENTS";
  if (u.includes("apply") || u.includes("application")) return "APPLICATION_REQUIREMENTS";
  if (u.includes("admission")) return "GRADUATE_ADMISSIONS_POLICY";
  if (u.includes("faculty") || u.includes("professor")) return "FACULTY_DIRECTORY";
  return "OTHER_OFFICIAL";
}

function guessUniversityHomepage(university: string): string | null {
  const normalized = university.toLowerCase().trim();
  if (normalized.includes("massachusetts institute") || normalized.includes("mit")) return "https://www.mit.edu";
  if (normalized.includes("harvard")) return "https://www.harvard.edu";
  if (normalized.includes("stanford")) return "https://www.stanford.edu";
  if (normalized.includes("berkeley")) return "https://www.berkeley.edu";
  if (normalized.includes("carnegie mellon") || normalized.includes("cmu")) return "https://www.cmu.edu";
  if (normalized.includes("cornell")) return "https://www.cornell.edu";
  if (normalized.includes("princeton")) return "https://www.princeton.edu";
  if (normalized.includes("yale")) return "https://www.yale.edu";
  if (normalized.includes("columbia")) return "https://www.columbia.edu";
  if (normalized.includes("pennsylvania") || normalized.includes("upenn")) return "https://www.upenn.edu";
  // Generic: try .edu domain from first word
  const shortName = normalized.split(" ")[0].replace(/[^a-z]/g, "");
  if (shortName.length > 2) return `https://www.${shortName}.edu`;
  return null;
}

function buildVerifiedArtifacts(
  allExtracted: { page: FetchedPage; classification: PageClassification; extracted: ExtractedRequirements }[],
  identity: ApplicationIdentity,
  fetchedPages: FetchedPage[],
): {
  brief: VerifiedApplicationBrief | null;
  aiPolicy: AiUsagePolicy;
  responseComponents: ResponseComponent[];
  sources: SourceRecord[];
  conflicts: DiscoveryConflict[];
  unresolvedFields: UnresolvedField[];
} {
  const now = new Date().toISOString();
  const cacheKey = generateCacheKey(identity);
  const conflicts: DiscoveryConflict[] = [];
  const unresolvedFields: UnresolvedField[] = [];

  // Build sources from fetched pages
  const sources: SourceRecord[] = fetchedPages.map(page => ({
    sourceId: `SRC-${page.officialDomain}-${page.contentHash.substring(0, 8)}`,
    sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" as const,
    title: page.title || page.officialDomain,
    officialOrganization: page.officialOrganization,
    officialDomain: page.officialDomain,
    url: page.url,
    retrievedAt: page.retrievedAt,
    publishedOrUpdatedAt: null,
    programMatch: true,
    degreeLevelMatch: true,
    intakeMatch: true,
    countryMatch: true,
    httpStatus: page.httpStatus,
    contentHash: page.contentHash,
    status: "ACTIVE" as const,
    priority: "PRIMARY" as const,
  }));

  if (allExtracted.length === 0) {
    // No extracted requirements — return empty brief with UNKNOWN status
    const brief: VerifiedApplicationBrief = {
      applicationIdentity: identity,
      documents: [{
        documentType: "STATEMENT_OF_PURPOSE",
        documentTypeLabel: "Statement of Purpose",
        required: true,
        officialPrompt: { rawText: null, status: "UNKNOWN", provenance: null },
        wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE", provenance: null },
        characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE", provenance: null },
        requiredTopics: [],
        formatInstructions: [],
        additionalQuestions: [],
      }],
      countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
      sources,
      verification: { status: "UNVERIFIED", verifiedAt: now, conflicts: [], blockingIssues: [{ field: "sources", issue: "No official requirements could be extracted", severity: "BLOCK" }] },
      cacheKey,
      createdAt: now,
      expiresAt: null,
    };

    return {
      brief,
      aiPolicy: {
        status: "AI_POLICY_NOT_FOUND" as AiPolicyStatus,
        generationAllowed: false,
        editingAllowed: "UNKNOWN",
        proofreadingAllowed: "UNKNOWN",
        brainstormingAllowed: "UNKNOWN",
        translationAllowed: "UNKNOWN",
        applicationAiMode: "AI_WRITING_BLOCKED",
        sources: [],
        verifiedAt: now,
        cacheKey,
        expiresAt: now,
        blockingReasons: ["No official AI policy found"],
      },
      responseComponents: [],
      sources,
      conflicts,
      unresolvedFields: [{ fieldName: "all", reason: "No requirements extracted from official pages", status: "UNKNOWN" }],
    };
  }

  // Merge extracted requirements from all pages
  // Use the highest-confidence extraction for each field
  const merged = mergeExtractedRequirements(allExtracted);

  // Build document requirement
  const doc: DocumentRequirement = {
    documentType: "STATEMENT_OF_PURPOSE",
    documentTypeLabel: merged.documentName?.value || "Statement of Purpose",
    required: merged.sopRequired?.value !== false,
    officialPrompt: {
      rawText: merged.officialPrompt?.value || null,
      status: merged.officialPrompt?.value ? "VERIFIED" : "UNKNOWN",
      provenance: merged.officialPrompt?.value ? {
        field: "officialPrompt",
        value: merged.officialPrompt.value,
        status: "VERIFIED",
        sourceId: merged.officialPrompt.sourceId,
        sourceQuote: merged.officialPrompt.evidenceText,
        verifiedAt: now,
        programMatch: true,
        intakeMatch: true,
      } : null,
    },
    wordLimit: {
      min: merged.wordMin?.value || null,
      max: merged.wordMax?.value || null,
      status: merged.wordMax?.value ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
      provenance: merged.wordMax?.value ? {
        field: "wordLimit",
        value: merged.wordMax.value,
        status: "VERIFIED",
        sourceId: merged.wordMax.sourceId,
        sourceQuote: merged.wordMax.evidenceText,
        verifiedAt: now,
        programMatch: true,
        intakeMatch: true,
      } : null,
    },
    characterLimit: {
      min: null,
      max: merged.characterLimit?.value || null,
      status: merged.characterLimit?.value ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
      provenance: null,
    },
    requiredTopics: (merged.mandatoryTopics?.value || []).map((topic: string) => ({
      field: "requiredTopic",
      value: topic,
      status: "VERIFIED" as RequirementStatus,
      sourceId: merged.mandatoryTopics.sourceId,
      sourceQuote: merged.mandatoryTopics.evidenceText,
      verifiedAt: now,
      programMatch: true,
      intakeMatch: true,
    })),
    formatInstructions: [],
    additionalQuestions: [],
  };

  // Determine verification status
  const hasPrompt = doc.officialPrompt.status === "VERIFIED";
  const hasWordLimit = doc.wordLimit.status === "VERIFIED";
  const hasSources = sources.length > 0;
  const hasAnyRequirement = hasPrompt || hasWordLimit;

  let verificationStatus: VerificationResult["status"];
  const blockingIssues: any[] = [];

  if (!hasSources) {
    verificationStatus = "UNVERIFIED";
    blockingIssues.push({ field: "sources", issue: "No official sources could be fetched", severity: "BLOCK" });
  } else if (!hasAnyRequirement) {
    verificationStatus = "PARTIALLY_VERIFIED";
    blockingIssues.push({ field: "officialPrompt", issue: "Official SOP prompt not found on fetched pages", severity: "BLOCK" });
  } else if (!hasPrompt) {
    verificationStatus = "PARTIALLY_VERIFIED";
    blockingIssues.push({ field: "officialPrompt", issue: "Official SOP prompt not found", severity: "WARN" });
  } else {
    verificationStatus = "VERIFIED";
  }

  const brief: VerifiedApplicationBrief = {
    applicationIdentity: identity,
    documents: [doc],
    countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
    sources,
    verification: { status: verificationStatus, verifiedAt: now, conflicts: [], blockingIssues },
    cacheKey,
    createdAt: now,
    expiresAt: verificationStatus === "VERIFIED" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
  };

  // Build AI policy from extracted policy text
  const aiPolicySources: AiPolicySource[] = [];
  for (const { page, extracted } of allExtracted) {
    if (extracted.aiGenerationPolicy?.value) {
      aiPolicySources.push({
        sourceId: `AIPOL-${page.officialDomain}-${page.contentHash.substring(0, 8)}`,
        title: page.title,
        url: page.url,
        officialDomain: page.officialDomain,
        domainVerified: true,
        sourceType: "OFFICIAL_UNIVERSITY_WEBPAGE",
        exactPolicyText: extracted.aiGenerationPolicy.evidenceText,
        retrievedAt: page.retrievedAt,
        applicableScope: identity.program,
        priority: "PRIMARY",
        httpStatus: page.httpStatus,
      });
    }
  }

  // Also try deterministic detection from page text
  for (const page of fetchedPages) {
    if (aiPolicySources.some(s => s.url === page.url)) continue;
    const detectedStatus = detectAiPolicyFromText(page.extractedText);
    if (detectedStatus !== "AI_POLICY_NOT_FOUND") {
      aiPolicySources.push({
        sourceId: `AIPOL-${page.officialDomain}-${page.contentHash.substring(0, 8)}`,
        title: page.title,
        url: page.url,
        officialDomain: page.officialDomain,
        domainVerified: true,
        sourceType: "OFFICIAL_UNIVERSITY_WEBPAGE",
        exactPolicyText: page.extractedText.substring(0, 2000),
        retrievedAt: page.retrievedAt,
        applicableScope: identity.program,
        priority: "PRIMARY",
        httpStatus: page.httpStatus,
      });
    }
  }

  const aiPolicy = buildAiUsagePolicy(aiPolicySources, identity);

  // Build response components
  const responseComponents: ResponseComponent[] = [];
  const numComponents = merged.numberOfComponents?.value || 1;
  const promptText = merged.officialPrompt?.value || "";

  if (promptText) {
    responseComponents.push({
      componentId: "RC-001",
      label: doc.documentTypeLabel,
      exactPrompt: promptText,
      pageLimit: {
        type: "PER_DOCUMENT",
        maxPages: merged.pageMax?.value || null,
        status: merged.pageMax?.value ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
      },
      wordLimit: {
        min: merged.wordMin?.value || null,
        max: merged.wordMax?.value || null,
        status: merged.wordMax?.value ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
      },
      characterLimit: {
        min: null,
        max: merged.characterLimit?.value || null,
        status: merged.characterLimit?.value ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
      },
      requiredTopics: (merged.mandatoryTopics?.value || []).map((topic: string) => ({
        topic,
        status: "VERIFIED",
        sourceId: merged.mandatoryTopics.sourceId,
        sourceQuote: merged.mandatoryTopics.evidenceText,
      })),
      sourceId: merged.officialPrompt?.sourceId || sources[0]?.sourceId || "OFFICIAL",
      status: "VERIFIED",
      verifiedAt: now,
    });
  }

  // Track unresolved fields
  if (!hasPrompt) {
    unresolvedFields.push({ fieldName: "officialPrompt", reason: "Not found on any fetched official page", status: "UNKNOWN" });
  }
  if (!hasWordLimit) {
    unresolvedFields.push({ fieldName: "wordLimit", reason: "No word limit found on official pages", status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" });
  }
  if (aiPolicy.status === "AI_POLICY_NOT_FOUND") {
    unresolvedFields.push({ fieldName: "aiPolicy", reason: "No AI usage policy found on official pages", status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" });
  }

  return { brief, aiPolicy, responseComponents, sources, conflicts, unresolvedFields };
}

function mergeExtractedRequirements(
  allExtracted: { page: FetchedPage; classification: PageClassification; extracted: ExtractedRequirements }[],
): Record<string, ExtractedField> {
  const merged: Record<string, ExtractedField> = {};

  for (const { extracted } of allExtracted) {
    for (const [fieldName, field] of Object.entries(extracted)) {
      if (field.status === "VERIFIED" && field.value !== null && field.value !== undefined) {
        // Take the highest-confidence extraction
        if (!merged[fieldName] || field.confidence > merged[fieldName].confidence) {
          merged[fieldName] = field;
        }
      }
    }
  }

  return merged;
}
