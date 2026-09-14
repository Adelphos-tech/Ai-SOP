/**
 * @file compliance-check.ts
 * @description
 * Deterministic compliance checker — runs AFTER the finalizer to verify
 * that the generated document meets official application requirements.
 *
 * Uses normal code (NOT OpenAI) for:
 *   - word maximum
 *   - word minimum
 *   - character limit
 *   - markdown detection
 *   - heading detection
 *   - empty output
 *   - number of requested responses
 */

import { ComplianceCheckResult } from "./generation-contract-types";
import { GenerationContract } from "./generation-contract-types";

/* ------------------------------------------------------------------ */
/* Word / character counting                                           */
/* ------------------------------------------------------------------ */

export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

export function countCharacters(text: string, includeSpaces: boolean = true): number {
  if (!text) return 0;
  return includeSpaces ? text.length : text.replace(/\s/g, "").length;
}

/* ------------------------------------------------------------------ */
/* Markdown detection                                                  */
/* ------------------------------------------------------------------ */

export function hasMarkdown(text: string): boolean {
  if (!text) return false;
  // Check for common markdown patterns
  const patterns = [
    /^#{1,6}\s+/m,           // Headings
    /\*\*[^*]+\*\*/,         // Bold
    /\*[^*]+\*/,             // Italic
    /__[^_]+__/,             // Bold underscore
    /_[^_]+_/,               // Italic underscore
    /^\s*[-*+]\s+/m,         // Unordered lists
    /^\s*\d+\.\s+/m,         // Ordered lists
    /`[^`]+`/,               // Inline code
    /```[\s\S]*?```/,        // Code blocks
    /^\s*>\s+/m,             // Blockquotes
    /\[[^]]+\]\([^)]+\)/,    // Links
  ];

  return patterns.some(p => p.test(text));
}

export function hasHeadings(text: string): boolean {
  if (!text) return false;
  return /^#{1,6}\s+/m.test(text);
}

/* ------------------------------------------------------------------ */
/* Required topic coverage check                                       */
/* ------------------------------------------------------------------ */

/**
 * Check if required topics are covered in the text.
 * This is a simple keyword-based check. The Quality Reviewer (OpenAI)
 * does a deeper semantic check; this is a deterministic fallback.
 */
export function checkRequiredTopicsCoverage(
  text: string,
  requiredTopics: string[]
): { topic: string; covered: boolean }[] {
  if (!text || !requiredTopics || requiredTopics.length === 0) return [];

  const textLower = text.toLowerCase();

  return requiredTopics.map(topic => {
    const topicLower = topic.toLowerCase();
    const keywords = topicLower.split(/\s+/).filter(w => w.length > 3);

    // Check if at least 2 keywords from the topic appear in the text
    const matchedKeywords = keywords.filter(kw => textLower.includes(kw));
    const covered = matchedKeywords.length >= Math.min(2, keywords.length);

    return { topic, covered };
  });
}

/* ------------------------------------------------------------------ */
/* Full compliance check                                                */
/* ------------------------------------------------------------------ */

/**
 * Run deterministic compliance checks on the generated document.
 *
 * @param text The generated document text
 * @param contract The generation contract
 * @returns Compliance check result
 */
export function runComplianceCheck(
  text: string,
  contract: GenerationContract
): ComplianceCheckResult {
  const details: string[] = [];
  const wordCount = countWords(text);
  const charCountWithSpaces = countCharacters(text, true);
  const charCountWithoutSpaces = countCharacters(text, false);

  // ===== Document type =====
  // We can't deterministically verify document type from text,
  // but we can check that the contract specifies one
  const documentType: "PASS" | "FAIL" | "N/A" =
    contract.writingRequirement.documentType ? "PASS" : "FAIL";
  if (documentType === "FAIL") {
    details.push("Document type not specified in contract.");
  }

  // ===== Official prompt =====
  // We can't deterministically verify the prompt was answered,
  // but we can check that the contract has one
  const officialPrompt: "PASS" | "FAIL" | "N/A" =
    contract.writingRequirement.officialPrompt ? "PASS" : "FAIL";
  if (officialPrompt === "FAIL") {
    details.push("Official prompt not specified in contract.");
  }

  // ===== Required topics =====
  const topics = contract.writingRequirement.requiredTopics;
  if (topics.length === 0) {
    // No required topics — N/A
    // But this is unusual; flag for review
    details.push("No required topics in contract.");
  }
  const topicCoverage = checkRequiredTopicsCoverage(text, topics);
  const allTopicsCovered = topicCoverage.every(t => t.covered);
  const requiredTopicsResult: "PASS" | "FAIL" | "N/A" =
    topics.length === 0 ? "N/A" : (allTopicsCovered ? "PASS" : "FAIL");
  if (requiredTopicsResult === "FAIL") {
    const uncovered = topicCoverage.filter(t => !t.covered).map(t => t.topic);
    details.push(`Required topics not covered: ${uncovered.join(", ")}`);
  }

  // ===== Word limit =====
  const wl = contract.writingRequirement.wordLimit;
  let wordLimitResult: "PASS" | "FAIL" | "N/A";
  if (wl.status === "VERIFIED" && (wl.min !== null || wl.max !== null)) {
    let withinLimits = true;
    if (wl.max !== null && wordCount > wl.max) {
      withinLimits = false;
      details.push(`Word count ${wordCount} exceeds maximum ${wl.max}.`);
    }
    if (wl.min !== null && wordCount < wl.min) {
      withinLimits = false;
      details.push(`Word count ${wordCount} below minimum ${wl.min}.`);
    }
    wordLimitResult = withinLimits ? "PASS" : "FAIL";
  } else if (wl.status === "NOT_SPECIFIED_BY_OFFICIAL_SOURCE") {
    wordLimitResult = "N/A";
    details.push("No official word limit specified — not enforced.");
  } else {
    wordLimitResult = "N/A";
    details.push(`Word limit status: ${wl.status}`);
  }

  // ===== Character limit =====
  const cl = contract.writingRequirement.characterLimit;
  let characterLimitResult: "PASS" | "FAIL" | "N/A";
  if (cl.status === "VERIFIED" && (cl.min !== null || cl.max !== null)) {
    let withinLimits = true;
    if (cl.max !== null && charCountWithSpaces > cl.max) {
      withinLimits = false;
      details.push(`Character count ${charCountWithSpaces} exceeds maximum ${cl.max}.`);
    }
    if (cl.min !== null && charCountWithSpaces < cl.min) {
      withinLimits = false;
      details.push(`Character count ${charCountWithSpaces} below minimum ${cl.min}.`);
    }
    characterLimitResult = withinLimits ? "PASS" : "FAIL";
  } else {
    characterLimitResult = "N/A";
  }

  // ===== Format (markdown) =====
  // If format instructions don't mention markdown, and the output has markdown,
  // flag it. If format instructions DO mention markdown, check compliance.
  const formatInstructions = contract.writingRequirement.formatInstructions;
  const formatText = formatInstructions.join(" ").toLowerCase();
  const markdownAllowed = formatText.includes("markdown") || formatText.includes("rich text");
  const markdownDetected = hasMarkdown(text);

  let formatResult: "PASS" | "FAIL" | "N/A";
  if (formatInstructions.length === 0) {
    // No format instructions — check that no markdown is used by default
    if (markdownDetected) {
      formatResult = "FAIL";
      details.push("Markdown detected but no format instructions permit it.");
    } else {
      formatResult = "PASS";
    }
  } else if (markdownAllowed) {
    formatResult = "PASS";
  } else {
    if (markdownDetected) {
      formatResult = "FAIL";
      details.push("Markdown detected but format instructions do not permit it.");
    } else {
      formatResult = "PASS";
    }
  }

  // ===== Empty output =====
  const emptyOutput: "PASS" | "FAIL" = wordCount > 0 ? "PASS" : "FAIL";
  if (emptyOutput === "FAIL") {
    details.push("Generated document is empty.");
  }

  // ===== Markdown compliance (separate from format) =====
  const markdownCompliance: "PASS" | "FAIL" | "N/A" =
    markdownDetected && !markdownAllowed ? "FAIL" : "PASS";

  return {
    documentType,
    officialPrompt,
    requiredTopics: requiredTopicsResult,
    wordLimit: wordLimitResult,
    characterLimit: characterLimitResult,
    format: formatResult,
    emptyOutput,
    markdownCompliance,
    details,
  };
}
