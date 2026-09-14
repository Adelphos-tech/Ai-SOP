// ============================================================
// CANDIDATE PAGE SCORING + SITEMAP DISCOVERY
// Phase SOP-AI-28
// ============================================================
// Deterministic scoring of candidate URLs before spending
// AI calls. Program-specific pages rank above university-wide
// pages.
// ============================================================

import { verifyOfficialDomain } from "./domain-verification";
import { CandidateSource } from "./discovery-types";

// ============================================================
// CANDIDATE SCORING
// ============================================================

export interface ScoredCandidate {
  candidate: CandidateSource;
  score: number;
  scopeRank: number; // 0=APPLICATION, 1=PROGRAM, 2=DEPARTMENT, 3=SCHOOL, 4=GRADUATE_SCHOOL, 5=UNIVERSITY
  reasons: string[];
}

/**
 * Score a candidate URL deterministically.
 * Higher score = more relevant to the specific application.
 */
export function scoreCandidate(
  candidate: CandidateSource,
  identity: {
    university: string;
    program: string;
    department?: string;
    degree: string;
    intake: string;
    country: string;
  },
): ScoredCandidate {
  let score = 0;
  const reasons: string[] = [];
  const url = candidate.url.toLowerCase();
  const urlPath = url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();

  // Program name match in URL
  const programWords = identity.program.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let programMatches = 0;
  for (const word of programWords) {
    if (url.includes(word)) {
      programMatches++;
      score += 10;
    }
  }
  // Check for common abbreviations
  const programLower = identity.program.toLowerCase();
  const abbreviations: Record<string, string[]> = {
    "civil and environmental engineering": ["cee", "civil", "environmental"],
    "computer science": ["cs", "comp-sci", "computing"],
    "electrical engineering": ["ee", "electrical"],
    "mechanical engineering": ["me", "mech", "mechanical"],
    "data science": ["ds", "data-science", "datascience"],
    "artificial intelligence": ["ai", "artificial-intelligence"],
    "business administration": ["mba", "business", "management"],
  };
  for (const [full, abbrs] of Object.entries(abbreviations)) {
    if (programLower.includes(full)) {
      for (const abbr of abbrs) {
        if (url.includes(abbr)) {
          programMatches++;
          score += 8;
          reasons.push(`program abbreviation "${abbr}" match in URL`);
        }
      }
    }
  }
  if (programMatches > 0) {
    reasons.push(`program name match (${programMatches} words in URL)`);
  }

  // Subdomain match (e.g., cee.mit.edu matches CEE program)
  try {
    const hostname = new URL(candidate.url).hostname;
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const subdomain = parts[0].toLowerCase();
      // Check if subdomain matches program abbreviation
      for (const [, abbrs] of Object.entries(abbreviations)) {
        if (abbrs.some(a => subdomain === a)) {
          score += 15;
          reasons.push(`subdomain "${subdomain}" matches program`);
        }
      }
    }
  } catch {
    // skip
  }

  // Department match in URL
  if (identity.department) {
    const deptWords = identity.department.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    for (const word of deptWords) {
      if (url.includes(word)) {
        score += 8;
        reasons.push(`department match in URL`);
      }
    }
  }

  // Degree match
  const degreeLower = identity.degree.toLowerCase();
  if (degreeLower.includes("master") || degreeLower.includes("meng") || degreeLower.includes("m.s") || degreeLower.includes("ms")) {
    if (urlPath.includes("graduate") || urlPath.includes("grad") || urlPath.includes("master")) {
      score += 5;
      reasons.push("graduate/degree match in URL");
    }
  }
  if (degreeLower.includes("phd") || degreeLower.includes("doctor")) {
    if (urlPath.includes("phd") || urlPath.includes("doctoral") || urlPath.includes("doctor")) {
      score += 5;
      reasons.push("doctoral match in URL");
    }
  }

  // Admissions keywords in URL
  const admissionsKeywords = ["admission", "apply", "application", "requirements"];
  for (const kw of admissionsKeywords) {
    if (urlPath.includes(kw)) {
      score += 3;
      reasons.push(`admissions keyword "${kw}" in URL`);
    }
  }

  // SOP/Statement keywords in URL
  const sopKeywords = ["statement", "sop", "essay", "personal-statement", "purpose", "objectives"];
  for (const kw of sopKeywords) {
    if (urlPath.includes(kw)) {
      score += 8;
      reasons.push(`SOP keyword "${kw}" in URL`);
    }
  }

  // AI policy keywords
  const aiKeywords = ["ai", "generative", "chatgpt", "artificial-intelligence", "ai-policy", "ai-use"];
  for (const kw of aiKeywords) {
    if (urlPath.includes(kw)) {
      score += 6;
      reasons.push(`AI policy keyword "${kw}" in URL`);
    }
  }

  // Faculty keywords
  const facultyKeywords = ["faculty", "professor", "advisor"];
  for (const kw of facultyKeywords) {
    if (urlPath.includes(kw)) {
      score += 4;
      reasons.push(`faculty keyword "${kw}" in URL`);
    }
  }

  // Source type bonus
  if (candidate.sourceType === "PROGRAM_REQUIREMENTS") {
    score += 5;
    reasons.push("source type: PROGRAM_REQUIREMENTS");
  } else if (candidate.sourceType === "STATEMENT_REQUIREMENTS") {
    score += 7;
    reasons.push("source type: STATEMENT_REQUIREMENTS");
  } else if (candidate.sourceType === "AI_USAGE_POLICY") {
    score += 6;
    reasons.push("source type: AI_USAGE_POLICY");
  }

  // Discovery method bonus
  if (candidate.discoveryMethod === "REGISTRY") {
    score += 3;
    reasons.push("from registry");
  } else if (candidate.discoveryMethod === "CONSULTANT_HINT") {
    score += 2;
    reasons.push("from consultant hint");
  }

  // Determine scope rank (lower = more specific)
  let scopeRank = 5; // UNIVERSITY by default
  if (urlPath.includes("apply") || urlPath.includes("application")) scopeRank = 0;
  else if (programMatches > 0) scopeRank = 1;
  else if (identity.department && urlPath.includes(identity.department.toLowerCase().split(/\s+/)[0])) scopeRank = 2;
  else if (urlPath.includes("graduate")) scopeRank = 4;
  else if (urlPath.includes("admission")) scopeRank = 5;

  return { candidate, score, scopeRank, reasons };
}

/**
 * Sort candidates by score (highest first), then by scope (most specific first).
 */
export function rankCandidates(
  candidates: CandidateSource[],
  identity: {
    university: string;
    program: string;
    department?: string;
    degree: string;
    intake: string;
    country: string;
  },
): ScoredCandidate[] {
  return candidates
    .map(c => scoreCandidate(c, identity))
    .sort((a, b) => {
      // Higher score first
      if (b.score !== a.score) return b.score - a.score;
      // More specific scope first (lower rank number)
      return a.scopeRank - b.scopeRank;
    });
}

// ============================================================
// INTERNAL LINK DISCOVERY
// ============================================================

/**
 * Extract relevant internal links from a fetched page's HTML.
 * Returns links that look like admissions/requirements/SOP/policy pages.
 */
export function extractRelevantLinks(
  html: string,
  baseUrl: string,
  identity: {
    university: string;
    program: string;
    department?: string;
  },
): string[] {
  const links: string[] = [];
  const linkRegex = /href="([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    let fullUrl: string;
    try {
      if (href.startsWith("http")) {
        fullUrl = href;
      } else if (href.startsWith("/")) {
        const base = new URL(baseUrl);
        fullUrl = `${base.origin}${href}`;
      } else {
        continue;
      }
    } catch {
      continue;
    }

    // Must be same domain as the base URL
    try {
      const baseHostname = new URL(baseUrl).hostname;
      const linkHostname = new URL(fullUrl).hostname;
      if (baseHostname !== linkHostname && !linkHostname.endsWith(`.${baseHostname}`)) {
        continue;
      }
    } catch {
      continue;
    }

    // Filter by relevance
    const urlLower = fullUrl.toLowerCase();
    const isRelevant =
      urlLower.includes("admission") ||
      urlLower.includes("apply") ||
      urlLower.includes("requirements") ||
      urlLower.includes("statement") ||
      urlLower.includes("essay") ||
      urlLower.includes("sop") ||
      urlLower.includes("personal-statement") ||
      urlLower.includes("purpose") ||
      urlLower.includes("objectives") ||
      urlLower.includes("ai-policy") ||
      urlLower.includes("generative") ||
      urlLower.includes("chatgpt") ||
      urlLower.includes("graduate") ||
      urlLower.includes("program") ||
      urlLower.includes("faculty") ||
      urlLower.includes("department");

    if (!isRelevant) continue;

    // Program-specific link bonus
    const programWords = identity.program.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const hasProgramMatch = programWords.some(w => urlLower.includes(w));

    // Check anchor text context (look at surrounding text)
    const anchorContext = html.substring(Math.max(0, match.index! - 200), match.index! + href.length + 200).toLowerCase();
    const hasContextMatch =
      anchorContext.includes("statement of purpose") ||
      anchorContext.includes("personal statement") ||
      anchorContext.includes("application requirements") ||
      anchorContext.includes("essay") ||
      anchorContext.includes("admission");

    if (isRelevant || hasProgramMatch || hasContextMatch) {
      links.push(fullUrl);
    }
  }

  return Array.from(new Set(links));
}

// ============================================================
// SITEMAP DISCOVERY
// ============================================================

/**
 * Fetch and parse a sitemap.xml from an official domain.
 * Returns filtered URLs relevant to admissions/requirements/SOP.
 */
export async function discoverFromSitemap(
  domainUrl: string,
  identity: {
    university: string;
    program: string;
    department?: string;
  },
  maxUrls = 20,
): Promise<string[]> {
  const results: string[] = [];

  // Try common sitemap locations
  const sitemapUrls = [
    `${domainUrl}/sitemap.xml`,
    `${domainUrl}/sitemap_index.xml`,
    `${domainUrl}/sitemap-index.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    if (results.length >= maxUrls) break;
    try {
      const response = await fetch(sitemapUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; D-Vivid-SOP-Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });

      if (!response.ok) continue;

      const xml = await response.text();

      // Check if this is a sitemap index (contains <sitemap> elements)
      if (xml.includes("<sitemapindex")) {
        // Extract sub-sitemap URLs
        const subSitemapRegex = /<loc>([^<]+)<\/loc>/gi;
        let subMatch: RegExpExecArray | null;
        const subSitemaps: string[] = [];
        while ((subMatch = subSitemapRegex.exec(xml)) !== null) {
          subSitemaps.push(subMatch[1]);
        }

        // Fetch each sub-sitemap (bounded)
        for (const subUrl of subSitemaps.slice(0, 5)) {
          if (results.length >= maxUrls) break;
          try {
            const subResponse = await fetch(subUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; D-Vivid-SOP-Bot/1.0)" },
              signal: AbortSignal.timeout(10000),
            });
            if (!subResponse.ok) continue;
            const subXml = await subResponse.text();
            const pageUrls = parseSitemapUrls(subXml, identity, maxUrls - results.length);
            results.push(...pageUrls);
          } catch {
            // skip
          }
        }
      } else {
        // Regular sitemap
        const pageUrls = parseSitemapUrls(xml, identity, maxUrls - results.length);
        results.push(...pageUrls);
      }
    } catch {
      // sitemap not found — skip
    }
  }

  return Array.from(new Set(results)).slice(0, maxUrls);
}

function parseSitemapUrls(
  xml: string,
  identity: { university: string; program: string; department?: string },
  maxUrls: number,
): string[] {
  const urls: string[] = [];
  const urlRegex = /<loc>([^<]+)<\/loc>/gi;
  let match: RegExpExecArray | null;

  const programWords = identity.program.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  while ((match = urlRegex.exec(xml)) !== null && urls.length < maxUrls) {
    const url = match[1];
    const urlLower = url.toLowerCase();

    // Filter by relevance
    const isRelevant =
      urlLower.includes("admission") ||
      urlLower.includes("apply") ||
      urlLower.includes("requirements") ||
      urlLower.includes("statement") ||
      urlLower.includes("essay") ||
      urlLower.includes("sop") ||
      urlLower.includes("personal-statement") ||
      urlLower.includes("purpose") ||
      urlLower.includes("objectives") ||
      urlLower.includes("ai-policy") ||
      urlLower.includes("generative") ||
      urlLower.includes("graduate") ||
      urlLower.includes("program") ||
      urlLower.includes("faculty");

    if (!isRelevant) continue;

    // Program-specific bonus
    const hasProgramMatch = programWords.some(w => urlLower.includes(w));
    if (hasProgramMatch) {
      urls.unshift(url); // prioritize
    } else {
      urls.push(url);
    }
  }

  return urls;
}

// ============================================================
// REQUIRED FIELD TRACKING
// ============================================================

export interface RequiredFieldState {
  officialPrompt: boolean;
  wordLimit: boolean;
  pageLimit: boolean;
  aiPolicy: boolean;
  facultyRequirement: boolean;
  responseComponents: boolean;
}

export function getInitialRequiredFields(): RequiredFieldState {
  return {
    officialPrompt: false,
    wordLimit: false,
    pageLimit: false,
    aiPolicy: false,
    facultyRequirement: false,
    responseComponents: false,
  };
}

export function getUnresolvedFields(state: RequiredFieldState): string[] {
  const unresolved: string[] = [];
  if (!state.officialPrompt) unresolved.push("officialPrompt");
  if (!state.wordLimit) unresolved.push("wordLimit");
  if (!state.pageLimit) unresolved.push("pageLimit");
  if (!state.aiPolicy) unresolved.push("aiPolicy");
  if (!state.facultyRequirement) unresolved.push("facultyRequirement");
  if (!state.responseComponents) unresolved.push("responseComponents");
  return unresolved;
}

export function allRequiredFieldsResolved(state: RequiredFieldState): boolean {
  // AI policy is always required. Others may be optional depending on the program.
  // For MVP: officialPrompt + aiPolicy are the critical ones.
  return state.officialPrompt && state.aiPolicy;
}

export function criticalFieldsResolved(state: RequiredFieldState): boolean {
  return state.officialPrompt && state.aiPolicy;
}
