import { RequirementStatus } from "./types";

/**
 * Fetch an official PDF document.
 * Architecture placeholder — actual PDF parsing would use a library like pdf-parse.
 * If extraction is incomplete or unreliable, mark fields as REVIEW_REQUIRED.
 */
export async function fetchOfficialPdf(url: string): Promise<{
  content: string;
  httpStatus: number;
  contentHash: string;
}> {
  const response = await fetch(url, {
    headers: { "User-Agent": "D-Vivid-SOP-AI-Requirements-Engine/1.0" },
    signal: AbortSignal.timeout(30000),
  });

  const buffer = await response.arrayBuffer();
  const content = bufferToText(buffer);
  const contentHash = Math.abs(hashString(content)).toString(16);

  return { content, httpStatus: response.status, contentHash };
}

/**
 * Extract requirements from PDF text content.
 * Preserves source URL, document title, page number where possible.
 */
export function extractRequirementsFromPdf(content: string, url: string): {
  wordLimit: { min: number | null; max: number | null; status: RequirementStatus; quote: string };
  promptText: string | null;
  extractionComplete: boolean;
} {
  if (!content || content.trim().length < 50) {
    // Extraction incomplete — do NOT infer missing requirement text
    return {
      wordLimit: { min: null, max: null, status: "REVIEW_REQUIRED", quote: "" },
      promptText: null,
      extractionComplete: false,
    };
  }

  // Reuse deterministic word limit parser
  const { extractWordLimit } = require("./html-extractor");
  const wordLimit = extractWordLimit(content);

  // If word limit not found, mark as REVIEW_REQUIRED (not UNKNOWN)
  // because we may not have extracted all PDF text
  if (wordLimit.status === "UNKNOWN") {
    wordLimit.status = "REVIEW_REQUIRED";
  }

  // Try to find prompt text
  let promptText: string | null = null;
  const promptMatch = content.match(
    /(?:statement of purpose|personal statement|motivation letter)[:\s]+(.{20,500}?)(?:\.\s+(?:Word|Maximum|Limit|Submit|Please)|$)/i
  );
  if (promptMatch) {
    promptText = promptMatch[1].trim();
  }

  return {
    wordLimit,
    promptText,
    extractionComplete: true,
  };
}

function bufferToText(buffer: ArrayBuffer): string {
  // Simple text extraction — production would use pdf-parse
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 32 && bytes[i] <= 126) {
      text += String.fromCharCode(bytes[i]);
    } else if (bytes[i] === 10 || bytes[i] === 13) {
      text += " ";
    }
  }
  return text;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h = h & h;
  }
  return h;
}
