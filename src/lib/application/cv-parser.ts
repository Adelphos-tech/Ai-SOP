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
  blockType?: "paragraph" | "heading" | "table" | "list" | "header" | "footer";
  order?: number;
  row?: number | null;
  column?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDocument {
  blocks: TextBlock[];
  fullText: string;
  pageCount: number;
  extractor: "legacy" | "native" | "docling" | "rapidocr" | "pdf-parse" | "mammoth" | "mammoth_html" | "ocr" | "mixed" | "txt";
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
  EDUCATION: ["education", "academic background", "qualifications", "scholastic record", "academic qualifications", "educational background"],
  EXPERIENCE: ["experience", "employment", "work history", "professional experience", "career history", "career journey", "work experience", "employment history", "work", "professional history", "career experience", "professional career", "academic appointments", "teaching experience", "research experience"],
  PROJECTS: ["projects", "personal projects", "academic projects", "key projects", "project experience", "proof of work", "portfolio", "selected projects", "key projects", "major projects", "project highlights", "initiatives", "selected initiatives", "key initiatives", "major initiatives"],
  SKILLS: ["skills", "technical skills", "core competencies", "technologies", "tech stack", "expertise", "competencies"],
  CERTIFICATIONS: ["certifications", "certificates", "licenses", "certified courses", "professional certifications", "credentials", "licences"],
  ACHIEVEMENTS: ["achievements", "awards", "honors", "honours", "accomplishments", "recognitions", "awards and honors", "grants & awards", "grants and awards"],
  PERSONAL: ["personal information", "personal details", "contact", "contact information"],
  SUMMARY: ["summary", "objective", "profile", "professional summary", "career objective", "about me", "executive profile", "career overview", "professional summary"],
  UNKNOWN_SECTION: [], // Never matched directly
};

// Set of known heading keywords (lowercase, no colon) for quick lookup in heading detection
const KNOWN_HEADING_KEYWORDS_SET = new Set<string>([
  "education", "experience", "projects", "skills", "certifications", "achievements",
  "academic background", "qualifications", "scholastic record", "academic qualifications", "educational background",
  "employment", "work history", "professional experience", "career history", "career journey", "work experience", "employment history", "work", "professional history", "career experience", "professional career", "academic appointments", "teaching experience", "research experience",
  "personal projects", "academic projects", "key projects", "project experience", "proof of work", "portfolio",
  "selected projects", "key projects", "major projects", "project highlights",
  "initiatives", "selected initiatives", "key initiatives", "major initiatives",
  "technical skills", "core competencies", "technologies", "tech stack", "expertise", "competencies",
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
  if (text.match(/^(?:Company|Role|Dates|Location|Impact|Qualification|Institution|Year|Result|Selected)\s*[\/\|]/i)) return false;
  if (text.match(/^(?:Company|Role|Dates|Location|Impact|Qualification|Institution|Year|Result|Selected)$/i)) return false;
  
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

  // If no sections found at all, treat entire document as one UNKNOWN section
  // This handles documents with no detectable headings
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

// --- Education parser (receives ONLY education section blocks) ---
function parseEducationSection(section: Section): ParsedEducation[] {
  const education: ParsedEducation[] = [];
  const blocks = section.blocks;
  const text = blocks.map(b => b.text).join("\n");
  
  // Split on newlines AND common multi-entry delimiters like | 
  // Many resumes pack multiple education entries on one line separated by |
  const rawLines = text.split(/\n|\|/).map(l => l.trim()).filter(l => l.length > 0);
  
  // Further split lines that contain multiple entries concatenated without delimiter
  // e.g., "Degree - Institution | 2020 Degree - Institution | 2018"
  const lines: string[] = [];
  for (const line of rawLines) {
    // Split on patterns like "Degree - Institution | Year Degree - Institution"
    // Look for degree keywords followed by another degree keyword pattern
    const segments = line.split(/(?=(?:B\.?Tech\.?|B\.?E\.?|Bachelor|M\.?Tech\.?|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master|Ph\.?D\.?|Doctorate|Diploma|12th|10th|Senior Secondary|Secondary|SSLC|SSC|Executive MBA|M\.Sc\.|M\.Tech|B\.Sc\.|B\.E\.)\s)/i).filter(s => s.trim().length > 0);
    for (const seg of segments) {
      lines.push(seg.trim());
    }
  }

  // Degree keywords - word-bounded
  const degreeKeywords = /(?<![A-Za-z0-9])(?:B\.?Tech\.?|B\.?E\.?|Bachelor|M\.?Tech\.?|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master|Ph\.?D\.?|Doctorate|Diploma|12th|10th|Senior Secondary|Secondary|SSLC|SSC)(?![A-Za-z0-9])/i;

  // Institution keywords - word-bounded
  const institutionKeywords = /(?<![A-Za-z0-9])(?:University|Institute|College|School|IIT|NIT|IIIT|BITS|VIT|MIT|Stanford|Harvard|Oxford|Cambridge|Polytechnic|Board)(?![A-Za-z0-9])/i;

  let currentEdu: Partial<ParsedEducation> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";

    const hasDegree = !/\bboard\b/i.test(line) && degreeKeywords.test(line);
    const hasInstitution = institutionKeywords.test(line);

    if (hasDegree || hasInstitution) {
      if (currentEdu && (currentEdu.institution || currentEdu.degree)) {
        education.push({
          id: generateId(),
          institution: currentEdu.institution || "",
          degree: currentEdu.degree || "",
          specialization: currentEdu.specialization || "",
          startYear: currentEdu.startYear || "",
          endYear: currentEdu.endYear || "",
          cgpa: currentEdu.cgpa || "",
          cgpaScale: currentEdu.cgpaScale || "10",
        });
      }
      currentEdu = {};

      const degreeInInstMatch = line.match(/^([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?)\s+(?:in|of)\s+([A-Za-z\s&+]+),\s*(.+)$/);
      if (degreeInInstMatch) {
        currentEdu.degree = degreeInInstMatch[1].trim();
        currentEdu.specialization = degreeInInstMatch[2].trim();
        currentEdu.institution = degreeInInstMatch[3].trim();
      } else {
        const parts = line.split(",").map(p => p.trim());
        if (parts.length >= 2) {
          currentEdu.degree = parts[0].split(/\s+(?:in|of)\s+/)[0].trim();
          const specMatch = parts[0].match(/(?:in|of)\s+(.+)/i);
          if (specMatch) currentEdu.specialization = specMatch[1].trim();
          currentEdu.institution = parts[parts.length - 1];
        } else {
          if (hasDegree) currentEdu.degree = line.match(degreeKeywords)?.[0] || line;
          if (hasInstitution) currentEdu.institution = line;
        }
      }
    }

    if (currentEdu) {
      const yearMatch = (line + " " + nextLine).match(/((?:20|19)\d{2})\s*(?:-|–|to)\s*((?:20|19)\d{2}|present|current|ongoing)/i);
      if (yearMatch && !currentEdu.startYear) {
        currentEdu.startYear = yearMatch[1];
        currentEdu.endYear = yearMatch[2]?.match(/\d{4}/)?.[0] || "";
      }

      const cgpaMatch = line.match(/(?:CGPA|GPA|CPI|SGPA|Percentage)\s*[:=\-–—]?\s*(\d+\.?\d*)\s*(?:\/|out of|%)?\s*(\d+\.?\d*)?/i);
      if (cgpaMatch) {
        currentEdu.cgpa = cgpaMatch[1];
        if (cgpaMatch[2]) currentEdu.cgpaScale = cgpaMatch[2];
      }
    }
  }

  if (currentEdu && (currentEdu.institution || currentEdu.degree)) {
    education.push({
      id: generateId(),
      institution: currentEdu.institution || "",
      degree: currentEdu.degree || "",
      specialization: currentEdu.specialization || "",
      startYear: currentEdu.startYear || "",
      endYear: currentEdu.endYear || "",
      cgpa: currentEdu.cgpa || "",
      cgpaScale: currentEdu.cgpaScale || "10",
    });
  }

  // Merge adjacent fragmented records
  const merged: ParsedEducation[] = [];
  for (let i = 0; i < education.length; i++) {
    const current = education[i];
    const next = education[i + 1];
    if (
      next &&
      ((current.degree && !current.institution && next.institution && !next.degree) ||
       (!current.degree && current.institution && next.degree && !next.institution))
    ) {
      merged.push({
        id: current.id,
        institution: current.institution || next.institution,
        degree: current.degree || next.degree,
        specialization: current.specialization || next.specialization || "",
        startYear: current.startYear || next.startYear || "",
        endYear: current.endYear || next.endYear || "",
        cgpa: current.cgpa || next.cgpa || "",
        cgpaScale: current.cgpaScale || next.cgpaScale || "10",
      });
      i++;
    } else {
      merged.push(current);
    }
  }

  return merged.filter(e => !(e.degree === "" && /\bboard\b/i.test(e.institution)));
}

// --- Education table parser (for table-aware structured data) ---
export function parseEducationTableSection(section: Section): ParsedEducation[] {
  const education: ParsedEducation[] = [];
  
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
      
      // Expect: Qualification, Institution, Year, Result
      if (cells[0] !== undefined && cells[1] !== undefined && cells[2] !== undefined && cells[3] !== undefined) {
        const qualification = cells[0] || "";
        const institution = cells[1] || "";
        const year = cells[2] || "";
        const result = cells[3] || "";
        
        education.push({
          id: generateId(),
          institution: institution,
          degree: qualification,
          specialization: "",
          startYear: "",
          endYear: "",
          cgpa: "",
          cgpaScale: "",
        });
      }
    }
  }
  
  return education;
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

// ============================================================
// EXPERIENCE PARSER (receives ONLY experience section blocks)
// ============================================================
function parseExperienceSection(section: Section): ParsedExperience[] {
  const experience: ParsedExperience[] = [];
  const blocks = section.blocks;
  const text = blocks.map(b => b.text).join("\n");
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  let currentExp: Partial<ParsedExperience> | null = null;

// Date regex that captures: [month] year - [month] year/present
// Handles: 
//   "2022 - Present", "Jan 2024 - Present", "2022 - 2024", "Jan 2022 - Mar 2024"
//   "05/2020 - 08/2020", "05/2020 - Present"
// Supported separators: - – to
const dateRegex = /(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?((?:20|19)\d{2})|(?:\d{2})\/((?:20|19)\d{2}))\s*(?:-|–|to)\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?((?:20|19)\d{2})|(?:\d{2})\/((?:20|19)\d{2})|present|current|ongoing)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(dateRegex);
    const titleMatch = line.match(/(?:intern|engineer|developer|analyst|consultant|manager|designer|researcher|assistant|associate|lead|architect|specialist|officer|trainee|director|vp|vice president|head|chief)/i);
    const companyMatch = line.match(/(?:at|@|\|\s*)\s*([A-Z][A-Za-z0-9\s&.,]+)/);
    const roleCompanyMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);

    // Check if this line is a date-only line (has date but no clear role/org header)
    const isDateOnlyLine = dateMatch && !titleMatch && !companyMatch && !roleCompanyMatch;

    if (dateMatch) {
      // MULTILINE HEADER GROUPING (check BEFORE pushing):
      // If we have a pending entry with role/org but no dates, and this line has dates,
      // merge the dates into the existing entry instead of creating a new one.
      const shouldMerge = currentExp && (currentExp.role || currentExp.organization) && !currentExp.startDate;
      
      if (!shouldMerge) {
        // No merge - save previous entry if exists
        if (currentExp && currentExp.organization) {
          experience.push({
            id: generateId(),
            type: currentExp.type || "Full-time Job",
            organization: currentExp.organization || "",
            role: currentExp.role || "",
            location: currentExp.location || "",
            startDate: currentExp.startDate || "",
            endDate: currentExp.endDate || "",
            currentlyWorking: currentExp.currentlyWorking || false,
            responsibilities: currentExp.responsibilities || "",
          });
        }
      }

      if (shouldMerge && currentExp) {
        // This date line belongs to the pending entry
        const headerText = line.replace(dateRegex, "").replace(/[\s\-–—|,;:]+$/, "").trim();
        
        // Extract location from header if present (after | or similar)
        let extractedLocation = "";
        if (headerText) {
          const locMatch = headerText.match(/\|\s*([^|]+)$/);
          if (locMatch) {
            extractedLocation = locMatch[1].trim();
          }
        }
        
        // Normalize date tokens to canonical format (YYYY-MM or YYYY)
        const { startDate, endDate } = normalizeExperienceDates(
          dateMatch[0], dateMatch[1], dateMatch[2], dateMatch[3], dateMatch[4], dateMatch[5]
        );
        
        currentExp.startDate = startDate;
        currentExp.endDate = endDate;
        currentExp.currentlyWorking = /present|current|ongoing/i.test(endDate || "");
        if (extractedLocation) currentExp.location = extractedLocation;
      } else {
        // No pending role/org entry - create new entry from this date line
        // BEFORE creating new entry: extract role/org from the non-date portion of THIS line
        // Remove the date range from the line to isolate the header
        const headerText = line.replace(dateRegex, "").replace(/[\s\-–—|,;:]+$/, "").trim();
        
        // Extract role and organization from header
        let extractedRole = "";
        let extractedOrg = "";
        let extractedLocation = "";

        if (headerText) {
          // Check for "at Company" or "Company |" pattern in header
          const headerCompanyMatch = headerText.match(/(?:at|@|\|\s*)\s*([A-Z][A-Za-z0-9\s&.,]+)/);
          if (headerCompanyMatch) {
            extractedOrg = headerCompanyMatch[1].trim();
            // Role is everything before the company marker
            const beforeCompany = headerText.split(/(?:at|@|\|\s*)/)[0].trim();
            if (beforeCompany && !beforeCompany.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{4}/i)) {
              extractedRole = beforeCompany;
            }
          } else {
            // Check for "Role - Company" pattern
            const hRoleCompanyMatch = headerText.match(/^(.+?)\s*[-–—]\s*(.+)$/);
            if (hRoleCompanyMatch && !headerText.startsWith("•") && !headerText.startsWith("-") && !headerText.startsWith("*")) {
              extractedRole = hRoleCompanyMatch[1].trim();
              extractedOrg = hRoleCompanyMatch[2].trim();
            } else if (titleMatch) {
              // Title keyword present - use whole header as role if no clear org
              extractedRole = headerText;
            }
          }
          
          // Extract location if present after |
          const locMatch = headerText.match(/\|\s*([^|]+)$/);
          if (locMatch) {
            extractedLocation = locMatch[1].trim();
          }
        }

        // Start new entry with date + any extracted role/org
        const { startDate, endDate } = normalizeExperienceDates(
          dateMatch[0], dateMatch[1], dateMatch[2], dateMatch[3], dateMatch[4], dateMatch[5]
        );
        
        currentExp = {
          startDate: startDate,
          endDate: endDate,
          currentlyWorking: /present|current|ongoing/i.test(endDate || ""),
          role: extractedRole || undefined,
          organization: extractedOrg || undefined,
          location: extractedLocation || undefined,
        };
      }
    } else if (titleMatch && !currentExp) {
      // Title line without date - start new entry (fallback)
      currentExp = {};
    } else if (titleMatch && currentExp && !currentExp.organization && !dateMatch && !line.startsWith("•") && !line.startsWith("-") && !line.startsWith("*")) {
      // We have a pending entry with dates but no org, and this line has a title+org
      // This is the multiline header case: role/org line followed by date line
      // OR date line followed by role/org line - merge them
      if (currentExp.startDate && !currentExp.organization) {
        // Extract org from this line
        if (companyMatch) {
          currentExp.organization = companyMatch[1].trim();
        }
        if (roleCompanyMatch && !currentExp.role) {
          currentExp.role = roleCompanyMatch[1].trim();
          if (!currentExp.organization) currentExp.organization = roleCompanyMatch[2].trim();
        } else if (!currentExp.role) {
          currentExp.role = line.split(/\s+at\s+|\s*@\s*|\s*\|\s*/)[0].trim();
        }
      }
    }

    if (currentExp) {
      // Extract role from title line (line without date that has title keywords)
      if (titleMatch && !currentExp.role && !dateMatch) {
        currentExp.role = line.split(/\s+at\s+|\s*@\s*|\s*\|\s*/)[0].trim();
      }
      // Extract company from "at Company" or "Company |" pattern
      if (companyMatch && !currentExp.organization) {
        currentExp.organization = companyMatch[1].trim();
      }
      // Also check for "Role - Company" pattern in lines without date
      if (!currentExp.organization && !dateMatch) {
        const roleCompanyMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if (roleCompanyMatch && !line.startsWith("•") && !line.startsWith("-") && !line.startsWith("*")) {
          if (!currentExp.role) currentExp.role = roleCompanyMatch[1].trim();
          if (!currentExp.organization) currentExp.organization = roleCompanyMatch[2].trim();
        }
      }
      if (/intern/i.test(line) && !currentExp.type) {
        currentExp.type = "Internship";
      }
      // Accumulate bullet points as responsibilities
      if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
        const desc = line.replace(/^[•\-*]\s*/, "");
        if (currentExp.responsibilities) {
          currentExp.responsibilities += " " + desc;
        } else {
          currentExp.responsibilities = desc;
        }
      }
    }
  }

  if (currentExp && currentExp.organization) {
    experience.push({
      id: generateId(),
      type: currentExp.type || "Full-time Job",
      organization: currentExp.organization || "",
      role: currentExp.role || "",
      location: currentExp.location || "",
      startDate: currentExp.startDate || "",
      endDate: currentExp.endDate || "",
      currentlyWorking: currentExp.currentlyWorking || false,
      responsibilities: currentExp.responsibilities || "",
    });
  }

  return experience;
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

// --- Personal info extraction (from first section / whole doc) ---
function extractName(text: string): { firstName?: string; lastName?: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines.slice(0, 5)) {
    if (line.match(/@|phone|email|address|curriculum|cv\b/i)) continue;
    let cleaned = line.replace(/\s*\|\s*.*$/i, "").replace(/\s*[-–—]\s*.*$/i, "").trim();
    if (!cleaned || cleaned.length < 3) continue;
    if (cleaned === cleaned.toUpperCase() && cleaned.match(/^[A-Z\s]+$/) && cleaned.split(/\s+/).length >= 2) {
      cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }
    const nameMatch = cleaned.match(/^([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*)\s+([A-Z][a-z]+(?:[-'][A-Za-z]+)*)$/);
    if (nameMatch) {
      return { firstName: nameMatch[1], lastName: nameMatch[2] };
    }
    const lowerLastNameMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+\s+[a-z]+)$/);
    if (lowerLastNameMatch) {
      const parts = lowerLastNameMatch[2].split(/\s+/);
      return { firstName: lowerLastNameMatch[1], lastName: parts[parts.length - 1] };
    }
    const threeWordMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)$/);
    if (threeWordMatch) {
      return { firstName: threeWordMatch[1], lastName: threeWordMatch[3] };
    }
    const threeWordLowerMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([a-z]+)$/);
    if (threeWordLowerMatch) {
      return { firstName: threeWordLowerMatch[1], lastName: threeWordLowerMatch[3].replace(/\b\w/, c => c.toUpperCase()) };
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
      return { city: locMatch[1], country: locMatch[2] };
    }
  }
  const indianCities = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Surat", "Jaipur"];
  for (const city of indianCities) {
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

  // Step 3: Extract personal info from full text (first page area)
  const fullText = cleanDoc.fullText;
  const personal = extractName(fullText);
  const email = extractEmail(fullText);
  const phone = extractPhone(fullText);
  const linkedin = extractLinkedIn(fullText);
  const github = extractGitHub(fullText);
  const location = extractLocation(fullText);
  const nationality = extractNationality(fullText);

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