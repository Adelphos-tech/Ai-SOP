import { OfficialDomainMapping, SourceClass } from "./types";

// Registry of known official domains — extensible
const OFFICIAL_DOMAIN_REGISTRY: OfficialDomainMapping[] = [
  { organization: "Arizona State University", officialDomains: ["asu.edu"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "Stanford University", officialDomains: ["stanford.edu"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "MIT", officialDomains: ["mit.edu"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "UC Berkeley", officialDomains: ["berkeley.edu"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "University of Oxford", officialDomains: ["ox.ac.uk"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "University of Melbourne", officialDomains: ["unimelb.edu.au"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "Nirma University", officialDomains: ["nirmauni.ac.in"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "CHARUSAT", officialDomains: ["charusat.ac.in"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "Gujarat Technological University", officialDomains: ["gtu.ac.in"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "Auro University", officialDomains: ["aurouniversity.edu.in"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_UNIVERSITY_WEBPAGE" },
  { organization: "Australian Government — Study in Australia", officialDomains: ["studyinaustralia.gov.au"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_COUNTRY_SOURCE" },
  { organization: "UK Government — GOV.UK", officialDomains: ["gov.uk"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_COUNTRY_SOURCE" },
  { organization: "US Department of Education", officialDomains: ["ed.gov"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_COUNTRY_SOURCE" },
  { organization: "Government of India — Education", officialDomains: ["education.gov.in", "mhrd.gov.in"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_COUNTRY_SOURCE" },
  { organization: "German Academic Exchange Service", officialDomains: ["daad.de"], verifiedAt: "2026-09-09", sourceClass: "OFFICIAL_COUNTRY_SOURCE" },
];

/**
 * Check if a URL belongs to an official organization domain.
 * NEVER trust page title alone — only domain verification.
 */
export function isOfficialDomain(url: string, organization: string, mappings: OfficialDomainMapping[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const mapping of mappings) {
      if (mapping.organization.toLowerCase() === organization.toLowerCase()) {
        for (const domain of mapping.officialDomains) {
          if (hostname === domain || hostname.endsWith("." + domain)) {
            return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify official domain against the registry.
 * If official-domain status is uncertain, return verified=false.
 */
export function verifyOfficialDomain(url: string, sourceClass: SourceClass): {
  verified: boolean;
  organization: string;
  domain: string;
} {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Check against registry
    for (const mapping of OFFICIAL_DOMAIN_REGISTRY) {
      if (mapping.sourceClass === sourceClass) {
        for (const domain of mapping.officialDomains) {
          if (hostname === domain || hostname.endsWith("." + domain)) {
            return { verified: true, organization: mapping.organization, domain };
          }
        }
      }
    }

    // Heuristic: .edu, .gov, .ac.* domains are likely official
    if (sourceClass === "OFFICIAL_UNIVERSITY_WEBPAGE") {
      if (hostname.endsWith(".edu") || hostname.endsWith(".edu.au") || hostname.match(/\.ac\.[a-z]{2}$/)) {
        return { verified: true, organization: hostname, domain: hostname };
      }
    }
    if (sourceClass === "OFFICIAL_COUNTRY_SOURCE") {
      if (hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") || hostname.endsWith(".gov.au") || hostname.endsWith(".gov.in")) {
        return { verified: true, organization: hostname, domain: hostname };
      }
    }

    // Uncertain — do not treat as verified
    return { verified: false, organization: "", domain: hostname };
  } catch {
    return { verified: false, organization: "", domain: "" };
  }
}

/**
 * Get the official domain registry (for UI display).
 */
export function getOfficialDomainRegistry(): OfficialDomainMapping[] {
  return [...OFFICIAL_DOMAIN_REGISTRY];
}

/**
 * Look up official requirements page URLs for a university.
 * Returns registry URLs if the university is in the registry.
 */
export function lookupRequirementsPageUrls(university: string): string[] {
  const lower = university.toLowerCase();
  for (const mapping of OFFICIAL_DOMAIN_REGISTRY) {
    if (mapping.organization.toLowerCase() === lower) {
      return mapping.requirementsPageUrls || [];
    }
  }
  return [];
}

/**
 * Look up official AI policy page URLs for a university.
 * Returns registry URLs if the university is in the registry.
 */
export function lookupAiPolicyPageUrls(university: string): string[] {
  const lower = university.toLowerCase();
  for (const mapping of OFFICIAL_DOMAIN_REGISTRY) {
    if (mapping.organization.toLowerCase() === lower) {
      return mapping.aiPolicyPageUrls || [];
    }
  }
  return [];
}
