// ============================================================
// SEARCH PROVIDER IMPLEMENTATIONS
// Phase SOP-AI-27
// ============================================================
// Search results are URL discovery hints ONLY.
// Search snippets are NOT evidence.
// All evidence must come from fetched official-source pages.
// ============================================================

import { OfficialSourceSearchProvider, SearchResult } from "./discovery-types";
import { verifyOfficialDomain } from "./domain-verification";

/**
 * Link discovery search provider.
 * Fetches the university homepage and extracts links that look like
 * admissions/requirements pages. No external search API required.
 */
export class LinkDiscoverySearchProvider implements OfficialSourceSearchProvider {
  async search(query: string, allowedDomains?: string[]): Promise<SearchResult[]> {
    // Extract university name from query (first few words before "application" etc.)
    const universityMatch = query.match(/^(.+?)\s+(?:application|admissions|statement|personal|essay|graduate|generative|AI)/i);
    if (!universityMatch) return [];

    const universityName = universityMatch[1].trim();
    const candidateHomepageUrls = guessUniversityHomepage(universityName);
    const results: SearchResult[] = [];

    for (const homepageUrl of candidateHomepageUrls) {
      try {
        const homepageLinks = await extractLinksFromPage(homepageUrl);
        for (const link of homepageLinks) {
          // Filter by relevance to the query
          const linkLower = link.toLowerCase();
          const queryLower = query.toLowerCase();

          // Check if link seems relevant to admissions/requirements
          const isRelevant =
            linkLower.includes("admission") ||
            linkLower.includes("apply") ||
            linkLower.includes("requirements") ||
            linkLower.includes("statement") ||
            linkLower.includes("essay") ||
            linkLower.includes("sop") ||
            linkLower.includes("personal-statement") ||
            linkLower.includes("ai-policy") ||
            linkLower.includes("generative-ai") ||
            linkLower.includes("chatgpt") ||
            linkLower.includes("graduate") ||
            linkLower.includes("program") ||
            linkLower.includes("cee") ||
            linkLower.includes("civil") ||
            linkLower.includes("environmental");

          if (!isRelevant) continue;

          // Verify domain
          const domainCheck = verifyOfficialDomain(link, "OFFICIAL_UNIVERSITY_WEBPAGE");
          if (!domainCheck.verified) continue;

          // Filter by allowed domains if specified
          if (allowedDomains && allowedDomains.length > 0) {
            try {
              const hostname = new URL(link).hostname;
              if (!allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) continue;
            } catch {
              continue;
            }
          }

          results.push({
            url: link,
            title: link,
            snippet: "",
          });
        }
      } catch {
        // Homepage fetch failed — skip
      }
    }

    return results;
  }
}

/**
 * Guess university homepage URL from name.
 */
function guessUniversityHomepage(universityName: string): string[] {
  const candidates: string[] = [];
  const normalized = universityName.toLowerCase().trim();

  // Common patterns
  if (normalized.includes("massachusetts institute") || normalized.includes("mit")) {
    candidates.push("https://www.mit.edu");
    candidates.push("https://grad.mit.edu");
  } else if (normalized.includes("harvard")) {
    candidates.push("https://www.harvard.edu");
    candidates.push("https://gsas.harvard.edu");
  } else if (normalized.includes("stanford")) {
    candidates.push("https://www.stanford.edu");
  } else if (normalized.includes("berkeley") || normalized.includes("california")) {
    candidates.push("https://www.berkeley.edu");
  } else {
    // Generic: try .edu domain
    const shortName = normalized.split(" ")[0];
    candidates.push(`https://www.${shortName}.edu`);
  }

  return candidates;
}

/**
 * Extract links from a page.
 */
async function extractLinksFromPage(url: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; D-Vivid-SOP-Bot/1.0)" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!response.ok) return [];

  const html = await response.text();
  const links: string[] = [];
  const linkRegex = /href="([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    // Resolve relative URLs
    try {
      if (href.startsWith("http")) {
        links.push(href);
      } else if (href.startsWith("/")) {
        const base = new URL(url);
        links.push(`${base.origin}${href}`);
      }
    } catch {
      // skip malformed
    }
  }

  return Array.from(new Set(links)); // deduplicate
}

/**
 * DuckDuckGo HTML search provider — may not work if DuckDuckGo blocks automated requests.
 * Kept as a fallback.
 */
export class DuckDuckGoSearchProvider implements OfficialSourceSearchProvider {
  async search(query: string, allowedDomains?: string[]): Promise<SearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; D-Vivid-SOP-Bot/1.0)",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];

      const html = await response.text();
      const results = parseDuckDuckGoResults(html);

      if (allowedDomains && allowedDomains.length > 0) {
        return results.filter(r => {
          try {
            const hostname = new URL(r.url).hostname;
            return allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
          } catch {
            return false;
          }
        });
      }

      return results;
    } catch {
      return [];
    }
  }
}

/**
 * Parse DuckDuckGo HTML search results.
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  const linkRegex = /class="result__a"\s+href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const actualUrl = decodeURIComponent(match[1]);
      results.push({ url: actualUrl, title: "", snippet: "" });
    } catch {
      // skip malformed
    }
  }

  // Fallback: direct links
  if (results.length === 0) {
    const directLinkRegex = /class="result__a"\s+href="([^"]+)"/g;
    while ((match = directLinkRegex.exec(html)) !== null) {
      const href = match[1];
      if (href.startsWith("http") && !href.includes("duckduckgo.com")) {
        results.push({ url: href, title: "", snippet: "" });
      }
    }
  }

  return results;
}

/**
 * Mock search provider for deterministic testing.
 */
export class MockSearchProvider implements OfficialSourceSearchProvider {
  private results: Map<string, SearchResult[]> = new Map();

  setResults(query: string, results: SearchResult[]) {
    this.results.set(query.toLowerCase(), results);
  }

  async search(query: string, allowedDomains?: string[]): Promise<SearchResult[]> {
    const key = query.toLowerCase();
    let results = this.results.get(key) || [];

    if (allowedDomains && allowedDomains.length > 0) {
      results = results.filter(r => {
        try {
          const hostname = new URL(r.url).hostname;
          return allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
        } catch {
          return false;
        }
      });
    }

    return results;
  }
}

/**
 * Generate deterministic search queries from application identity.
 * Phase 28: Expanded query families with department and program-specific focus.
 */
export function generateSearchQueries(input: {
  university: string;
  program: string;
  degree: string;
  country: string;
  department?: string;
}): string[] {
  const { university, program, degree, country, department } = input;
  const programShort = program.length > 50 ? program.substring(0, 50) : program;
  const queries: string[] = [];

  // Program-specific queries
  queries.push(`${university} ${programShort} application requirements`);
  queries.push(`${university} ${programShort} statement of purpose`);
  queries.push(`${university} ${programShort} personal statement`);
  queries.push(`${university} ${programShort} admissions requirements`);
  queries.push(`${university} ${programShort} essay questions`);
  queries.push(`${university} ${programShort} graduate admissions`);

  // Department queries (if available)
  if (department) {
    queries.push(`${university} ${department} admissions requirements`);
    queries.push(`${university} ${department} graduate program`);
  }

  // Degree-level queries
  if (degree.toLowerCase().includes("master") || degree.toLowerCase().includes("meng")) {
    queries.push(`${university} ${programShort} master application essay`);
  }
  if (degree.toLowerCase().includes("phd") || degree.toLowerCase().includes("doctor")) {
    queries.push(`${university} ${programShort} PhD application statement`);
  }

  // Faculty queries
  queries.push(`${university} ${programShort} faculty application requirements`);

  // AI policy queries (separate family)
  queries.push(`${university} generative AI admissions policy`);
  queries.push(`${university} AI personal statement policy`);
  queries.push(`${university} academic integrity AI application`);

  return queries;
}

/**
 * Generate AI-policy-specific search queries.
 */
export function generateAiPolicySearchQueries(input: {
  university: string;
  program?: string;
}): string[] {
  const { university, program } = input;
  const queries = [
    `${university} generative AI admissions policy`,
    `${university} AI personal statement policy`,
    `${university} AI use application policy`,
    `${university} ChatGPT admissions policy`,
    `${university} academic integrity AI application`,
  ];
  if (program) {
    queries.push(`${university} ${program} AI policy`);
  }
  return queries;
}
