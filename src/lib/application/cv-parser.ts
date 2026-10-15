// ============================================================
// CV PARSER SERVICE - ARCHITECTURAL REWRITE
// ============================================================
// Single canonical pipeline:
//
// FILE
// → extraction (router: pdf-parse / mammoth / docling / OCR)
// → ordered blocks with page/bbox metadata
// → header/footer deduplication
// → generic section segmentation (isHeadingLike + classifyHeading)
// → canonical section list with hard boundaries
// → section-specific parsing (receives ONLY section.blocks)
// → normalization
// → entity reconciliation
// → canonical CV object
// ============================================================

import { extractCanonicalBlocks, CanonicalBlock, CanonicalExtractedDocument } from "./cv-extraction";

// ============================================================
// DETERMINISTIC FAILURE CLASSIFICATION
// ============================================================

export type CVParseFailureCode =
  | "IMAGE_ONLY_PDF"
  | "CORRUPT_OR_UNREADABLE_PDF"
  | "INSUFFICIENT_TEXT"
  | "CV_FILE_INVALID"
  | "CV_EXTRACTION_EMPTY"
  | "CV_EXTRACTION_FAILED"
  | "CV_OCR_EXTRACTION_FAILED"
  | "CV_OCR_LIMIT_EXCEEDED"
  | "CV_PARSE_EMPTY_STRUCTURE"
  | "PARSE_FAILED";

export interface CVParseFailure extends Error {
  code: CVParseFailureCode;
  userMessage: string;
  /** Content-free diagnostics — never log resume text. */
  diagnostics?: Record<string, string | number>;
}

const FAILURE_MESSAGES: Record<CVParseFailureCode, string> = {
  IMAGE_ONLY_PDF:
    "This CV appears to be a scanned or image-based PDF. Please upload a searchable PDF or DOCX.",
  INSUFFICIENT_TEXT:
    "We could read this file, but there isn't enough CV text to import reliably. Please upload a more complete PDF/DOCX or enter the details manually.",
  CORRUPT_OR_UNREADABLE_PDF:
    "This file could not be read as a valid PDF. It may be corrupted. Please try a different file.",
  CV_FILE_INVALID:
    "This file could not be read as a valid document. It may be corrupted or in an unsupported format. Please try a different PDF or DOCX.",
  CV_EXTRACTION_EMPTY:
    "This CV could be opened, but no readable text was found inside it. If it is a scan or image-based file, please upload a text-based PDF or DOCX.",
  CV_EXTRACTION_FAILED:
    "The document could not be extracted. Please try a different PDF or DOCX, or enter the details manually.",
  CV_OCR_EXTRACTION_FAILED:
    "This CV appears to contain only images or scans, and our text recovery could not read it. Please upload a clearer scanned copy, a text-based PDF/DOCX, or enter the details manually.",
  CV_OCR_LIMIT_EXCEEDED:
    "This file is too large or complex for text recovery from images. Please upload a smaller file or a text-based PDF/DOCX.",
  CV_PARSE_EMPTY_STRUCTURE:
    "We read the text in this CV but could not identify resume sections (education, experience, skills). Please upload a standard-layout PDF/DOCX or enter the details manually.",
  PARSE_FAILED:
    "We could not process this file. Please try a different PDF or DOCX, or enter the details manually.",
};

export function createCVParseFailure(code: CVParseFailureCode, detail?: string, diagnostics?: Record<string, string | number>): CVParseFailure {
  const err = new Error(detail || FAILURE_MESSAGES[code]) as CVParseFailure;
  err.code = code;
  err.userMessage = FAILURE_MESSAGES[code];
  err.diagnostics = diagnostics;
  return err;
}

/**
 * Map internal parser/service error codes to stable user-facing codes.
 */
export function normalizeCVErrorCode(code: string, message?: string): string {
  switch (code) {
    case "DOCLING_UNREADABLE":
      return /no readable text/i.test(message || "") ? "CV_EXTRACTION_EMPTY" : "CV_EXTRACTION_FAILED";
    case "DOCLING_TIMEOUT":
    case "DOCLING_UNREACHABLE":
    case "DOCLING_BAD_RESPONSE":
    case "DOCLING_SERVICE_ERROR":
      return "CV_EXTRACTION_FAILED";
    case "OCR_TIMEOUT":
    case "OCR_UNREACHABLE":
    case "OCR_SERVICE_ERROR":
    case "OCR_BAD_RESPONSE":
    case "OCR_UNREADABLE":
    case "OCR_NO_IMAGE_CONTENT":
      return "CV_OCR_EXTRACTION_FAILED";
    case "OCR_LIMIT_EXCEEDED":
      return "CV_OCR_LIMIT_EXCEEDED";
    case "CV_FILE_INVALID":
    case "CV_EXTRACTION_EMPTY":
    case "CV_EXTRACTION_FAILED":
    case "CV_OCR_EXTRACTION_FAILED":
    case "CV_OCR_LIMIT_EXCEEDED":
    case "CV_PARSE_EMPTY_STRUCTURE":
      return code;
    default:
      return code;
  }
}

/** Minimum text length (chars) for reliable CV parsing */
const MIN_CV_TEXT_LENGTH = 50;
/** Threshold below which text is considered "near-empty" (image-only PDF) */
const NEAR_EMPTY_TEXT_LENGTH = 10;

// ============================================================
// CANONICAL TYPES
// ============================================================

export interface ParsedCV {
  personalData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    currentCity?: string;
    currentCountry?: string;
    /** Explicit "Nationality:"/"Citizenship:" label only — never inferred. */
    nationality?: string;
    linkedin?: string;
    github?: string;
  };
  education: ParsedEducation[];
  experience: ParsedExperience[];
  projects: ParsedProject[];
  skills: {
    technical: string[];
    programming: string[];
    tools: string[];
    software: string[];
    domain: string[];
    soft: string[];
  };
  /** Explicit "CERTIFICATIONS"/"LICENSES" section lines only. */
  certifications: string[];
  achievements: string[];
  rawTextLength: number;
  parseWarnings: string[];
  /** Parser provenance — present on docling-path results. Never
   * persisted to canonical profile (cv-apply maps fields explicitly). */
  parserMeta?: {
    engine: "legacy" | "docling" | "rapidocr" | "pdf-parse" | "mammoth";
    mapperVersion?: string;
    doclingVersion?: string;
    sourceHash?: string;
    ocrUsed?: boolean;
    durationMs?: number;
    parsedAt?: string;
  };
}

/** Field-level confidence + source — review UI hints, not persisted. */
export interface ParsedFieldMeta {
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  source?: { text: string; page?: number | null };
  /** Raw source text snippet that produced this record — shown in review UI. */
  sourceEvidence?: string;
}

export interface ParsedEducation extends ParsedFieldMeta {
  id: string;
  institution: string;
  degree: string;
  specialization: string;
  startYear: string;
  endYear: string;
  cgpa: string;
  cgpaScale: string;
}

export interface ParsedExperience extends ParsedFieldMeta {
  id: string;
  type: string;
  organization: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  currentlyWorking: boolean;
  responsibilities: string;
}

export interface ParsedProject extends ParsedFieldMeta {
  id: string;
  name: string;
  type: string;
  description: string;
  technologies: string;
  role: string;
}

// ============================================================
// EXTRACTION BLOCKS (with layout metadata)
// ============================================================

export interface TextBlock {
  text: string;
  page?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  fontSize?: number;
  isBold?: boolean;
  isItalic?: boolean;
  fontName?: string;
  blockType?: "paragraph" | "heading" | "table" | "list" | "list_item" | "header" | "footer" | "PARAGRAPH" | "HEADING" | "TABLE" | "LIST_ITEM" | "HEADER" | "FOOTER" | "TABLE_ROW" | "TABLE_CELL" | "TEXTBOX" | "OCR_BLOCK";
  order?: number;
  row?: number | null;
  column?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDocument {
  blocks: TextBlock[];
  fullText: string;
  pageCount: number;
  extractor: "legacy" | "native" | "docling" | "rapidocr" | "pdf-parse" | "mammoth" | "mammoth_html" | "ocr" | "mixed" | "txt" | "unstructured";
  ocrUsed: boolean;
  warnings: string[];
}

// ============================================================
// SECTION SEGMENTATION TYPES
// ============================================================

export type CanonicalSectionType =
  | "EDUCATION"
  | "EXPERIENCE"
  | "PROJECTS"
  | "SKILLS"
  | "CERTIFICATIONS"
  | "ACHIEVEMENTS"
  | "PERSONAL"
  | "SUMMARY"
  | "UNKNOWN_SECTION";

export interface Section {
  type: CanonicalSectionType;
  heading: string | null;  // The detected heading text, null for implicit first section
  headingBlockIndex: number | null;  // Index in blocks array
  startBlockIndex: number;  // Inclusive
  endBlockIndex: number;    // Exclusive
  blocks: TextBlock[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Generic heading detection - structural rules, not keyword dictionary
 * Step A: isHeadingLike(block) - does this look like a heading?
 * Step B: classifyHeading(block) - what canonical type?
 */
export interface HeadingDetectionResult {
  headingLike: boolean;
  canonicalType: CanonicalSectionType;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  rawHeadingText: string;
}

// ============================================================
// TEXT EXTRACTION (router)
// ============================================================



/**
 * Extract text from a DOCX buffer using mammoth.
 * Returns blocks with basic structure.
 */
export async function extractTextFromDOCX(buffer: Buffer): Promise<ExtractedDocument> {
  const { extractDocxTextBounded } = await import("./docx-validator");
  const text = await extractDocxTextBounded(buffer);

  const lines = text.split("\n").map((line: string, idx: number) => ({
    text: line,
    page: 1, // mammoth doesn't give page info easily
    blockType: "paragraph" as const,
  }));

  return {
    blocks: lines,
    fullText: text,
    pageCount: 1,
    extractor: "mammoth",
    ocrUsed: false,
    warnings: [],
  };
}

/**
 * Extract text from a file buffer based on file type.
 * Router selects extractor.
 */
export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
  const ext = filename.toLowerCase().split(".").pop();
if (ext === "pdf") {
     const text = await extractTextFromPDF(buffer);
     const lines = text.split("\n").map((line: string, idx: number) => ({
       text: line,
       page: 1,
       blockType: "paragraph" as const,
     }));
     return {
       blocks: lines,
       fullText: text,
       pageCount: 1,
       extractor: "pdf-parse",
       ocrUsed: false,
       warnings: [],
     };
   } else if (ext === "docx") {
     return extractTextFromDOCX(buffer);
   } else if (ext === "txt") {
     const text = buffer.toString("utf-8");
     const lines = text.split("\n").map((line: string, idx: number) => ({
       text: line,
       page: 1,
       blockType: "paragraph" as const,
     }));
     return {
       blocks: lines,
       fullText: text,
       pageCount: 1,
       extractor: "txt",
       ocrUsed: false,
       warnings: [],
     };
   }
  throw new Error(`Unsupported file type: .${ext}. Supported: PDF, DOCX, TXT.`);
}

// ============================================================
// HEADER/FOOTER DEDUPLICATION
// ============================================================

/**
 * Detect and remove repeated header/footer blocks across pages.
 * Uses normalized text + page position + repetition count.
 */
export function deduplicateHeadersFooters(doc: ExtractedDocument): ExtractedDocument {
  if (doc.blocks.length === 0) return doc;

  // Group blocks by normalized text (first 80 chars, lowercase, no whitespace)
  const textGroups = new Map<string, TextBlock[]>();
  for (const block of doc.blocks) {
    const normalized = block.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (normalized.length < 10) continue; // too short to be header/footer
    if (!textGroups.has(normalized)) textGroups.set(normalized, []);
    textGroups.get(normalized)!.push(block);
  }

  // Find candidates repeated on multiple pages at similar positions
  const toRemove = new Set<TextBlock>();
  // Convert Map entries to array for iteration (ES5 compatible)
  const textGroupsEntries = Array.from(textGroups.entries());
  for (let i = 0; i < textGroupsEntries.length; i++) {
    const [, blocks] = textGroupsEntries[i];
    if (blocks.length < 2) continue;

    // Check if they appear on different pages at top/bottom
    const pages = new Set();
    for (const block of blocks) {
      if (block.page !== undefined) {
        pages.add(block.page);
      }
    }
    if (pages.size < 2) continue; // not repeated across pages

    // Additional filter: only consider text that looks like a heading for header/footer removal
    // This prevents removing common words that appear in document body (like "experience" in job descriptions)
    const firstBlock = blocks[0];
    if (!isHeadingLike(firstBlock)) continue;

    // Check if consistently at top (first 3 blocks of page) or bottom (last 3 blocks)
    const isHeader = blocks.every(b => {
      const pageBlocks = doc.blocks.filter(x => x.page === b.page);
      const idx = pageBlocks.indexOf(b);
      return idx >= 0 && idx < 3;
    });
    const isFooter = blocks.every(b => {
      const pageBlocks = doc.blocks.filter(x => x.page === b.page);
      const idx = pageBlocks.indexOf(b);
      return idx >= 0 && idx >= pageBlocks.length - 3;
    });

    if (isHeader || isFooter) {
      // Mark all but first occurrence for removal
      for (let j = 1; j < blocks.length; j++) {
        toRemove.add(blocks[j]);
      }
    }
  }

  if (toRemove.size === 0) return doc;

  const filteredBlocks = doc.blocks.filter(b => !toRemove.has(b));
  return {
    ...doc,
    blocks: filteredBlocks,
    fullText: filteredBlocks.map(b => b.text).join("\n"),
    warnings: [...doc.warnings, `Removed ${toRemove.size} repeated header/footer blocks`],
  };
}

// ============================================================
// GENERIC HEADING DETECTION (Step A + Step B)
// ============================================================

const KNOWN_HEADINGS: Record<CanonicalSectionType, string[]> = {
  EDUCATION: ["education", "academic background", "qualifications", "scholastic record", "academic qualifications", "educational background", "education & credentials"],
  EXPERIENCE: ["experience", "employment", "work history", "professional experience", "career history", "career journey", "work experience", "employment history", "work", "professional history", "career experience", "professional career", "academic appointments", "teaching experience", "research experience"],
  PROJECTS: ["projects", "personal projects", "academic projects", "key projects", "project experience", "proof of work", "portfolio", "selected projects", "key projects", "major projects", "project highlights", "initiatives", "selected initiatives", "key initiatives", "major initiatives", "project portfolio"],
  SKILLS: ["skills", "technical skills", "core competencies", "technologies", "tech stack", "expertise", "competencies", "core capabilities"],
  CERTIFICATIONS: ["certifications", "certificates", "licenses", "certified courses", "professional certifications", "credentials", "licences"],
  ACHIEVEMENTS: ["achievements", "awards", "honors", "honours", "accomplishments", "recognitions", "awards and honors", "grants & awards", "grants and awards"],
  PERSONAL: ["personal information", "personal details", "contact", "contact information"],
  SUMMARY: ["summary", "objective", "profile", "professional summary", "career objective", "about me", "executive profile", "career overview", "professional summary"],
  UNKNOWN_SECTION: [], // Never matched directly
};

// Set of known heading keywords (lowercase, no colon) for quick lookup in heading detection
const KNOWN_HEADING_KEYWORDS_SET = new Set<string>([
  "education", "experience", "projects", "skills", "certifications", "achievements",
  "academic background", "qualifications", "scholastic record", "academic qualifications", "educational background", "education & credentials",
  "employment", "work history", "professional experience", "career history", "career journey", "work experience", "employment history", "work", "professional history", "career experience", "professional career", "academic appointments", "teaching experience", "research experience",
  "personal projects", "academic projects", "key projects", "project experience", "proof of work", "portfolio",
  "selected projects", "key projects", "major projects", "project highlights",
  "initiatives", "selected initiatives", "key initiatives", "major initiatives", "project portfolio",
  "technical skills", "core competencies", "technologies", "tech stack", "expertise", "competencies", "core capabilities",
  "certificates", "licenses", "certified courses", "professional certifications", "credentials", "licences",
  "awards", "honors", "honours", "accomplishments", "recognitions", "awards and honors", "grants & awards", "grants and awards",
  "personal information", "personal details", "contact", "contact information",
  "summary", "objective", "profile", "professional summary", "career objective", "about me", "executive profile", "career overview"
]);

/**
 * Step A: Generic structural heading detection
 * Uses visual/layout cues, NOT keyword matching
 */
function isHeadingLike(block: TextBlock): boolean {
  const text = block.text.trim();
  if (text.length === 0 || text.length > 120) return false; // too long

  // Skip obvious non-headings
  if (text.match(/^[•\-*▪◦·]\s/)) return false; // bullet point
  if (text.match(/^\d+\.\s/)) return false; // numbered list item
  if (text.includes("@")) return false; // email
  if (text.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/)) return false; // phone
  if (text.split(" ").length > 12) return false; // too many words (sentence)
  
  // Skip date ranges (e.g., "Apr 2024 - Present | Pune", "2022 - Present", "2019 - 2022 | Hyderabad")
  if (text.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–]\s*(?:Present|Current|Ongoing|\d{4})/i)) return false;
  if (text.match(/^\d{4}\s*[-–]\s*(?:Present|Current|Ongoing|\d{4})/i)) return false;
  if (text.match(/^\d{4}\s*[-–]\s*\d{4}\s*[\|,]/)) return false;
  
  // Skip table header rows (e.g., "Company / Role", "Dates", "Location", "Selected Impact")
  if (text.match(/^(?:Company|Role|Dates|Location|Impact|Qualification|Institution|Year|Result|Selected|Grade|Marks|Score|Passing|Board|Standard|Degree|Course|Program|Duration|Period|Status|Percentage|SGPA|CPI)\s*[\/\|]/i)) return false;
  if (text.match(/^(?:Company|Role|Dates|Location|Impact|Qualification|Institution|Year|Result|Selected|Grade|Marks|Score|Passing|Board|Standard|Degree|Course|Program|Duration|Period|Status|Percentage|SGPA|CPI)$/i)) return false;
  // Skip table cells that are clearly column headers (short, title-case, common table terms)
  // Only apply when block is inside a table — standalone section headings like "Project Portfolio" must pass
  if (block.metadata?.tableId && text.match(/^(?:Name|Title|Description|Organization|Project|Technology|Skills|Tools|Software|Domain|Soft|Certification|Achievement|Award|Honor|License|Activity|Subject|Stream|Division|Section|Semester|Session|Class|Roll|Number|Sr\.?\s*No|Serial|No\.|S\.?No|Ref|ID|Code)\b/i)) return false;
  
  // Skip lines that look like bullet points or list items even without special chars
  if (text.match(/^[-*]\s+/)) return false;
  
  // Skip lines that are clearly content (longer sentences, multiple clauses)
  if (text.split(/[,;]/).length > 2) return false;
  
  // Skip lines with too many consecutive capitalized words (likely proper nouns in content)
  const capWords = text.match(/[A-Z][a-z]+/g) || [];
  if (capWords.length > 3) return false;
  
   // Skip location entries (city names that appear in experience/education entries)
   // These are often single words like "Hyderabad", "Chennai", "Bengaluru", "Pune", "Mumbai"
   // We can check if it's a single capitalized word that's a common location
   const singleWord = text.split(/\s+/).filter(w => w.length > 0);
   if (singleWord.length === 1) {
     const commonLocations = ["hyderabad", "chennai", "bengaluru", "bangalore", "pune", "mumbai", "delhi", "kolkata", "ahmedabad", "surat", "jaipur", "kochi", "kozhikode", "thiruvananthapuram", "london", "uk", "india", "usa", "us", "america", "canada", "australia", "singapore", "dubai", "shanghai", "tokyo", "seoul"];
     if (commonLocations.includes(singleWord[0].toLowerCase())) return false;
   }
   
   // Skip lines that look like "text - YEAR" patterns (likely certification or project lines, not section headings)
   if (text.match(/^.+\s+[-–]\s+\d{4}$/)) return false;
  
  // Skip lines that look like certification records (e.g., "IAAP CPACC - 2024", "AWS Certified - 2023")
  // These are often all-caps or title-case with a date at the end
  if (text.match(/^[A-Z][A-Za-z0-9\s&.]+?\s+[-–]\s*(?:20|19)\d{2}$/)) return false;
  if (text.match(/^[A-Z][A-Za-z0-9\s&.]+?\s+(?:certif|certification|credential|license|accreditation|certified)\b/i)) return false;

  // Skip score/grade key-value lines (e.g., "CGPA: 7.8", "Percentage: 85%") — these are content, not headings
  if (text.match(/^[A-Za-z][A-Za-z\s]*[:=]\s*\d/)) return false;

  // Positive signals
  let score = 0;

  // ALL CAPS (at least 3 chars, mostly letters) - strong signal
  if (text === text.toUpperCase() && text.length >= 3 && /[A-Z]/.test(text)) score += 3;

  // Title Case (each word capitalized, 2-4 words) - medium signal
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length >= 1 && words.length <= 4) {
    const titleCase = words.every(w => w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase());
    if (titleCase) score += 2;
  }

  // Ends with colon - strong signal
  if (text.endsWith(":")) score += 3;

  // Numbered heading (1., 1.1, I., A., etc.) - medium signal
  if (text.match(/^(\d+(\.\d+)*|[IVX]+|[A-Z])\.\s/)) score += 2;

  // Bold/style metadata if available
  if (block.isBold) score += 2;
  if (block.fontSize && block.fontSize > 12) score += 1;

  // Whitespace isolation: very short blocks are more likely to be headings
  if (text.length < 30) score += 1;

  // Not sentence-like (no period at end, unless it's abbreviation like "Inc." or "etc.")
  if (!text.endsWith(".") || text.match(/\b(Inc|etc|vs|jr|sr)\.?$/i)) score += 1;

  return score >= 5; // Raised threshold significantly to be more conservative
}

/**
 * Step B: Classify heading to canonical type
 * Uses keyword matching ONLY for classification, not for boundary detection
 */
function classifyHeading(block: TextBlock): HeadingDetectionResult {
  const text = block.text.trim();
  const rawHeadingText = text;
  const lowerText = text.toLowerCase();

  // Try known headings - exact or prefix match
  for (const [type, keywords] of Object.entries(KNOWN_HEADINGS)) {
    for (const kw of keywords) {
      if (lowerText === kw || lowerText.startsWith(kw + ":") || lowerText.startsWith(kw + " ")) {
        return {
          headingLike: true,
          canonicalType: type as CanonicalSectionType,
          confidence: "HIGH",
          rawHeadingText,
        };
      }
    }
  }

  // Fuzzy match: if the heading text contains a known keyword and is short
  const words = lowerText.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 5) {
    // Convert Set to array for iteration (ES5 compatible)
    const knownKeywords = Array.from(KNOWN_HEADING_KEYWORDS_SET);
    for (let i = 0; i < knownKeywords.length; i++) {
      const kw = knownKeywords[i];
      if (lowerText.includes(kw)) {
        // Find which canonical type this keyword belongs to
        for (const [type, keywords] of Object.entries(KNOWN_HEADINGS)) {
          if (keywords.includes(kw)) {
            return {
              headingLike: true,
              canonicalType: type as CanonicalSectionType,
              confidence: "MEDIUM",
              rawHeadingText,
            };
          }
        }
      }
    }
  }

  // Unknown but heading-like - still creates a boundary!
  return {
    headingLike: true,
    canonicalType: "UNKNOWN_SECTION",
    confidence: "LOW",
    rawHeadingText,
  };
}

/**
 * Canonical section segmentation - SINGLE SOURCE OF TRUTH for boundaries
 * 
 * Invariant: ANY confidently detected top-level heading (including UNKNOWN_SECTION)
 * terminates the previous section.
 */
export function segmentResumeSections(blocks: TextBlock[]): Section[] {
  if (blocks.length === 0) return [];

  const sections: Section[] = [];
  let currentSectionType: CanonicalSectionType = "PERSONAL"; // Implicit first section
  let currentSectionStart = 0;
  let currentSectionHeading: string | null = null;
  let currentSectionHeadingBlockIndex: number | null = null;

  // First, detect ALL heading-like blocks - these are potential section boundaries
  const headingBlocks: Array<{ 
    index: number; 
    result: HeadingDetectionResult;
    isConfident: boolean;
  }> = [];
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (isHeadingLike(block)) {
      const result = classifyHeading(block);
      if (result.headingLike) {
        // A heading is "confident" if it's not just structural but has some semantic meaning
        // Even UNKNOWN_SECTION headings are confident boundaries
        const isConfident = result.confidence !== "LOW" || result.canonicalType === "UNKNOWN_SECTION";
        headingBlocks.push({ index: i, result, isConfident });
      }
    }
  }

  // Build sections - EVERY heading block (confident or not) terminates previous section
  for (const headingBlock of headingBlocks) {
    const { index, result } = headingBlock;

    // Close previous section - EVERY heading block creates a boundary
    if (sections.length > 0 || currentSectionStart < index) {
      const prevSectionBlocks = blocks.slice(currentSectionStart, index);
      if (prevSectionBlocks.length > 0 || sections.length === 0) {
        sections.push({
          type: currentSectionType,
          heading: currentSectionHeading,
          headingBlockIndex: currentSectionHeadingBlockIndex,
          startBlockIndex: currentSectionStart,
          endBlockIndex: index,
          blocks: prevSectionBlocks,
          confidence: "HIGH",
        });
      }
    }

    // Start new section AFTER this heading
    currentSectionType = result.canonicalType;
    currentSectionStart = index + 1; // Content starts after heading
    currentSectionHeading = result.rawHeadingText;
    currentSectionHeadingBlockIndex = index;
  }

  // Close final section
  if (currentSectionStart < blocks.length) {
    const finalBlocks = blocks.slice(currentSectionStart);
    if (finalBlocks.length > 0 || sections.length === 0) {
      sections.push({
        type: currentSectionType,
        heading: currentSectionHeading,
        headingBlockIndex: currentSectionHeadingBlockIndex,
        startBlockIndex: currentSectionStart,
        endBlockIndex: blocks.length,
        blocks: finalBlocks,
        confidence: "HIGH",
      });
    }
  }

  // If no sections found at all, try synthetic section recovery from table-heavy documents.
  // DOCX files with tables but no Word heading styles often have section keywords
  // (e.g., "EDUCATION", "EXPERIENCE") inside table cells that isHeadingLike rejects
  // because they share cells with data rows or are formatted as table headers.
  if (sections.length === 0 || (sections.length === 1 && sections[0].type === "UNKNOWN_SECTION")) {
    const synthetic = recoverSectionsFromKeywords(blocks);
    if (synthetic.length > 1) {
      return synthetic;
    }
  }

  // If no sections found at all, treat entire document as one UNKNOWN section
  if (sections.length === 0) {
    sections.push({
      type: "UNKNOWN_SECTION",
      heading: null,
      headingBlockIndex: null,
      startBlockIndex: 0,
      endBlockIndex: blocks.length,
      blocks: blocks,
      confidence: "LOW",
    });
  }

  return sections;
}

/**
 * Fallback section recovery for documents without detectable heading styles.
 * Scans blocks for known section keywords and creates synthetic boundaries.
 * Only used when normal heading detection fails completely.
 */
function recoverSectionsFromKeywords(blocks: TextBlock[]): Section[] {
  const boundaries: Array<{ index: number; type: CanonicalSectionType; heading: string }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i].text.trim();
    const lower = text.toLowerCase().replace(/[:\s]+$/, "");
    // Require exact or near-exact match to avoid false positives in prose
    for (const [type, keywords] of Object.entries(KNOWN_HEADINGS)) {
      if (type === "UNKNOWN_SECTION" || type === "PERSONAL") continue;
      for (const kw of keywords) {
        if (lower === kw || lower === kw + ":" || lower.startsWith(kw + " ")) {
          // Reject if this block has tableId and looks like a column header
          if (blocks[i].metadata?.tableId) {
            const cellText = text.replace(/[:\s]+$/, "");
            if (/^(qualification|institution|year|result|grade|marks|score|degree|course|program|duration|period|status|percentage|sgpa|cpi)$/i.test(cellText)) {
              continue;
            }
          }
          // Must be reasonably short to be a section heading
          if (text.length <= 40) {
            boundaries.push({ index: i, type: type as CanonicalSectionType, heading: text });
          }
        }
      }
    }
  }

  if (boundaries.length === 0) return [];

  // Deduplicate: if same index matches multiple types, prefer the longer keyword match
  const byIndex = new Map<number, { type: CanonicalSectionType; heading: string }>();
  for (const b of boundaries) {
    const existing = byIndex.get(b.index);
    if (!existing || existing.heading.length < b.heading.length) {
      byIndex.set(b.index, { type: b.type, heading: b.heading });
    }
  }
  const sorted = Array.from(byIndex.entries()).sort((a, b) => a[0] - b[0]);

  const result: Section[] = [];
  let currentStart = 0;
  let currentType: CanonicalSectionType = "PERSONAL";
  let currentHeading: string | null = null;

  for (const [index, { type, heading }] of sorted) {
    if (index > currentStart) {
      result.push({
        type: currentType,
        heading: currentHeading,
        headingBlockIndex: null,
        startBlockIndex: currentStart,
        endBlockIndex: index,
        blocks: blocks.slice(currentStart, index),
        confidence: "MEDIUM",
      });
    }
    currentStart = index + 1;
    currentType = type;
    currentHeading = heading;
  }

  // Final section
  if (currentStart < blocks.length) {
    result.push({
      type: currentType,
      heading: currentHeading,
      headingBlockIndex: null,
      startBlockIndex: currentStart,
      endBlockIndex: blocks.length,
      blocks: blocks.slice(currentStart),
      confidence: "MEDIUM",
    });
  }

  return result;
}

// ============================================================
// SECTION-SPECIFIC PARSERS (receive ONLY section.blocks)
// ============================================================

const COMMON_SKILLS: Record<string, string[]> = {
  programming: [
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Rust",
    "Ruby", "PHP", "Swift", "Kotlin", "Scala", "R", "MATLAB", "SQL", "HTML", "CSS",
    "Bash", "Shell", "Perl", "Dart", "Lua", "Julia",
  ],
  technical: [
    "Machine Learning", "Deep Learning", "Data Analysis", "Data Science",
    "Artificial Intelligence", "NLP", "Natural Language Processing",
    "Computer Vision", "Image Processing", "Signal Processing",
    "Cloud Computing", "Distributed Systems", "Microservices",
    "DevOps", "CI/CD", "Containerization", "Virtualization",
    "Cybersecurity", "Cryptography", "Blockchain",
    "Web Development", "Mobile Development", "Game Development",
    "UI/UX", "Design Thinking", "Agile", "Scrum",
    "Statistical Analysis", "Quantitative Analysis", "Qualitative Analysis",
    "Research", "Algorithm Design", "Data Structures",
    "TensorFlow", "PyTorch", "Keras", "Scikit-learn", "Pandas", "NumPy",
    "React", "Angular", "Vue", "Node.js", "Express", "Django", "Flask",
    "Spring", "Hibernate", ".NET", "Android", "iOS",
  ],
  tools: [
    "Git", "GitHub", "GitLab", "Bitbucket", "JIRA", "Confluence",
    "Docker", "Kubernetes", "Jenkins", "CircleCI", "Travis CI",
    "AWS", "Azure", "GCP", "Heroku", "Vercel",
    "VS Code", "IntelliJ", "Eclipse", "Vim",
    "MySQL", "PostgreSQL", "MongoDB", "Redis", "Elasticsearch",
    "Kafka", "RabbitMQ", "Nginx", "Apache",
  ],
  software: [
    "Tableau", "Power BI", "Excel", "Google Analytics",
    "Figma", "Sketch", "Adobe XD", "Photoshop", "Illustrator",
    "Jupyter", "RStudio", "SPSS", "Stata", "SAS",
    "AutoCAD", "SolidWorks", "MATLAB", "Simulink",
  ],
  domain: [
    "Finance", "Healthcare", "Education", "E-commerce", "Marketing",
    "Supply Chain", "Manufacturing", "Automotive", "Aerospace",
    "Energy", "Telecommunications", "Real Estate", "Insurance",
    "Banking", "Investment", "Consulting", "Audit", "Tax",
    "Civil Engineering", "Mechanical Engineering", "Electrical Engineering",
    "Chemical Engineering", "Biotechnology", "Pharmaceutical",
  ],
  soft: [
    "Leadership", "Communication", "Teamwork", "Problem Solving",
    "Critical Thinking", "Time Management", "Project Management",
    "Presentation", "Public Speaking", "Writing", "Negotiation",
    "Mentoring", "Collaboration", "Adaptability", "Creativity",
    "Decision Making", "Strategic Planning", "Conflict Resolution",
  ],
};

export function generateId(): string {
  return `cv-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

// ============================================================
// STRUCTURAL RECORD GROUPING (source-aware boundary detection)
// ============================================================

export interface SourceRecordGroup {
  blocks: TextBlock[];
  sourceEvidence: string;
}

/** If a block contains an embedded job header after a continuation prefix, split it. */
function splitEmbeddedExperienceBlock(block: TextBlock): TextBlock[] {
  if (block.blockType === "HEADING" || block.blockType === "heading") return [block];
  const text = block.text.trim();
  // Match a sentence boundary followed by Title - Company
  const embeddedMatch = text.match(/(?:\.\s+|\n\s*)([A-Z][A-Za-z\s]*(?:Manager|Analyst|Engineer|Developer|Director|VP|Head|Chief|Intern|Consultant|Specialist|Officer|President|Lead|Architect|Coordinator|Associate|Assistant|Executive|Strategist|Planner|Designer|Writer|Editor|Scientist|Fellow|Researcher|Trainee|Representative)[^•\n]*?[-–—]\s*[A-Z][A-Za-z0-9\s&.,]+)/);
  if (!embeddedMatch) return [block];
  const splitIndex = text.indexOf(embeddedMatch[1]);
  if (splitIndex <= 0) return [block];
  const beforeText = text.slice(0, splitIndex).trim();
  const afterText = text.slice(splitIndex).trim();
  if (beforeText.length < 5 || afterText.length < 10) return [block];
  return [
    { ...block, text: beforeText },
    { ...block, text: afterText },
  ];
}

/** Returns true if a block is clearly a continuation (bullet, description, detail). */
function isContinuationBlock(block: TextBlock): boolean {
  const text = block.text.trim();
  if (!text) return true;
  // Bullet points and list items are always continuations
  if (text.startsWith("•") || text.startsWith("-") || text.startsWith("*") || text.startsWith("·")) return true;
  if (block.blockType === "LIST_ITEM" || block.blockType === "list_item" || block.blockType === "list") return true;
  // Short header-like lines that are part of a record (e.g. "Pune, India" as location)
  if (/^(?:CGPA|GPA|Percentage|Marks|Score|Grade|Result|Passing|Year|Duration|Status|Board|Standard|Subject|Stream|Division|Semester|Session|Roll|Number)\b/i.test(text)) return true;
  // "Class" alone is a continuation (e.g. "Classroom management"), but "Class X" / "Class XII" are degree entries
  if (/^Class\s+(?:X|XII|10|12)\b/i.test(text)) return false;
  if (/^Class\b/i.test(text)) return true;
  // Numeric score lines (e.g. "8.5/10", "84.2%")
  if (/^\d+\.?\d*\s*(?:\/|%)/.test(text)) return true;
  // Long descriptive paragraphs (>120 chars, no date at start) are continuations
  if (text.length > 120 && !/^\d{4}\s*[-–]/.test(text) && !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text)) return true;
  return false;
}

/** Group education section blocks into distinct record groups using block boundaries. */
export function groupEducationRecords(section: Section): SourceRecordGroup[] {
  const groups: SourceRecordGroup[] = [];
  for (const block of section.blocks) {
    const text = block.text.trim();
    if (!text) continue;

    // A new education record boundary is detected when:
    // 1. Block starts with a degree keyword (inclusive list of standard degrees)
    // 2. Block contains an institution + year pattern
    const hasDegreePattern = /^(?:B\.?Tech\.?|B\.?E\.?|Bachelor(?:\s+of)?|M\.?Tech\.?|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master(?:\s+of)?|Ph\.?D\.?|Doctorate|Diploma|MBA|Executive\s+MBA|B\.?Sc\.?|B\.?Com\.?|B\.?S\.?|Class\s+X|Class\s+XII|10th|12th|Senior\s+Secondary|SSLC|SSC|PG\s+Diploma)\b/i.test(text);
    const hasInstitutionAndYear = /\b(?:University|Institute|College|School|Polytechnic|IIT|NIT|BITS|VIT|MIT|Stanford|Harvard|Oxford|Cambridge)\b.*(?:20|19)\d{4}/i.test(text);

    const isNewRecord = hasDegreePattern || hasInstitutionAndYear;
    const isCont = isContinuationBlock(block);

    // If a block matches a degree/institution pattern, it ALWAYS starts a new record,
    // even if it also looks like a continuation. The new-record signal takes precedence.
    if (groups.length === 0 || isNewRecord) {
      groups.push({ blocks: [block], sourceEvidence: text });
    } else if (!isCont) {
      // Not a new record and not a continuation — still start a new group
      // (avoids merging unrelated blocks when no clear continuation signal exists)
      groups.push({ blocks: [block], sourceEvidence: text });
    } else {
      const last = groups[groups.length - 1];
      last.blocks.push(block);
      last.sourceEvidence += "\n" + text;
    }
  }
  return groups;
}

/** Extract education fields from a single source group using delimiter-aware patterns. */
function extractEducationFields(group: SourceRecordGroup): Partial<ParsedEducation> & { _sourceLines?: string[] } {
  const text = group.sourceEvidence;
  const result: Partial<ParsedEducation> & { _sourceLines?: string[] } = { _sourceLines: [text] };

  // Expanded degree keywords covering standard qualifications
  const degreePattern = /^(?:B\.?Tech\.?|B\.?E\.?|Bachelor(?:\s+of)?|M\.?Tech\.?|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master(?:\s+of)?|Ph\.?D\.?|Doctorate|Diploma|MBA|Executive\s+MBA|B\.?Sc\.?|B\.?Com\.?|B\.?S\.?|Class\s+X|Class\s+XII|10th|12th|Senior\s+Secondary|SSLC|SSC|PG\s+Diploma)\b/i;

  // Extract degree from the start of the text
  const degreeMatch = text.match(degreePattern);
  if (degreeMatch) {
    result.degree = degreeMatch[0].trim();
  }

  // Extract specialization: "Degree, Field - ..." or "Degree in/of Field - ..."
  const specMatch = text.match(/^(?:B\.?Tech\.?|B\.?E\.?|Bachelor|M\.?Tech|M\.?E\.?|M\.?S|M\.?Sc|Master|Ph\.?D|Doctorate|Diploma|MBA|Executive\s+MBA|B\.?Sc|B\.?Com|B\.?S|Class\s+X|Class\s+XII|10th|12th|Senior\s+Secondary|SSLC|SSC|PG\s+Diploma)[,\s]+(?:in\s+|of\s+)?([^-–|]+)/i);
  if (specMatch) {
    result.specialization = specMatch[1].trim();
  }

  // Extract institution: text between " - " and " | "
  // Try multiple delimiter patterns
  const instPatterns = [
    /[-–]\s*([^|•\n]+?)(?:\s*\||\s*$)/,                          // "Degree - Institution | Year"
    /\b(?:in|at)\s+([^|,\n]+?)(?:\s*[|,]\s*|\s*$)/i,               // "Degree in Field at Institution"
    /\b([^|,\n]*(?:University|Institute|College|School|Polytechnic|IIT|NIT|BITS|VIT|MIT)[^|,\n]*)/i, // fallback
  ];
  for (const pattern of instPatterns) {
    const m = text.match(pattern);
    if (m) {
      result.institution = m[1].trim();
      break;
    }
  }

  // Extract year range
  const yearRangeMatch = text.match(/((?:20|19)\d{2})\s*[-–]\s*((?:20|19)\d{2}|present|current|ongoing)/i);
  if (yearRangeMatch) {
    result.startYear = yearRangeMatch[1];
    result.endYear = yearRangeMatch[2].match(/\d{4}/)?.[0] || "";
  } else {
    const singleYear = text.match(/\b((?:20|19)\d{2})\b/);
    if (singleYear) result.startYear = singleYear[1];
  }

  // Extract CGPA / percentage / GPA
  const cgpaMatch = text.match(/(?:CGPA|GPA|CPI|SGPA|Percentage)\s*[:=\-–—]?\s*(\d+\.?\d*)\s*(?:\/|out of|%)?\s*(\d+\.?\d*)?/i);
  if (cgpaMatch) {
    result.cgpa = cgpaMatch[1];
    if (cgpaMatch[2]) result.cgpaScale = cgpaMatch[2];
  } else {
    const percentMatch = text.match(/(\d+\.?\d*)%/);
    if (percentMatch) {
      result.cgpa = percentMatch[1];
      result.cgpaScale = "100";
    }
  }

  return result;
}

/** Group experience section blocks into distinct record groups using block boundaries. */
export function groupExperienceRecords(section: Section): SourceRecordGroup[] {
  const groups: SourceRecordGroup[] = [];
  // Preprocess blocks: skip page artifacts and split embedded headers
  const processedBlocks: TextBlock[] = [];
  for (const block of section.blocks) {
    const text = block.text.trim();
    if (!text) continue;
    if (block.blockType === "FOOTER" || block.blockType === "footer") continue;
    const split = splitEmbeddedExperienceBlock(block);
    processedBlocks.push(...split);
  }
  for (const block of processedBlocks) {
    const text = block.text.trim();
    if (!text) continue;

    const isCont = isContinuationBlock(block);

    // Date regex (simplified)
    const hasDate = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:20|19)\d{2}\s*[-–]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:20|19)\d{2}|present|current|ongoing/i.test(text);
    // Role-company pattern at start of block
    const hasRoleCompany = /^([^|•\-–—:]+?)\s*[-–—]\s*([^|•\-–—:]+)/.test(text) || /(?:at|@)\s+([A-Z][A-Za-z0-9\s&.,]+)/.test(text);
    // Expanded title keywords covering academic, creative, and research roles
    const titleKeywords = /(?:Manager|Analyst|Engineer|Developer|Director|VP|Vice President|Head|Chief|Intern|Consultant|Specialist|Officer|President|Lead|Architect|Coordinator|Associate|Assistant|Executive|Strategist|Planner|Designer|Writer|Editor|Scientist|Fellow|Researcher|Trainee|Representative)\b/i;
    const hasTitleKeyword = titleKeywords.test(text);

    // A block is a new experience record if it has role+company pattern,
    // or if it has BOTH a date and a title keyword in the first 80 chars.
    const firstPart = text.slice(0, 80);
    const hasDateAndTitleInFirstPart = /(?:20|19)\d{2}\s*[-–]/.test(firstPart) && titleKeywords.test(firstPart);

    const isNewRecord = (hasRoleCompany && hasTitleKeyword) || hasDateAndTitleInFirstPart;

    if (groups.length === 0 || isNewRecord) {
      groups.push({ blocks: [block], sourceEvidence: text });
    } else if (isCont) {
      // Bullet points, list items, descriptions → continue previous group
      const last = groups[groups.length - 1];
      last.blocks.push(block);
      last.sourceEvidence += "\n" + text;
    } else {
      // Not a new record and not a continuation.
      // Merge into previous group if previous group has role but lacks date
      // and current block has a date (multiline header: title block + date block).
      const last = groups[groups.length - 1];
      const lastHasDate = /(?:20|19)\d{2}\s*[-–]/.test(last.sourceEvidence);
      const lastHasRole = titleKeywords.test(last.sourceEvidence);
      const currentHasDate = /(?:20|19)\d{2}\s*[-–]/.test(text);

      if (!lastHasDate && currentHasDate && lastHasRole) {
        // Previous group is a title-only block; current block provides dates → merge
        last.blocks.push(block);
        last.sourceEvidence += "\n" + text;
      } else if (lastHasDate && !hasTitleKeyword && !hasRoleCompany) {
        // Previous group already has dates; current block is a description → merge
        last.blocks.push(block);
        last.sourceEvidence += "\n" + text;
      } else {
        // Otherwise treat as a new group (might be a false positive, but prevents
        // merging unrelated entries)
        groups.push({ blocks: [block], sourceEvidence: text });
      }
    }
  }
  return groups;
}

/** Extract experience fields from a single source group. */
function extractExperienceFields(group: SourceRecordGroup): Partial<ParsedExperience> & { _sourceLines?: string[] } {
  const text = group.sourceEvidence;
  const result: Partial<ParsedExperience> & { _sourceLines?: string[] } = { _sourceLines: [text] };

  // Role - Company pattern (operate on first line only to avoid cross-line contamination)
  const firstLine = text.split("\n")[0] || text;
  const roleCompanyMatch = firstLine.match(/^([^|•\-–—:]+?)\s*[-–—]\s*([^|•\-–—:]+)/);
  if (roleCompanyMatch) {
    result.role = roleCompanyMatch[1].trim();
    result.organization = roleCompanyMatch[2].trim();
  } else {
    const atMatch = firstLine.match(/^([^@]+?)\s+(?:at|@)\s+(.+?)(?:\s*\||\s*[-–—]|\s*$)/);
    if (atMatch) {
      result.role = atMatch[1].trim();
      result.organization = atMatch[2].trim();
    }
  }

  // Date extraction
  const dateRegex = /(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?((?:20|19)\d{2})|(?:\d{2})\/((?:20|19)\d{2}))\s*(?:-|–|to)\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?((?:20|19)\d{2})|(?:\d{2})\/((?:20|19)\d{2})|present|current|ongoing)/i;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const { startDate, endDate } = normalizeExperienceDates(
      dateMatch[0], dateMatch[1], dateMatch[2], dateMatch[3], dateMatch[4], dateMatch[5]
    );
    result.startDate = startDate;
    result.endDate = endDate;
    result.currentlyWorking = /present|current|ongoing/i.test(endDate || "");
  }

  // Location after |
  const locMatch = text.match(/\|\s*([^|•\n]+?)(?:\s*[-–—•]|\s*$)/);
  if (locMatch) {
    result.location = locMatch[1].trim();
  }

  // Type detection
  if (/\bintern\b/i.test(text)) result.type = "Internship";

  // Responsibilities from bullet points
  const bullets = text.split("\n").filter(l => {
    const t = l.trim();
    return t.startsWith("•") || t.startsWith("-") || t.startsWith("*");
  });
  if (bullets.length > 0) {
    result.responsibilities = bullets.map(b => b.replace(/^[•\-*]\s*/, "")).join(" ");
  }

  return result;
}

// --- Education parser (receives ONLY education section blocks) ---
/** Reject education records that are clearly not real qualifications. */
function isPlausibleEducationRecord(e: Partial<ParsedEducation>): boolean {
  // Must have at least 2 meaningful fields among degree, institution, year, cgpa
  const meaningfulFields = [
    e.degree && e.degree.length > 1,
    e.institution && e.institution.length > 2 && !/^\d{4}$/.test(e.institution) && !/^(mumbai|delhi|bangalore|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|lucknow|kanpur|nagpur|indore|thane|bhopal|visakhapatnam|patna|vadodara|ghaziabad|ludhiana|agra|nashik|ranchi|coimbatore|chandigarh|mysore|guwahati)/i.test(e.institution),
    e.startYear && /^\d{4}$/.test(e.startYear),
    e.cgpa && e.cgpa.length > 0,
  ].filter(Boolean).length;

  if (meaningfulFields < 2) return false;

  // Reject institutions that are just dates or location fragments
  if (e.institution && (/^\d{4}[-–]\d{4}$/.test(e.institution) || /^\d{4}$/.test(e.institution))) return false;

  // Reject if degree is just a generic keyword without context
  if (e.degree && /^(secondary|school|board|education)$/i.test(e.degree)) return false;

  return true;
}

function normalizeDegree(deg: string): string {
  return deg.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
}

function deduplicateEducation(edu: ParsedEducation[]): ParsedEducation[] {
  const seen = new Set<string>();
  return edu.filter(e => {
    const key = `${normalizeDegree(e.degree)}|${e.institution.toLowerCase().trim()}|${e.startYear}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseEducationSection(section: Section): ParsedEducation[] {
  const groups = groupEducationRecords(section);
  const records: ParsedEducation[] = [];

  for (const group of groups) {
    const extracted = extractEducationFields(group);
    const record: ParsedEducation = {
      id: generateId(),
      institution: extracted.institution || "",
      degree: extracted.degree || "",
      specialization: extracted.specialization || "",
      startYear: extracted.startYear || "",
      endYear: extracted.endYear || "",
      cgpa: extracted.cgpa || "",
      cgpaScale: extracted.cgpaScale || "10",
      sourceEvidence: extracted._sourceLines?.join(" | ") || "",
    };
    records.push(record);
  }

  // Filter out board-only entries and apply plausibility check
  const plausible = records.filter(e => {
    if (!e.degree && e.institution && /\bboard\b/i.test(e.institution)) return false;
    return isPlausibleEducationRecord(e);
  });

  return deduplicateEducation(plausible);
}

// --- Education table parser (for table-aware structured data) ---
export function parseEducationTableSection(section: Section): ParsedEducation[] {
  const education: ParsedEducation[] = [];

  // Group blocks by tableId
  const tables: Map<string, TextBlock[]> = new Map();

  for (const block of section.blocks) {
    const tableId = block.metadata?.tableId;
    if (tableId != null && typeof tableId === 'string') {
      if (!tables.has(tableId)) tables.set(tableId, []);
      tables.get(tableId)!.push(block);
    }
  }

  // Process each table
  for (const [, tableBlocks] of tables) {
    // Sort by rowIndex, then columnIndex
    const sortedBlocks = [...tableBlocks].sort((a, b) => {
      const rowA = a.row ?? 0;
      const rowB = b.row ?? 0;
      if (rowA !== rowB) return rowA - rowB;
      const colA = a.column ?? 0;
      const colB = b.column ?? 0;
      return colA - colB;
    });

    // Group by rowIndex
    const rows: Map<number, TextBlock[]> = new Map();
    for (const block of sortedBlocks) {
      const rowIndex = block.row ?? 0;
      if (!rows.has(rowIndex)) rows.set(rowIndex, []);
      rows.get(rowIndex)!.push(block);
    }

    const sortedRowKeys = [...rows.keys()].sort((a, b) => a - b);
    if (sortedRowKeys.length === 0) continue;

    // Detect header row and map columns by header name
    let colMap: { degree?: number; institution?: number; year?: number; result?: number } = {};
    const headerRowIndex = sortedRowKeys[0];
    const headerBlocks = rows.get(headerRowIndex) || [];
    const isHeaderRow = headerBlocks.some(b => b.metadata?.isHeader === true);

    if (isHeaderRow) {
      for (const block of headerBlocks) {
        const colIndex = block.column ?? 0;
        const lower = block.text.toLowerCase();
        if (/qualification|degree|course|program|programme/.test(lower)) colMap.degree = colIndex;
        else if (/institution|university|college|school|board/.test(lower)) colMap.institution = colIndex;
        else if (/year|duration|period|passing/.test(lower)) colMap.year = colIndex;
        else if (/result|cgpa|percentage|grade|marks|score|gpa/.test(lower)) colMap.result = colIndex;
      }
    }

    // If no header detected, try to infer from first data row
    if (Object.keys(colMap).length === 0 && sortedRowKeys.length > 1) {
      const firstDataBlocks = rows.get(sortedRowKeys[1]) || [];
      for (const block of firstDataBlocks) {
        const colIndex = block.column ?? 0;
        const text = block.text;
        // Infer by content patterns
        if (/\d{4}/.test(text) && text.length < 15) colMap.year = colIndex;
        else if (/\d+\.?\d*/.test(text) && text.length < 10) colMap.result = colIndex;
        else if (/\b(?:University|College|School|Institute|IIT|NIT|BITS|VIT)\b/i.test(text)) colMap.institution = colIndex;
        else if (/\b(?:B\.?Tech|M\.?Tech|B\.?E\.|M\.?S\.|B\.?Sc\.|MBA|Ph\.?D|12th|10th)\b/i.test(text)) colMap.degree = colIndex;
      }
    }

    // Fallback: assume first N columns map to degree, institution, year, result
    const dataStartIndex = isHeaderRow ? 1 : 0;
    for (let i = dataStartIndex; i < sortedRowKeys.length; i++) {
      const rowBlocks = rows.get(sortedRowKeys[i]) || [];
      const cells: { [col: number]: string } = {};
      for (const block of rowBlocks) cells[block.column ?? 0] = block.text;

      const colIndices = Object.keys(cells).map(Number).sort((a, b) => a - b);
      if (colIndices.length === 0) continue;

      let degree = "";
      let institution = "";
      let year = "";
      let result = "";

      if (Object.keys(colMap).length > 0) {
        degree = colMap.degree !== undefined ? cells[colMap.degree] || "" : "";
        institution = colMap.institution !== undefined ? cells[colMap.institution] || "" : "";
        year = colMap.year !== undefined ? cells[colMap.year] || "" : "";
        result = colMap.result !== undefined ? cells[colMap.result] || "" : "";
      } else {
        // Positional fallback
        degree = cells[colIndices[0]] || "";
        institution = cells[colIndices[1]] || "";
        year = cells[colIndices[2]] || "";
        result = cells[colIndices[3]] || "";
      }

      if (!degree && !institution) continue; // Skip empty rows

      // Parse year into startYear/endYear if it's a range
      let startYear = "";
      let endYear = "";
      let cgpa = "";
      let cgpaScale = "";
      if (year) {
        const yearRangeMatch = year.match(/(\d{4})\s*[-–]\s*(\d{4})/);
        if (yearRangeMatch) {
          startYear = yearRangeMatch[1];
          endYear = yearRangeMatch[2];
        } else if (/\d{4}/.test(year)) {
          startYear = year.match(/\d{4}/)?.[0] || "";
        }
      }
      if (result) {
        const cgpaMatch = result.match(/(\d+\.?\d*)\s*(?:\/|out of)\s*(\d+\.?\d*)/);
        if (cgpaMatch) {
          cgpa = cgpaMatch[1];
          cgpaScale = cgpaMatch[2];
        } else if (/\d+\.?\d*/.test(result)) {
          cgpa = result.match(/\d+\.?\d*/)?.[0] || "";
        }
      }

      const source = rowBlocks.map(b => b.text).join(" | ");
      education.push({
        id: generateId(),
        institution,
        degree,
        specialization: "",
        startYear,
        endYear,
        cgpa,
        cgpaScale,
        sourceEvidence: source,
      });
    }
  }

  return deduplicateEducation(education);
}

// --- Experience table parser (for table-aware structured data) ---
export function parseExperienceTableSection(section: Section): ParsedExperience[] {
  const experience: ParsedExperience[] = [];
  
  // Group blocks by tableId
  const tables: Map<string, TextBlock[]> = new Map();
  
  for (const block of section.blocks) {
    const tableId = block.metadata?.tableId;
    if (tableId != null && typeof tableId === 'string') {
      if (!tables.has(tableId)) {
        tables.set(tableId, []);
      }
      tables.get(tableId)!.push(block);
    }
  }
  
  // Process each table
  for (const [tableId, tableBlocks] of tables) {
    // Sort by rowIndex, then columnIndex
    const sortedBlocks = [...tableBlocks].sort((a, b) => {
      const rowA = a.row ?? 0;
      const rowB = b.row ?? 0;
      if (rowA !== rowB) return rowA - rowB;
      const colA = a.column ?? 0;
      const colB = b.column ?? 0;
      return colA - colB;
    });
    
    // Group by rowIndex
    const rows: Map<number, TextBlock[]> = new Map();
    for (const block of sortedBlocks) {
      const rowIndex = block.row ?? 0;
      if (!rows.has(rowIndex)) {
        rows.set(rowIndex, []);
      }
      rows.get(rowIndex)!.push(block);
    }
    
    // Process each row
    const sortedRowKeys = [...rows.keys()].sort((a, b) => a - b);
    for (const rowIndex of sortedRowKeys) {
      const rowBlocks = rows.get(rowIndex)!;
      
      // Skip header rows
      const isHeaderRow = rowBlocks.some(b => b.metadata?.isHeader === true);
      if (isHeaderRow) continue;
      
      // Extract cells in order
      const cells: { [columnIndex: number]: string } = {};
      for (const block of rowBlocks) {
        const colIndex = block.column ?? 0;
        cells[colIndex] = block.text;
      }
      
      // Expect: Company / Role, Dates, Location, Selected Impact
      // Column 0: Company / Role (may contain both)
      // Column 1: Dates
      // Column 2: Location
      // Column 3: Selected Impact (responsibilities)
      if (cells[0] !== undefined && cells[1] !== undefined) {
        const companyRole = cells[0] || "";
        const dateRange = cells[1] || "";
        const location = cells[2] || "";
        const responsibilities = cells[3] || "";
        
        // Parse company/role from combined field
        let organization = "";
        let role = "";

        // Try to split "Company / Role" or "Company Role"
        if (companyRole.includes("/")) {
          const parts = companyRole.split("/").map(p => p.trim());
          organization = parts[0] || "";
          role = parts[1] || "";
        } else if (companyRole.includes(" ")) {
          // Try to detect role keywords
          const words = companyRole.split(/\s+/);
          if (words.length >= 2) {
            // Last word(s) might be role
            const possibleRole = words.slice(-2).join(" ");
            if (/manager|director|analyst|engineer|developer|lead|specialist|officer|president|vp|vice|head|chief/i.test(possibleRole)) {
              role = possibleRole;
              organization = words.slice(0, -2).join(" ");
            } else {
              organization = companyRole;
            }
          } else {
            organization = companyRole;
          }
        } else {
          organization = companyRole;
        }

        // Fix merged words where company name and role were concatenated without space
        // e.g. "Atlas Process SystemsSenior Program Manager" → org "Atlas Process Systems", role "Senior Program Manager"
        function fixMergedWord(text: string): string {
          if (!text) return text;
          return text.replace(
            /([a-z])(Senior|Junior|Lead|Manager|Director|Analyst|Engineer|Developer|Specialist|Officer|President|Head|Chief|Consultant|Architect|Designer|Coordinator|Representative|Associate|Assistant|Executive|Strategist|Planner|Officer|Program|Business)(\b|$)/gi,
            "$1 $2$3"
          );
        }

        if (organization) {
          const mergedFix = fixMergedWord(organization);
          if (mergedFix !== organization) {
            const parts = mergedFix.split(/\s+/);
            const roleStartIdx = parts.findIndex((w, i) =>
              i > 0 && /^(?:Senior|Junior|Lead|Manager|Director|Analyst|Engineer|Developer|Specialist|Officer|President|Head|Chief|Consultant|Architect|Designer|Coordinator|Representative|Associate|Assistant|Executive|Strategist|Planner|Officer|Program|Business)$/i.test(w)
            );
            if (roleStartIdx > 0) {
              role = parts.slice(roleStartIdx).join(" ") + (role ? " " + role : "");
              organization = parts.slice(0, roleStartIdx).join(" ");
            } else {
              organization = mergedFix;
            }
          }
        }
        if (role) {
          role = fixMergedWord(role);
        }
        
        // Parse date range
        let startDate = "";
        let endDate = "";
        let currentlyWorking = false;
        
        const dateMatch = dateRange.match(/((?:20|19)\d{2})\s*(?:-|–|to)\s*((?:20|19)\d{2}|present|current|ongoing)/i);
        if (dateMatch) {
          startDate = dateMatch[1];
          const end = dateMatch[2];
          if (/present|current|ongoing/i.test(end)) {
            currentlyWorking = true;
            endDate = "";
          } else {
            endDate = end.match(/\d{4}/)?.[0] || "";
          }
        }
        
        experience.push({
          id: generateId(),
          type: "Full-time Job",
          organization: organization,
          role: role,
          location: location,
          startDate: startDate,
          endDate: endDate,
          currentlyWorking: currentlyWorking,
          responsibilities: responsibilities,
        });
      }
    }
  }
  
  return experience;
}

// ============================================================
// EXPERIENCE DATE NORMALIZATION
// ============================================================

export const MONTH_NAME_TO_NUM: Record<string, string> = {
   jan: "01", january: "01",
   feb: "02", february: "02",
   mar: "03", march: "03",
   apr: "04", april: "04",
   may: "05",
   jun: "06", june: "06",
   jul: "07", july: "07",
   aug: "08", august: "08",
   sep: "09", september: "09",
   oct: "10", october: "10",
   nov: "11", november: "11",
   dec: "12", december: "12",
};

/**
 * Normalize experience date tokens to canonical format.
 * 
 * Input:
 * - fullMatch: the complete matched date string (e.g., "May 2024 - Present", "05/2020 - 08/2020")
 * - year1: month-name start year (group 1)
 /**
 * Normalize experience date tokens to canonical format.
 * 
 * Input:
 * - fullMatch: the complete matched date string (e.g., "May 2024 - Present", "05/2020 - 08/2020")
 * - year1: month-name start year (group 1)
 * - year2: MM/YYYY start year (group 2)
 * - year3: month-name end year (group 3)
 * - year4: MM/YYYY end year (group 4)
 * - presentKeyword: "present"/"current"/"ongoing" keyword (group 5)
 * 
 * Returns { startDate, endDate } in canonical format:
 * - YYYY-MM when month is known (from month name or MM/YYYY)
 * - YYYY when year-only (no month)
 * - "" (empty) for "present"
 */
function normalizeExperienceDates(
  fullMatch: string,
  year1: string | undefined,
  year2: string | undefined,
  year3: string | undefined,
  year4: string | undefined,
  presentKeyword: string | undefined
): { startDate: string; endDate: string } {
  let startDate = "";
  let endDate = "";

  // Start date: prefer MM/YYYY format (year2), then month-name format (year1)
  if (year2) {
    // Extract month from fullMatch for MM/YYYY format
    const mmMatch = fullMatch.match(/^(\d{2})\/\d{4}/);
    if (mmMatch) {
      const month = mmMatch[1];
      if (parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) {
        startDate = `${year2}-${month}`;
      } else {
        startDate = year2;
      }
    } else {
      startDate = year2;
    }
  } else if (year1) {
    // Extract month name from fullMatch
    const monthMatch = fullMatch.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i);
    if (monthMatch) {
      const monthKey = monthMatch[1].toLowerCase();
      const monthNum = MONTH_NAME_TO_NUM[monthKey];
      if (monthNum) {
        startDate = `${year1}-${monthNum}`;
      } else {
        startDate = year1;
      }
    } else {
      startDate = year1;
    }
  }

  // End date: check for present first, then explicit end years
  if (presentKeyword) {
    endDate = ""; // Present => empty endDate, currentlyWorking will be true
  } else if (year4) {
    // Extract month from fullMatch for MM/YYYY format (look for the second occurrence)
    // Match all MM/YYYY patterns and take the last one
    const mmMatches = fullMatch.match(/\d{2}\/\d{4}/g);
    if (mmMatches && mmMatches.length >= 2) {
      const lastMatch = mmMatches[mmMatches.length - 1];
      const month = lastMatch.match(/^(\d{2})\/\d{4}/)?.[1];
      if (month && parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) {
        endDate = `${year4}-${month}`;
      } else {
        endDate = year4;
      }
    } else {
      endDate = year4;
    }
  } else if (year3) {
    // Extract month name from fullMatch (second occurrence for end date)
    // Find the end date portion by looking after the separator
    const parts = fullMatch.split(/(?:-|–|to)/);
    if (parts.length >= 2) {
      const endPart = parts[parts.length - 1].trim();
      const monthMatch = endPart.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i);
      if (monthMatch) {
        const monthKey = monthMatch[1].toLowerCase();
        const monthNum = MONTH_NAME_TO_NUM[monthKey];
        if (monthNum) {
          endDate = `${year3}-${monthNum}`;
        } else {
          endDate = year3;
        }
      } else {
        endDate = year3;
      }
    } else {
      endDate = year3;
    }
  }

  return { startDate, endDate };
}

/** Reject experience records where organization or role is clearly prose. */
function isPlausibleExperienceRecord(e: Partial<ParsedExperience>): boolean {
  // Must have both role and organization, OR role + date, OR organization + date
  const hasRole = e.role && e.role.length > 2 && !/^(description|built|developed|created|designed|implemented|managed|led|worked|assisted|helped|responsible)/i.test(e.role);
  const hasOrg = e.organization && e.organization.length > 2 && !/^(description|built|developed|created|designed|implemented|managed|led|worked|assisted|helped|responsible)/i.test(e.organization);
  const hasDate = e.startDate && e.startDate.length > 0;

  if (!hasRole && !hasOrg) return false;
  if (hasOrg && /^(description|built|developed|created|designed|implemented|managed|led|worked):/i.test(e.organization!)) return false;

  // Organization should not be a full sentence
  if (hasOrg && e.organization!.split(/[.!?]/).length > 1) return false;

  // Role should not contain "Description:" or similar prose markers
  if (hasRole && /\b(description|details|summary|overview):/i.test(e.role!)) return false;

  return true;
}

/** Returns true if a line looks like a description/prose line, not a header. */
function isDescriptionLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (/^(description|built|developed|created|designed|implemented|managed|led|worked|assisted|helped|responsible for):/i.test(line)) return true;
  if (lower.startsWith("description ") || lower.startsWith("details ")) return true;
  // Lines with sentences are descriptions (single or multiple)
  if (/[.!?]/.test(line) && line.split(/[.!?]/).filter(s => s.trim().length > 10).length >= 1) return true;
  return false;
}

// ============================================================
// EXPERIENCE PARSER (receives ONLY experience section blocks)
// ============================================================
function parseExperienceSection(section: Section): ParsedExperience[] {
  const groups = groupExperienceRecords(section);
  const records: ParsedExperience[] = [];

  for (const group of groups) {
    const extracted = extractExperienceFields(group);
    const record: ParsedExperience = {
      id: generateId(),
      type: extracted.type || "Full-time Job",
      organization: extracted.organization || "",
      role: extracted.role || "",
      location: extracted.location || "",
      startDate: extracted.startDate || "",
      endDate: extracted.endDate || "",
      currentlyWorking: extracted.currentlyWorking || false,
      responsibilities: extracted.responsibilities || "",
      sourceEvidence: extracted._sourceLines?.join(" | ") || "",
    };
    if (isPlausibleExperienceRecord(record)) {
      records.push(record);
    }
  }

  return records;
}

// --- Projects parser (receives ONLY projects section blocks) ---
function parseProjectsSection(section: Section): ParsedProject[] {
  const projects: ParsedProject[] = [];
  const blocks = section.blocks;
  const text = blocks.map(b => b.text).join("\n");
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  let currentProj: Partial<ParsedProject> | null = null;

  // Separator patterns for "Title - Description" or "Title: Description"
  const titleSeparatorRegex = /\s[-–—:]\s/;

  function isPlausibleProjectTitle(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 120) return false; // reasonable upper bound
    if (t.startsWith("•") || t.startsWith("-") || t.startsWith("*")) return false;
    
    // Should not look like a full sentence (ends with period, multiple clauses)
    if (t.endsWith(".") && t.split(/[,;]/).length > 2) return false;
    
    // Should not be just dates, locations, or generic phrases
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(t)) return false;
    if (/^(project|initiative|work|assignment)$/i.test(t)) return false;
    
    return true;
  }

  for (const line of lines) {
    // Try to split on title separator (e.g., "Title - Description" or "Title: Description")
    let titlePart = "";
    let descPart = "";
    let hasValidTitle = false;

    const sepMatch = line.match(titleSeparatorRegex);
    if (sepMatch) {
      const sepIndex = sepMatch.index || 0;
      const candidateTitle = line.substring(0, sepIndex).trim();
      const candidateDesc = line.substring(sepIndex + sepMatch[0].length).trim();
      
      // Check if left side looks like a project title
      if (isPlausibleProjectTitle(candidateTitle) && candidateDesc.length > 10) {
        titlePart = candidateTitle;
        descPart = candidateDesc;
        hasValidTitle = true;
      }
    }

    if (hasValidTitle) {
      // This is a one-line project record with title + description
      if (currentProj && currentProj.name) {
        projects.push({
          id: generateId(),
          name: currentProj.name || "",
          type: currentProj.type || "",
          description: currentProj.description || "",
          technologies: currentProj.technologies || "",
          role: currentProj.role || "",
        });
      }
      currentProj = { name: titlePart, type: "Academic", description: descPart, technologies: "" };
    } else if (line.length < 80 && !line.startsWith("•") && !line.startsWith("-") && !line.startsWith("*")) {
      // Traditional short line = new project name
      if (currentProj && currentProj.name) {
        projects.push({
          id: generateId(),
          name: currentProj.name || "",
          type: currentProj.type || "",
          description: currentProj.description || "",
          technologies: currentProj.technologies || "",
          role: currentProj.role || "",
        });
      }
      currentProj = { name: line, type: "Academic", description: "", technologies: "" };
    } else if (currentProj) {
      // Description/bullet line for current project
      const desc = line.replace(/^[•\-*]\s*/, "");
      if (currentProj.description) {
        currentProj.description += " " + desc;
      } else {
        currentProj.description = desc;
      }
      const techMatch = line.match(/(?:technologies|tools|tech stack|built with|using)\s*:?\s*(.+)/i);
      if (techMatch) {
        currentProj.technologies = techMatch[1].trim();
      }
    }
  }

  if (currentProj && currentProj.name) {
    projects.push({
      id: generateId(),
      name: currentProj.name || "",
      type: currentProj.type || "",
      description: currentProj.description || "",
      technologies: currentProj.technologies || "",
      role: currentProj.role || "",
    });
  }

  return projects;
}

// --- Skills parser (receives ONLY skills section blocks) ---
function parseSkillsSection(section: Section): ParsedCV["skills"] {
  const skills: ParsedCV["skills"] = {
    technical: [],
    programming: [],
    tools: [],
    software: [],
    domain: [],
    soft: [],
  };

  const blocks = section.blocks;
  const text = blocks.map(b => b.text).join("\n");

  for (const [category, knownSkills] of Object.entries(COMMON_SKILLS)) {
    for (const skill of knownSkills) {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(text)) {
        (skills as any)[category].push(skill);
      }
    }
  }

  for (const key of Object.keys(skills)) {
    (skills as any)[key] = Array.from(new Set((skills as any)[key]));
  }

  return skills;
}

// --- Certifications parser (receives ONLY certifications section blocks) ---
function parseCertificationsSection(section: Section): string[] {
  const blocks = section.blocks;
  const text = blocks.map(b => b.text).join("\n");
  
  // First split by newlines and bullets
  const initialLines = text.split("\n")
    .map(l => l.replace(/^[•\-*▪◦·]\s*/, "").trim())
    .filter(l => l.length > 3 && l.length < 200);
  
  // Parse certifications by splitting on " - YYYY " patterns
  // Each certification follows the pattern: "Name - YYYY" or "Name - YYYY Issuer"
  // When multiple certs are on one line, they appear as "Cert1 - YYYY Cert2 - YYYY"
  // We split on " - YYYY " where the next word starts with a capital letter
  // but is NOT a known issuer (like Scrum.org, IAAP, etc.)
  
  const certifications: string[] = [];
  const knownIssuers = /^(Scrum\.org|IAAP|AWS|GCP|Azure|PMI|ISACA|ISC2|CompTIA|Microsoft|Google|Amazon|Cisco|Oracle|Scrum|IIBA|AXELOS|PeopleCert)\b/i;
  
  for (const line of initialLines) {
    // Split on " - YYYY " where YYYY is a year
    const parts = line.split(/(\s+-\s*\d{4}\s*)/);
    
    if (parts.length <= 1) {
      // No year-based splits found, keep as single certification
      certifications.push(line.trim());
      continue;
    }
    
    // Reconstruct: parts alternates between [text, " - YYYY ", text, " - YYYY ", ...]
    // The " - YYYY " separator belongs to the PRECEDING certification
    let currentCert = parts[0];
    
    for (let i = 1; i < parts.length; i += 2) {
      // parts[i] is the " - YYYY " separator
      // parts[i+1] is the next text segment
      currentCert += parts[i];
      
      // Check if the next text segment starts a new certification
      const nextText = parts[i + 1] || "";
      const nextTrimmed = nextText.trim();
      
      // A new certification starts if:
      // 1. Next text starts with a capital letter
      // 2. Next text is reasonably long (not just an issuer abbreviation)
      // 3. Next text is NOT a known issuer domain/name OR it looks like a complete certification record
      const startsWithCapital = /^[A-Z]/.test(nextTrimmed);
      const isLongEnough = nextTrimmed.length >= 5;
      const isKnownIssuer = knownIssuers.test(nextTrimmed);
      
      // Check if next segment looks like a complete certification record:
      // "IssuerOrBody CertName - Date" or "CertName - Date" or "CertName Date"
      const looksLikeCompleteCert = / - \d{4}\b/.test(nextTrimmed) || 
        /\b(20|19)\d{2}$/.test(nextTrimmed) ||
        /\b(certif|cert|certification|credential|license|accreditation|certified|certificate)\b/i.test(nextTrimmed);
      
      const isNotKnownIssuer = !isKnownIssuer || looksLikeCompleteCert;
      
      const isNewCert = startsWithCapital && isLongEnough && isNotKnownIssuer;
      
      if (isNewCert) {
        // Complete current certification
        certifications.push(currentCert.trim());
        // Start new certification with the next segment
        currentCert = nextTrimmed;
      }
    }
    
    // Add the last certification
    if (currentCert.trim()) {
      certifications.push(currentCert.trim());
    }
  }
  
  return certifications
    .map(l => l.trim())
    .filter(l => l.length > 3 && l.length < 200);
}

// --- Achievements parser (receives ONLY achievements section blocks) ---
function parseAchievementsSection(section: Section): string[] {
  return parseCertificationsSection(section); // Same logic
}

// --- Header region extraction ---
/** Extract text from blocks that appear before the first section heading.
 *  This isolates the resume header (name, contact, location) from
 *  section bodies that frequently contain contaminating keywords. */
export function getHeaderRegionText(blocks: TextBlock[]): string {
  const headerBlocks: TextBlock[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    // Stop at first known section heading
    const isSectionHeading =
      /^\s*(?:Education|Academic Background|Qualifications|Scholastic Record|Academic Qualifications|Educational Background|Education \& Credentials|Experience|Employment|Work History|Professional Experience|Career History|Career Journey|Work Experience|Employment History|Professional History|Career Experience|Professional Career|Academic Appointments|Teaching Experience|Research Experience|Projects|Personal Projects|Academic Projects|Key Projects|Project Experience|Proof of Work|Portfolio|Selected Projects|Major Projects|Project Highlights|Initiatives|Selected Initiatives|Key Initiatives|Major Initiatives|Project Portfolio|Skills|Technical Skills|Core Competencies|Technologies|Tech Stack|Expertise|Competencies|Core Capabilities|Certifications|Certificates|Licenses|Certified Courses|Professional Certifications|Credentials|Achievements|Awards|Honours|Accomplishments|Recognitions|Awards and Honors|Grants \& Awards|Grants and Awards|Personal Information|Personal Details|Contact|Contact Information|Summary|Objective|Profile|Professional Summary|Career Objective|About Me|Executive Profile|Career Overview)\s*[:\-–—]?\s*$/i.test(text);
    if (isSectionHeading) break;
    // Also stop at heading-like blocks that are clearly section boundaries
    if (block.blockType === "HEADING" || block.blockType === "heading") {
      const headingResult = classifyHeading(block);
      if (headingResult.canonicalType !== "UNKNOWN_SECTION" && headingResult.confidence === "HIGH") {
        break;
      }
    }
    headerBlocks.push(block);
  }
  return headerBlocks.map(b => b.text).join("\n");
}

// --- Personal data plausibility validators ---
const JOB_TITLE_KEYWORDS = /(?:Manager|Analyst|Engineer|Developer|Director|VP|Vice President|Head|Chief|Intern|Consultant|Specialist|Officer|President|Lead|Architect|Coordinator|Associate|Assistant|Executive|Strategist|Planner|Designer|Writer|Editor|Scientist|Fellow|Researcher|Trainee|Representative|Scientist|Biologist|Research|Pharmacy|Pharm D|Doctor|Physician|Nurse|Therapist|Pharmacist|Clinical|Research\s+Scientist|Computational\s+Biology)\b/i;

const EDUCATION_KEYWORDS = /(?:B\.?Tech\.?|B\.?E\.?|Bachelor|M\.?Tech|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master|Ph\.?D\.?|Doctorate|Diploma|MBA|Executive\s+MBA|B\.?Sc\.?|B\.?Com\.?|B\.?S\.?|Class\s+X|Class\s+XII|10th|12th|Senior\s+Secondary|SSLC|SSC|PG\s+Diploma|University|Institute|College|School|Polytechnic|IIT|NIT|BITS|VIT|MIT|Stanford|Harvard|Oxford|Cambridge)\b/i;

const FIELD_OF_STUDY_KEYWORDS = /(?:Computer|Engineering|Technology|Information|Science|Biology|Mathematics|Physics|Chemistry|Medicine|Pharmacy|Business|Management|Finance|Economics|Commerce|Arts|Humanities|Social|Political|Law|Architecture|Design|Marketing|Accounting|Statistics|Data|Analytics|Cybersecurity|Operations|Research|Development|Software|Hardware|Electrical|Mechanical|Civil|Chemical|Biotechnology|Bioinformatics|Genomics|Life\s+Sciences)\b/i;

const COMMON_COUNTRY_NAMES = /^(?:India|United\s+States|USA|UK|United\s+Kingdom|Canada|Australia|Germany|France|Spain|Italy|Netherlands|Singapore|UAE|Dubai|Abu\s+Dhabi|Qatar|Saudi\s+Arabia|Japan|China|South\s+Korea|Brazil|Mexico|Argentina|South\s+Africa|Nigeria|Kenya|Egypt|Turkey|Russia|Poland|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Portugal|Ireland|New\s+Zealand|Malaysia|Thailand|Indonesia|Philippines|Vietnam|Pakistan|Bangladesh|Sri\s+Lanka|Nepal|Myanmar|Iran|Iraq|Israel|Jordan|Lebanon|Kuwait|Bahrain|Oman|Yemen|Syria|Libya|Morocco|Tunisia|Algeria|Sudan|Ethiopia|Ghana|Uganda|Tanzania|Zambia|Zimbabwe|Botswana|Namibia|Mozambique|Madagascar|Malawi|Rwanda|Somalia|Djibouti|Eritrea|Chad|Niger|Mali|Burkina\s+Faso|Guinea|Senegal|Benin|Togo|Sierra\s+Leone|Liberia|Guinea-Bissau|Gambia|Cape\s+Verde|Comoros|Seychelles|Mauritius|Maldives|Bhutan|Afghanistan|Kazakhstan|Uzbekistan|Turkmenistan|Tajikistan|Kyrgyzstan|Mongolia|North\s+Korea|Laos|Cambodia|Brunei|East\s+Timor|Papua\s+New\s+Guinea|Fiji|Solomon\s+Islands|Vanuatu|Samoa|Tonga|Kiribati|Tuvalu|Nauru|Palau|Marshall\s+Islands|Micronesia|Guam|American\s+Samoa|Northern\s+Mariana\s+Islands|Hong\s+Kong|Macau|Taiwan|Greenland|Iceland|Czech\s+Republic|Slovakia|Hungary|Romania|Bulgaria|Croatia|Slovenia|Serbia|Bosnia\s+and\s+Herzegovina|Montenegro|North\s+Macedonia|Albania|Kosovo|Moldova|Ukraine|Belarus|Lithuania|Latvia|Estonia|Georgia|Armenia|Azerbaijan|Cyprus|Malta|Luxembourg|Liechtenstein|Monaco|Andorra|San\s+Marino|Vatican\s+City|San\s+Marino|Bermuda|Cayman\s+Islands|Barbados|Jamaica|Trinidad\s+and\s+Tobago|Bahamas|Cuba|Dominican\s+Republic|Haiti|Puerto\s+Rico|Belize|Costa\s+Rica|El\s+Salvador|Guatemala|Honduras|Nicaragua|Panama|Colombia|Venezuela|Ecuador|Peru|Bolivia|Chile|Uruguay|Paraguay|Guyana|Suriname|French\s+Guiana|Brazil|Argentina)$ /i;

const INDIAN_CITIES = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Surat", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Ranchi", "Faridabad", "Meerut", "Rajkot", "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai", "Allahabad", "Ranchi", "Howrah", "Coimbatore", "Jabalpur", "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", "Kota", "Guwahati", "Chandigarh", "Solapur", "Hubli", "Tiruchirappalli", "Bareilly", "Mysore", "Tiruppur", "Gurgaon", "Aligarh", "Jalandhar", "Warangal", "Guntur", "Bhiwandi", "Saharanpur", "Gorakhpur", "Bikaner", "Amravati", "Noida", "Jamshedpur", "Bhilai", "Cuttack", "Firozabad", "Kochi", "Nellore", "Bhavnagar", "Dehradun", "Durgapur", "Asansol", "Rourkela", "Nanded", "Kolhapur", "Ajmer", "Akola", "Gulbarga", "Jamnagar", "Ujjain", "Loni", "Siliguri", "Jhansi", "Ulhasnagar", "Jammu", "Sangli-Miraj", "Kupwad", "Mangalore", "Erode", "Belgaum", "Ambattur", "Tirunelveli", "Malegaon", "Gaya", "Jalgaon", "Udaipur", "Maheshtala", "Davanagere", "Kozhikode", "Kurnool", "Rajpur Sonarpur", "Rajahmundry", "Bokaro", "South Dumdum", "Bellary", "Patiala", "Gopalpur", "Agartala", "Bhagalpur", "Muzaffarnagar", "Bhatpara", "Panihati", "Latur", "Dhule", "Rohtak", "Korba", "Bhilwara", "Brahmapur", "Muzaffarpur", "Ahmednagar", "Mathura", "Kollam", "Avadi", "Kadapa", "Anantapur", "Kamarhati", "Bilaspur", "Sambalpur", "Shahjahanpur", "Satara", "Bijapur", "Rampur", "Shivamogga", "Chandrapur", "Junagadh", "Thrissur", "Alwar", "Bardhaman", "Kulti", "Kakinada", "Nizamabad", "Parbhani", "Tumkur", "Hisar", "Ozhukarai", "Bihar Sharif", "Panipat", "Darbhanga", "Bally", "Aizawl", "Dewas", "Ichalkaranji", "Karnal", "Bathinda", "Jalna", "Eluru", "Kirari Suleman Nagar", "Purnia", "Satna", "Mau", "Sonipat", "Farrukhabad", "Sagar", "Rourkela", "Durg", "Imphal", "Ratlam", "Hapur", "Araria", "Arrah", "Karimnagar", "Anantapuram", "Etawah", "Ambarnath", "North Dumdum", "Bharatpur", "Begusarai", "New Delhi", "Gandhidham", "Baranagar", "Tiruvottiyur", "Pondicherry", "Sikar", "Thoothukudi", "Rewa", "Mirzapur", "Raichur", "Pali", "Ramagundam", "Haridwar", "Vijayanagaram", "Katihar", "Nagda", "Secunderabad", "Mango", "Thanjavur", "Bulandshahr", "Uluberia", "Murwara", "Sambhal", "Singrauli", "Nadiad", "Secunderabad", "Naihati", "Yamunanagar", "Bidhan Nagar", "Pallavaram", "Bidar", "Munger", "Panchkula", "Burhanpur", "Raurkela Industrial Township", "Mohali", "Fatehpur", "Ongole", "Nangloi Jat", "Surendranagar Dudhrej", "Hugli and Chinsurah", "Sasaram", "Hazaribagh", "Kaithal", "Deoghar", "Sultan Pur Majra", "Bettiah", "Sehore", "Hindupur", "Madhyamgram", "Barasat", "Sirsa", "Chittoor", "Morena", "Proddatur", "Bhusawal", "Orai", "Fatehpur Sikri", "Dibrugarh", "Hosur", "Secunderabad", "Pali", "Ballia", "Mahbubnagar", "Bhuj", "Gandhinagar", "Dharmavaram", "Narasaraopet", "Srikakulam", "Adilabad", "Yemmiganur", "Amalapuram", "Chilakaluripet", "Vizianagaram", "Tenali", "Tadepalligudem", "Eluru", "Nellore", "Khammam", "Maharajganj", "Pali", "Kadapa", "Nalgonda", "Siddipet", "Jagtial", "Bhongir", "Miryalaguda", "Nizamabad", "Warangal", "Khammam", "Karimnagar", "Ramagundam", "Adilabad", "Nizamabad", "Mahabubnagar", "Medak", "Ranga Reddy", "Nalgonda", "Warangal Urban", "Warangal Rural", "Jayashankar Bhupalpally", "Jangaon", "Mahabubabad", "Warangal", "Siddipet", "Nirmal", "Nizamabad Rural", "Nizamabad Urban", "Bodhan", "Armoor", "Kamareddy", "Sangareddy", "Medchal", "Malkajgiri", "Kukatpally", "Uppal", "L B Nagar", "Secunderabad", "Charminar", "Malakpet", "Falaknuma", "Jubilee Hills", "Banjara Hills", "Gachibowli", "Hitech City", "Madhapur", "Kondapur", "Kukatpally", "Bachupally", "Miyapur", "Manikonda", "Nanakramguda", "Financial District", "Gachibowli", "Hitech City", "Madhapur", "Kondapur", "Jubilee Hills", "Banjara Hills", "Film Nagar", "Shaikpet", "Toli Chowki", "Masab Tank", "Mehdipatnam", "Attapur", "Rajendra Nagar", "Budwel", "Narsingi", "Kokapet", "Gandipet", "Tellapur", "Nallagandla", "Serilingampally", "Chandanagar", "Ramachandrapuram", "Patancheru", "Ameerpet", "Somajiguda", "Punjagutta", "Banjara Hills", "Jubilee Hills", "Khairatabad", "Lakdikapul", "Nampally", "Abids", "Koti", "Sultan Bazaar", "Narayanguda", "Chikkadpally", "Musheerabad", "Golconda", "Tarnaka", "Habsiguda", "Uppal", "Nacharam", "Moula Ali", "A S Rao Nagar", "Ecil", "Kapra", "Keesara", "Shamirpet", "Medchal", "Ghatkesar", "Pocharam", "Uppal", "Habsiguda", "Tarnaka", "Lalapet", "Malkajgiri", "Ammuguda", "Trimulgherry", "Secunderabad", "Bowenpally", "Karkhana", "Sikh Village", "Marredpally", "Tukaramgate", "Addagutta", "Hakimpet", "Thumkunta", "Bollaram", "Alwal", "Kompally", "Dundigal", "Quthbullapur", "Jeedimetla", "Shapur", "IDA", "Nacharam", "Uppal", "Habsiguda", "Tarnaka", "Kakatiya Nagar", "Vidya Nagar", "Adikmet", "Jamia Osmania", "Tilak Nagar", "Ramnagar", "Kachiguda", "Koti", "Sultan Bazaar", "Abids", "Nampally", "Lakdikapul", "Khairatabad", "Somajiguda", "Ameerpet", "Sanjeeva Reddy Nagar", "Balkampet", "Yousufguda", "Moosapet", "Kukatpally", "Bachupally", "Nizampet", "Pragathi Nagar", "Miyapur", "Hafeezpet", "Lingampally", "Allwyn Colony", "Gajularamaram", "Suraram", "Quthbullapur", "Jeedimetla", "Dundigal", "Kompally", "Alwal", "Bolarum", "Lal Bazar", "Malkajgiri", "Nacharam", "Uppal", "Habsiguda", "Tarnaka", "Habsiguda", "Tarnaka", "Lalapet", "Malkajgiri", "Ammuguda", "Trimulgherry", "Secunderabad", "Bowenpally", "Karkhana", "Sikh Village", "Marredpally", "Tukaramgate", "Addagutta", "Hakimpet", "Thumkunta", "Bollaram", "Alwal", "Kompally", "Dundigal", "Quthbullapur", "Jeedimetla", "Shapur", "IDA", "Nacharam", "Uppal", "Habsiguda", "Tarnaka", "Kakatiya Nagar", "Vidya Nagar", "Adikmet", "Jamia Osmania", "Tilak Nagar", "Ramnagar", "Kachiguda", "Koti", "Sultan Bazaar", "Abids", "Nampally", "Lakdikapul", "Khairatabad", "Somajiguda", "Ameerpet", "Sanjeeva Reddy Nagar", "Balkampet", "Yousufguda", "Moosapet", "Kukatpally", "Bachupally", "Nizampet", "Pragathi Nagar", "Miyapur", "Hafeezpet", "Lingampally", "Allwyn Colony", "Gajularamaram", "Suraram", "Quthbullapur", "Jeedimetla", "Dundigal", "Kompally", "Alwal", "Bolarum", "Lal Bazar", "Malkajgiri"];

function isPlausibleName(firstName?: string, lastName?: string): boolean {
  if (!firstName || !lastName) return false;
  const full = `${firstName} ${lastName}`;
  if (full.length < 3 || full.length > 60) return false;
  if (JOB_TITLE_KEYWORDS.test(full)) return false;
  if (EDUCATION_KEYWORDS.test(full)) return false;
  if (/\b(?:and|the|for|with|from|into|over|under|between|among|within|without|against|during|before|after|above|below|up|down|out|off|over|under|again|further|then|once|here|there|when|where|why|how|all|any|both|each|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|can|will|just|should|now)\b/i.test(full)) return false;
  if (/\b(?:Description|Summary|Overview|Profile|Objective|Statement|Details|Information|Experience|Skills|Projects|Education|Certifications|Achievements)\b/i.test(full)) return false;
  return true;
}

function isPlausibleCity(city?: string): boolean {
  if (!city || city.length < 2 || city.length > 50) return false;
  if (EDUCATION_KEYWORDS.test(city)) return false;
  if (FIELD_OF_STUDY_KEYWORDS.test(city)) return false;
  if (/\d/.test(city)) return false;
  return true;
}

function isPlausibleCountry(country?: string): boolean {
  if (!country || country.length < 2 || country.length > 50) return false;
  if (EDUCATION_KEYWORDS.test(country)) return false;
  if (FIELD_OF_STUDY_KEYWORDS.test(country)) return false;
  if (/\d/.test(country)) return false;
  if (COMMON_COUNTRY_NAMES.test(country)) return true;
  // Allow if it looks like a proper noun and isn't contaminated
  if (/^[A-Z][a-z]+$/.test(country)) return true;
  return false;
}

// --- Personal info extraction (from header region only) ---
function extractName(text: string): { firstName?: string; lastName?: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines.slice(0, 8)) {
    // Strip email addresses, phone numbers, prefixes, and structural keywords
    let cleaned = line
      .replace(/\S+@\S+\.\S+/g, "")
      .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
      .replace(/\b(phone|email|address|curriculum|cv)\b/gi, "")
      .replace(/^\s*(?:Dr\.?|Mr\.?|Ms\.?|Mrs\.?|Prof\.?)\s+/i, "")
      .replace(/\s*\|\s*.*$/i, "")
      .replace(/\s*[-–—]\s*.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned || cleaned.length < 3) continue;
    if (cleaned === cleaned.toUpperCase() && cleaned.match(/^[A-Z\s]+$/) && cleaned.split(/\s+/).length >= 2) {
      cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }
    const nameMatch = cleaned.match(/^([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*)\s+([A-Z][a-z]+(?:[-'][A-Za-z]+)*)\b/);
    if (nameMatch) {
      const candidate = { firstName: nameMatch[1], lastName: nameMatch[2] };
      if (isPlausibleName(candidate.firstName, candidate.lastName)) return candidate;
    }
    const lowerLastNameMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+\s+[a-z]+)\b/);
    if (lowerLastNameMatch) {
      const parts = lowerLastNameMatch[2].split(/\s+/);
      const candidate = { firstName: lowerLastNameMatch[1], lastName: parts[parts.length - 1] };
      if (isPlausibleName(candidate.firstName, candidate.lastName)) return candidate;
    }
    const threeWordMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
    if (threeWordMatch) {
      const candidate = { firstName: threeWordMatch[1], lastName: threeWordMatch[3] };
      if (isPlausibleName(candidate.firstName, candidate.lastName)) return candidate;
    }
    const threeWordLowerMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([a-z]+)\b/);
    if (threeWordLowerMatch) {
      const candidate = { firstName: threeWordLowerMatch[1], lastName: threeWordLowerMatch[3].replace(/\b\w/, c => c.toUpperCase()) };
      if (isPlausibleName(candidate.firstName, candidate.lastName)) return candidate;
    }
  }
  return {};
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : undefined;
}

function extractPhone(text: string): string | undefined {
  const patterns = [
    /\+91[-.\s]?\d{5}[-.\s]?\d{5}/,
    /\+91[-.\s]?\d{10}/,
    /\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+?\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return undefined;
}

function extractLinkedIn(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[\w-]+\/?/i);
  return match ? match[0] : undefined;
}

function extractGitHub(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i);
  return match ? match[0] : undefined;
}

function extractLocation(text: string): { city?: string; country?: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines.slice(0, 10)) {
    const locMatch = line.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    if (locMatch && !line.match(/@|phone|email|university|institute|college/i)) {
      const city = locMatch[1];
      const country = locMatch[2];
      if (isPlausibleCity(city) && isPlausibleCountry(country)) {
        return { city, country };
      }
    }
  }
  // Fallback: scan for known Indian cities in header region only
  for (const city of INDIAN_CITIES.slice(0, 30)) {
    if (text.includes(city)) {
      return { city, country: "India" };
    }
  }
  return {};
}

function extractNationality(text: string): string | undefined {
  const match = text.match(/(?:nationality|citizenship)\s*[:|–—-]\s*([A-Za-z][A-Za-z' -]{1,40})/i);
  if (!match) return undefined;
  const value = match[1].split(/[|•,;]/)[0].trim();
  return value || undefined;
}

// ============================================================
// MAIN PARSE FUNCTION (Canonical Pipeline)
// ============================================================

/**
 * Parse CV from pre-extracted document with blocks.
 * This is the canonical pipeline entry point.
 */
export function parseCVFromDocument(doc: ExtractedDocument): ParsedCV {
  const warnings: string[] = [];

  // Step 1: Header/footer deduplication
  const cleanDoc = deduplicateHeadersFooters(doc);

  // Step 2: Generic section segmentation (SINGLE SOURCE OF TRUTH)
  const sections = segmentResumeSections(cleanDoc.blocks);

  // Step 3: Extract personal info from HEADER REGION and PERSONAL section
  const headerText = getHeaderRegionText(cleanDoc.blocks);
  const personalSection = sections.find(s => s.type === "PERSONAL");
  const personalSectionText = personalSection ? personalSection.blocks.map(b => b.text).join("\n") : "";
  const combinedPersonalText = headerText + "\n" + personalSectionText;

  const nameFromHeader = extractName(headerText);
  const personal = nameFromHeader.firstName ? nameFromHeader : extractName(combinedPersonalText);
  const email = extractEmail(cleanDoc.fullText);
  const phone = extractPhone(cleanDoc.fullText);
  const linkedin = extractLinkedIn(cleanDoc.fullText);
  const github = extractGitHub(cleanDoc.fullText);
  const locFromHeader = extractLocation(headerText);
  const location = locFromHeader.city ? locFromHeader : extractLocation(combinedPersonalText);
  const nationality = extractNationality(cleanDoc.fullText);

  // Step 4: Section-specific parsing (each receives ONLY its section blocks)
  const educationSection = sections.find(s => s.type === "EDUCATION");
  const experienceSection = sections.find(s => s.type === "EXPERIENCE");
  const projectsSection = sections.find(s => s.type === "PROJECTS");
  const skillsSection = sections.find(s => s.type === "SKILLS");
  const certificationsSection = sections.find(s => s.type === "CERTIFICATIONS");
  const achievementsSection = sections.find(s => s.type === "ACHIEVEMENTS");

  const education = educationSection ? 
    (educationSection.blocks.some(b => b.metadata && b.metadata.tableId) ? 
      parseEducationTableSection(educationSection) : 
      parseEducationSection(educationSection)) 
    : [];
  const experience = experienceSection ? 
    (experienceSection.blocks.some(b => b.metadata && b.metadata.tableId) ? 
      parseExperienceTableSection(experienceSection) : 
      parseExperienceSection(experienceSection)) 
    : [];
  const projects = projectsSection ? parseProjectsSection(projectsSection) : [];
  const skills = skillsSection ? parseSkillsSection(skillsSection) : {
    technical: [], programming: [], tools: [], software: [], domain: [], soft: []
  };
  const certifications = certificationsSection ? parseCertificationsSection(certificationsSection) : [];
  const achievements = achievementsSection ? parseAchievementsSection(achievementsSection) : [];

  // Warnings
  if (!personal.firstName) warnings.push("Could not detect name. Please enter manually.");
  if (!email) warnings.push("Could not detect email. Please enter manually.");
  if (!phone) warnings.push("Could not detect phone. Please enter manually.");
  if (education.length === 0) warnings.push("No education records detected.");
  if (experience.length === 0) warnings.push("No work experience detected.");
  if (projects.length === 0) warnings.push("No projects detected.");
  if (skills.technical.length + skills.programming.length + skills.tools.length + skills.software.length === 0) {
    warnings.push("No skills detected.");
  }

  return {
    personalData: {
      firstName: personal.firstName,
      lastName: personal.lastName,
      email,
      phone,
      currentCity: location.city,
      currentCountry: location.country,
      nationality,
      linkedin,
      github,
    },
    education,
    experience,
    projects,
    skills,
    certifications,
    achievements,
    rawTextLength: cleanDoc.fullText.length,
    parseWarnings: [...warnings, ...cleanDoc.warnings],
    parserMeta: {
      engine: cleanDoc.extractor as "legacy" | "docling" | "rapidocr" | "pdf-parse" | "mammoth",
      ocrUsed: cleanDoc.ocrUsed,
      parsedAt: new Date().toISOString(),
    },
  };
}

/**
 * Full pipeline: extract canonical blocks from file buffer, then parse.
 */
export async function parseCVFile(buffer: Buffer, filename: string): Promise<ParsedCV> {
  let canonicalDoc: CanonicalExtractedDocument;
  try {
    canonicalDoc = await extractCanonicalBlocks(buffer, filename);
  } catch (extractError: any) {
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf") {
      throw createCVParseFailure("CORRUPT_OR_UNREADABLE_PDF", extractError?.message);
    }
    throw createCVParseFailure("PARSE_FAILED", extractError?.message);
  }

  // Check for insufficient text
  const totalChars = canonicalDoc.blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (totalChars <= NEAR_EMPTY_TEXT_LENGTH) {
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf") {
      throw createCVParseFailure("IMAGE_ONLY_PDF");
    }
    throw createCVParseFailure("INSUFFICIENT_TEXT");
  }

  if (totalChars < MIN_CV_TEXT_LENGTH) {
    throw createCVParseFailure("INSUFFICIENT_TEXT");
  }

// Convert canonical blocks to the format expected by parseCVFromDocument
    const doc: ExtractedDocument = {
      blocks: canonicalDoc.blocks.map(b => ({
        text: b.text,
        page: b.page,
        bbox: b.bbox ? { x0: b.bbox!.l, y0: b.bbox!.t, x1: b.bbox!.r, y1: b.bbox!.b } : undefined,
        fontSize: b.style?.fontSize,
        isBold: b.style?.isBold,
        isItalic: b.style?.isItalic,
        fontName: b.style?.fontName,
        columnIndex: undefined,
        blockType: b.blockType.toLowerCase() as any,
        order: b.order,
        row: b.row,
        column: b.column,
        metadata: b.metadata,
      })),
      fullText: canonicalDoc.blocks.map(b => b.text).join("\n"),
      pageCount: canonicalDoc.pageCount,
      extractor: canonicalDoc.sourceStrategy,
      ocrUsed: canonicalDoc.ocrUsed,
      warnings: canonicalDoc.extractionWarnings,
    };

  return parseCVFromDocument(doc);
}

/**
 * Legacy function for backward compatibility - parses plain text.
 * Uses the new canonical pipeline internally.
 */
export function parseCVText(text: string): ParsedCV {
  const blocks = text.split("\n").map((line: string, idx: number) => ({
    text: line,
    page: 1,
    blockType: "paragraph" as const,
  }));
  const doc: ExtractedDocument = {
    blocks,
    fullText: text,
    pageCount: 1,
    extractor: "legacy",
    ocrUsed: false,
    warnings: [],
  };
  return parseCVFromDocument(doc);
}

/**
 * Fallback PDF text extraction for when Docling is unavailable.
 * Returns plain text string (no layout information).
 * Used only in extraction fallback scenarios.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfParseModule: any = await import("pdf-parse");

  // v1.x API: default export is a function
  if (typeof pdfParseModule === "function" || typeof pdfParseModule.default === "function") {
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const data = await pdfParse(buffer);
    return data.text || "";
  }

  // v2.x API: PDFParse class
  if (pdfParseModule.PDFParse) {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    await parser.load();
    const result = await parser.getText();
    // v2.x returns { text, pages, total } — extract the combined text
    // Strip pdf-parse's page separator markers (e.g. "\n\n-- 1 of 1 --\n\n")
    if (result && typeof result.text === "string") {
      return result.text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").trim();
    }
    if (typeof result === "string") return result;
    return "";
  }

  throw new Error("Unsupported pdf-parse API version");
}