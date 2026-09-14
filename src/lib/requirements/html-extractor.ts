import { RequirementStatus, FieldProvenance } from "./types";

/**
 * Fetch an official HTML page.
 */
export async function fetchOfficialPage(url: string): Promise<{
  html: string;
  httpStatus: number;
  contentHash: string;
}> {
  const response = await fetch(url, {
    headers: { "User-Agent": "D-Vivid-SOP-AI-Requirements-Engine/1.0" },
    signal: AbortSignal.timeout(15000),
  });

  const html = await response.text();
  const contentHash = await hashContent(html);

  return { html, httpStatus: response.status, contentHash };
}

/**
 * Deterministic word limit extraction from text.
 * Looks for patterns like "Maximum 1000 words", "500-word statement", "500-750 words".
 */
export function extractWordLimit(text: string): {
  min: number | null;
  max: number | null;
  status: RequirementStatus;
  quote: string;
} {
  // Pattern: "Maximum X words" / "up to X words" / "no more than X words"
  let m = text.match(/(?:maximum|up to|no more than|not exceed(?:ing)?)\s+(\d[\d,]*)\s*words?/i);
  if (m) {
    const max = parseInt(m[1].replace(/,/g, ""), 10);
    return { min: null, max, status: "VERIFIED", quote: m[0] };
  }

  // Pattern: "X-Y words" / "X to Y words"
  m = text.match(/(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)\s*words?/i);
  if (m) {
    const min = parseInt(m[1].replace(/,/g, ""), 10);
    const max = parseInt(m[2].replace(/,/g, ""), 10);
    return { min, max, status: "VERIFIED", quote: m[0] };
  }

  // Pattern: "X-word statement/essay"
  m = text.match(/(\d[\d,]*)-word\s+(?:statement|essay|personal\s+statement|SOP)/i);
  if (m) {
    const max = parseInt(m[1].replace(/,/g, ""), 10);
    return { min: null, max, status: "VERIFIED", quote: m[0] };
  }

  // Pattern: "at least X words"
  m = text.match(/(?:at least|minimum of)\s+(\d[\d,]*)\s*words?/i);
  if (m) {
    const min = parseInt(m[1].replace(/,/g, ""), 10);
    return { min, max: null, status: "VERIFIED", quote: m[0] };
  }

  // Not found
  return { min: null, max: null, status: "UNKNOWN", quote: "" };
}

/**
 * Deterministic character limit extraction.
 */
export function extractCharacterLimit(text: string): {
  min: number | null;
  max: number | null;
  status: RequirementStatus;
  quote: string;
} {
  let m = text.match(/(?:maximum|up to|no more than|limit(?:ed)? to)\s+(\d[\d,]*)\s*characters?/i);
  if (m) {
    const max = parseInt(m[1].replace(/,/g, ""), 10);
    return { min: null, max, status: "VERIFIED", quote: m[0] };
  }

  m = text.match(/(\d[\d,]*)\s*[-–]+\s*(\d[\d,]*)\s*characters?/i);
  if (m) {
    return {
      min: parseInt(m[1].replace(/,/g, ""), 10),
      max: parseInt(m[2].replace(/,/g, ""), 10),
      status: "VERIFIED",
      quote: m[0],
    };
  }

  return { min: null, max: null, status: "UNKNOWN", quote: "" };
}

/**
 * Extract requirements from HTML content.
 * Ignores navigation, cookie notices, marketing text, footer boilerplate.
 */
export function extractRequirementsFromHtml(html: string, url: string): {
  wordLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
  characterLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
  promptText: string | null;
} {
  // Strip scripts, styles, nav, footer, header
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract text content
  const textContent = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const wordLimit = extractWordLimit(textContent);
  const characterLimit = extractCharacterLimit(textContent);

  // Try to find essay prompt — look for "statement of purpose" context
  let promptText: string | null = null;
  const promptMatch = textContent.match(
    /(?:statement of purpose|personal statement|motivation letter|essay question)[:\s]+(.{20,500}?)(?:\.\s+(?:Word|Maximum|Limit|Submit|Please)|$)/i
  );
  if (promptMatch) {
    promptText = promptMatch[1].trim();
  }

  return { wordLimit, characterLimit, promptText };
}

async function hashContent(content: string): Promise<string> {
  // Simple hash for content identification
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
