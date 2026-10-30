// ============================================================
// CV EXTRACTION LAYER - Canonical Block Model & Router
// ============================================================
// Provides a unified extraction interface that routes to the
// appropriate backend (native, Docling, RapidOCR) and returns
// canonical ordered structural blocks for the downstream parser.
// ============================================================

import { Buffer } from "buffer";
import * as cheerio from 'cheerio';
import { MONTH_NAME_TO_NUM, Section, ParsedExperience, generateId } from './cv-parser';

/** Canonical block types */
export type CanonicalBlockType =
  | "PARAGRAPH"
  | "HEADING"
  | "TABLE_CELL"
  | "TABLE_ROW"
  | "LIST_ITEM"
  | "TEXTBOX"
  | "OCR_BLOCK"
  | "UNKNOWN"
  | "HEADER"
  | "FOOTER";

/** Bounding box: [left, top, right, bottom] in points (1/72 inch) or pixels */
export interface BoundingBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Style metadata for heading detection */
export interface BlockStyle {
  fontSize?: number;
  isBold?: boolean;
  isItalic?: boolean;
  fontName?: string;
  fontColor?: string;
}

/** Canonical extraction block - all extractors normalize to this shape */
export interface CanonicalBlock {
  text: string;
  page: number;              // 1-indexed page number
  order: number;             // global reading order index
  blockType: CanonicalBlockType;
  bbox?: BoundingBox | null;
  row?: number | null;       // for table cells
  column?: number | null;    // for table cells
  style?: BlockStyle | null;
  sourceStrategy: "native" | "docling" | "rapidocr" | "mammoth" | "mammoth_html" | "unstructured";
  confidence: number;        // 0-1
  metadata?: Record<string, unknown>;
}

/** Extracted document with canonical blocks */
export interface CanonicalExtractedDocument {
  blocks: CanonicalBlock[];
  pageCount: number;
  ocrUsed: boolean;
  sourceStrategy: "native" | "docling" | "rapidocr" | "mammoth" | "mammoth_html" | "mixed" | "unstructured";
  extractionWarnings: string[];
  durationMs: number;
  sourceHash: string;
}

/** Quality signals for routing decisions */
export interface ExtractionQualitySignals {
  totalChars: number;
  charsPerPage: number[];
  emptyPages: number;
  totalPages: number;
  tableIndicators: number;
  interleavedColumns: boolean;
  repeatedFragments: number;
  avgBlockLength: number;
  hasLayoutMetadata: boolean;
  suspiciousReadingOrder: boolean;
}

/** Routing decision */
export type ExtractionRoute =
  | { strategy: "mammoth"; reason: string }
  | { strategy: "mammoth_html"; reason: string }
  | { strategy: "docling-native"; reason: string }
  | { strategy: "docling-ocr"; reason: string }
  | { strategy: "rapidocr"; reason: string }
  | { strategy: "mixed-native-ocr"; reason: string; ocrPages: number[] }
  | { strategy: "unstructured"; reason: string };

/** Detailed extraction strategy type */
export type ExtractionStrategyType =
  | "mammoth"
  | "mammoth_html"
  | "docling-native"
  | "docling-ocr"
  | "rapidocr"
  | "mixed-native-ocr"
  | "unstructured"
  | "native";

/** Docling service endpoints */
const DOCLING_BASE_URL = process.env.CV_PARSER_SERVICE_URL || "http://127.0.0.1:8099";

// ============================================================
// EXTRACTION QUALITY ASSESSMENT
// ============================================================

/**
 * Assess extraction quality signals from native/Docling blocks
 * to determine if fallback is needed.
 */
function assessExtractionQuality(
  blocks: CanonicalBlock[],
  pageCount: number
): ExtractionQualitySignals {
  const charsPerPage: number[] = new Array(pageCount).fill(0);
  let totalChars = 0;
  let tableIndicators = 0;
  let repeatedFragments = 0;
  let blockLengths: number[] = [];

  const textGroups = new Map<string, number>();
  
  for (const block of blocks) {
    const pageIdx = block.page - 1;
    if (pageIdx >= 0 && pageIdx < pageCount) {
      charsPerPage[pageIdx] += block.text.length;
    }
    totalChars += block.text.length;
    blockLengths.push(block.text.length);

    if (block.blockType === "TABLE_ROW" || block.blockType === "TABLE_CELL" || 
      (block.blockType === "PARAGRAPH" && block.metadata && block.metadata.tableId)) {
      tableIndicators++;
    }

    // Track repeated short fragments (header/footer candidates)
    const normalized = block.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (normalized.length >= 10) {
      textGroups.set(normalized, (textGroups.get(normalized) || 0) + 1);
    }
  }

  // Count repeated fragments across pages
  textGroups.forEach((count) => {
    if (count >= 2) repeatedFragments++;
  });

   // Detect interleaved columns (high variance in block x-positions on same page)
   let interleavedColumns = false;
   if (blocks.some(b => b.bbox)) {
     const pageBlocks = new Map<number, CanonicalBlock[]>();
     for (const block of blocks) {
       if (!pageBlocks.has(block.page)) pageBlocks.set(block.page, []);
       pageBlocks.get(block.page)!.push(block);
     }

     for (const [, pageBlocksList] of pageBlocks) {
       const withBbox = pageBlocksList.filter(b => b.bbox);
       if (withBbox.length >= 4) {
         // Check if there are two distinct column regions
         const lefts = withBbox.map(b => b.bbox!.l).sort((a, b) => a - b);
         const median = lefts[Math.floor(lefts.length / 2)];
         const leftCount = lefts.filter(l => l < median * 0.8).length;
         const rightCount = lefts.filter(l => l > median * 1.2).length;
         if (leftCount >= 2 && rightCount >= 2) {
           interleavedColumns = true;
         }
       }
     }
   }

  const emptyPages = charsPerPage.filter(c => c < 50).length;
  const avgBlockLength = blockLengths.length > 0 
    ? blockLengths.reduce((a, b) => a + b, 0) / blockLengths.length 
    : 0;
  
  const hasLayoutMetadata = blocks.some(b => b.bbox || b.row !== undefined || b.column !== undefined);
  const suspiciousReadingOrder = interleavedColumns || (blocks.length > 0 && avgBlockLength < 20);

  return {
    totalChars,
    charsPerPage,
    emptyPages,
    totalPages: pageCount,
    tableIndicators,
    interleavedColumns,
    repeatedFragments,
    avgBlockLength,
    hasLayoutMetadata,
    suspiciousReadingOrder,
  };
}

/**
 * Determine extraction route based on file type and quality signals.
 * Called AFTER initial native/Docling extraction.
 */
function decideExtractionRoute(
  format: "pdf" | "docx" | "txt",
  quality: ExtractionQualitySignals,
  nativeBlocks: CanonicalBlock[]
): ExtractionRoute {
  // TXT always passes through
  if (format === "txt") {
    return { strategy: "mammoth", reason: "TXT format uses native extraction" };
  }

  // DOCX routing
  if (format === "docx") {
    // Mammoth HTML extraction handles tables natively via Cheerio.
    // Only fall back to Docling if Mammoth HTML extraction fails or yields poor quality.
    // This preserves the proven Mammoth HTML + Cheerio table-aware architecture.
    if (quality.tableIndicators > 0 && quality.hasLayoutMetadata) {
      return { 
        strategy: "mammoth_html", 
        reason: "DOCX with tables extracted successfully via Mammoth HTML" 
      };
    }
    // Simple DOCX - mammoth HTML extraction is acceptable
    return { strategy: "mammoth_html", reason: "DOCX without complex tables uses Mammoth HTML extraction" };
  }

    // PDF routing
    if (format === "pdf") {
      // Image-only or near-empty
      if (quality.totalChars <= 10 || quality.emptyPages === quality.totalPages) {
        return { strategy: "rapidocr", reason: "PDF appears image-only or scanned" };
      }

      // Mixed document: some pages healthy, some need OCR
      const ocrPages: number[] = [];
      for (let i = 0; i < quality.charsPerPage.length; i++) {
        if (quality.charsPerPage[i] < 50) {
          ocrPages.push(i + 1);
        }
      }

      if (ocrPages.length > 0 && ocrPages.length < quality.totalPages) {
        return { 
          strategy: "mixed-native-ocr", 
          reason: `Mixed PDF: ${ocrPages.length}/${quality.totalPages} pages need OCR`,
          ocrPages
        };
      }

      // All pages need OCR
      if (ocrPages.length === quality.totalPages) {
        return { strategy: "rapidocr", reason: "All PDF pages appear scanned/image-only" };
      }

      // Suspicious reading order (multi-column, etc.) -> use Docling
      if (quality.suspiciousReadingOrder || quality.interleavedColumns) {
        return { 
          strategy: "docling-native", 
          reason: "PDF has suspicious reading order or multi-column layout" 
        };
      }

      // Structural extraction fallback -> use Unstructured
      return { 
        strategy: "unstructured", 
        reason: "Using Unstructured OSS for structural preservation" 
      };

      // Simple text PDF - native extraction sufficient
      return { strategy: "docling-native", reason: "Text-based PDF with healthy extraction" };
    }

  return { strategy: "docling-native", reason: "Default to Docling" };
}

// ============================================================
// UNSTRUCTURED OSS STRUCTURAL EXTRACTION (for PDF)
// ============================================================

/**
 * Extract ordered structural elements from PDF using Unstructured OSS.
 * Preserves document structure and reading order.
 * Does NOT perform CV semantic parsing - that remains in D-Vivid.
 */
async function extractWithUnstructured(buffer: Buffer, filename: string): Promise<CanonicalExtractedDocument> {
  // This is a Node.js environment - we need to call Python via subprocess
  // or use a native Node.js port. For now, we use a temporary file approach.
  const { writeFile, unlink } = await import("fs/promises");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const { randomBytes } = await import("crypto");
  const { spawn } = await import("child_process");
  
  const tmpFile = join(tmpdir(), `cv-${randomBytes(8).toString("hex")}.pdf`);
  
  try {
    await writeFile(tmpFile, buffer);
    
    // Call Unstructured via Python subprocess
    const elements = await new Promise<any[]>((resolve, reject) => {
      const pythonScript = `
import sys
import json
import warnings
import os

# Suppress all warnings
warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import ssl
ssl._create_default_https_context = ssl._create_unverified_context

# Redirect stderr to devnull to suppress any C-level output
import sys
# sys.stderr = open(os.devnull, 'w')

import unstructured.partition.pdf as partition_pdf

file_path = sys.argv[1]
elements = partition_pdf.partition_pdf(filename=file_path)
result = []
for el in elements:
    d = {
        "type": type(el).__name__,
        "text": getattr(el, "text", ""),
        "page_number": getattr(el.metadata, "page_number", 1) if hasattr(el, "metadata") else 1,
    }
    result.append(d)
json.dump(result, sys.stdout, separators=(',', ':'))
sys.stdout.flush()
`;
      const py = spawn("python3", ["-c", pythonScript, tmpFile], {
        env: {
          ...process.env,
          PYTHONWARNINGS: "ignore",
          TRANSFORMERS_VERBOSITY: "error",
          TOKENIZERS_PARALLELISM: "false",
        },
      });
      let stdout = "";
      let stderr = "";
      py.stdout.on("data", (data) => { stdout += data.toString(); });
      py.stderr.on("data", (data) => { stderr += data.toString(); });
      py.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Unstructured extraction failed: ${stderr}`));
        } else {
          // Filter out non-JSON lines from stdout (e.g., warnings)
          const lines = stdout.trim().split('\n');
          let jsonLine = '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              jsonLine = trimmed;
              break;
            }
          }
          if (!jsonLine) {
            reject(new Error(`No JSON found in Unstructured output: ${stdout}`));
            return;
          }
          try {
            const parsed = JSON.parse(jsonLine);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Unstructured output: ${jsonLine}`));
          }
        }
      });
    });
    
    // Convert Unstructured elements to D-Vivid canonical blocks
    const blocks: CanonicalBlock[] = elements.map((el, idx) => {
      // Map Unstructured element types to canonical block types
      let blockType: CanonicalBlockType = "PARAGRAPH";
      if (el.type === "Title") blockType = "HEADING";
      else if (el.type === "ListItem") blockType = "LIST_ITEM";
      else if (el.type === "Header") blockType = "HEADER";
      else if (el.type === "Footer") blockType = "FOOTER";
      else if (el.type === "NarrativeText") blockType = "PARAGRAPH";
      else if (el.type === "Text") blockType = "PARAGRAPH";
      
      return {
        text: el.text || "",
        page: el.page_number || 1,
        order: idx,
        blockType,
        bbox: null,
        row: null,
        column: null,
        style: null,
        sourceStrategy: "unstructured" as const,
        confidence: 0.8,
        metadata: { unstructuredType: el.type },
      };
    })
    // Generic filter: exclude Header/Footer elements that are page artifacts
    // (page numbers, repeated document identifiers, empty content)
    // Do NOT filter section headings that Unstructured may misclassify as Header/Footer.
    .filter(b => {
      // Keep all non-Header/Footer elements
      if (b.blockType !== "HEADER" && b.blockType !== "FOOTER") return true;
      
      // For Header/Footer elements, filter only clear page artifacts
      const text = b.text.trim().toLowerCase();
      
      // Filter: page numbers (generic pattern)
      if (/^page\s+\d+$/i.test(text)) return false;  // exact "Page N" pattern
      
      // Filter: very short text (likely page artifacts)
      if (text.length <= 3) return false;
      
      // Filter: repeated document identifiers (appears on multiple pages)
      // We can't easily detect multi-page repetition here, but we can
      // filter out very short repetitive text
      if (text.length <= 10 && /^(page|synthetic|fixture)/i.test(text)) return false;
      
      // Keep section headings that Unstructured may misclassify as Header/Footer
      // These typically have meaningful length and semantic content
      return true;
    })
    .filter(b => b.text.trim().length > 0);
    
    return {
      blocks,
      pageCount: Math.max(...elements.map(e => e.page_number || 1), 1),
      ocrUsed: false,
      sourceStrategy: "unstructured",
      extractionWarnings: [],
      durationMs: 0,
      sourceHash: require("crypto").createHash("sha256").update(buffer).digest("hex"),
    };
  } finally {
    // Cleanup temp file
    try {
      await unlink(tmpFile);
    } catch {}
  }
}

// ============================================================
// DOCling SERVICE CLIENT
// ============================================================

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "text/plain";
}

/**
 * Normalize Docling blocks to canonical format
 */
function normalizeDoclingBlocks(doclingBlocks: any[], sourceStrategy: "docling" | "rapidocr"): CanonicalBlock[] {
  const canonical: CanonicalBlock[] = [];
  
  for (let i = 0; i < doclingBlocks.length; i++) {
    const db = doclingBlocks[i];
    const bbox = db.bbox ? { l: db.bbox[0], t: db.bbox[1], r: db.bbox[2], b: db.bbox[3] } : undefined;
    
    // Map Docling label to canonical block type
    let blockType: CanonicalBlockType = "PARAGRAPH";
    const label = (db.type || "").toLowerCase();
    if (label.includes("header") || label.includes("title") || label === "section_header") {
      blockType = "HEADING";
    } else if (label === "table_row") {
      blockType = "TABLE_ROW";
    } else if (label === "list_item") {
      blockType = "LIST_ITEM";
    } else if (label === "caption") {
      blockType = "TEXTBOX";
    }

    canonical.push({
      text: db.text || "",
      page: db.page || 1,
      order: db.order ?? i,
      blockType,
      bbox,
      row: null,
      column: null,
      style: undefined,
      sourceStrategy,
      confidence: 0.9,
      metadata: { originalLabel: label, level: db.level },
    });
  }
  
  return canonical;
}

/**
 * Call Docling /parse endpoint
 */
async function callDoclingParse(
  buffer: Buffer, 
  filename: string,
  useOcr: boolean = false
): Promise<{ blocks: CanonicalBlock[]; pageCount: number; ocrUsed: boolean; durationMs: number }> {
  const formData = new FormData();
  // Convert Buffer to Uint8Array (handles both ArrayBuffer and SharedArrayBuffer)
  const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  // Create a new plain ArrayBuffer by copying the data
  const arrayBufferCopy = new ArrayBuffer(uint8Array.byteLength);
  new Uint8Array(arrayBufferCopy).set(uint8Array);
  const blob = new Blob([arrayBufferCopy], { type: getMimeType(filename) });
  formData.append("file", blob, filename);

  const endpoint = useOcr ? "/ocr" : "/parse";
  const url = `${DOCLING_BASE_URL}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Docling ${endpoint} failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    
    // Normalize Docling blocks to canonical format
    const blocks = normalizeDoclingBlocks(result.blocks, result.ocrUsed ? "rapidocr" : "docling");
    
    return {
      blocks,
      pageCount: result.pages,
      ocrUsed: result.ocrUsed,
      durationMs: result.durationMs || 0,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Docling timeout");
    }
    throw error;
  }
}

/**
 * Call Docling /inspect endpoint for PDF structural analysis
 */
async function callDoclingInspect(buffer: Buffer, filename: string): Promise<{
  pages: number;
  imageCount: number;
  contentImageCount: number;
  contentImagePixels: number;
}> {
  const formData = new FormData();
  const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const arrayBufferCopy = new ArrayBuffer(uint8Array.byteLength);
  new Uint8Array(arrayBufferCopy).set(uint8Array);
  const blob = new Blob([arrayBufferCopy], { type: "application/pdf" });
  formData.append("file", blob, filename);

  const url = `${DOCLING_BASE_URL}/inspect`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Docling inspect failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// MAMMOTH HTML EXTRACTION (for DOCX with table structure)
// ============================================================

/**
 * Extract structured content from DOCX using mammoth HTML + cheerio table parsing
 */
async function extractWithMammothHtml(buffer: Buffer, filename: string): Promise<CanonicalExtractedDocument> {
  const { extractDocxTextBounded } = await import("./docx-validator");
  const mammothText = await extractDocxTextBounded(buffer);
  
  // If mammoth extraction fails or returns empty, fallback to original
  if (!mammothText || mammothText.trim().length === 0) {
    const { extractWithMammoth } = await import("./cv-extraction");
    return extractWithMammoth(buffer, filename);
  }
  
  // Convert to HTML to preserve table structure
  const { convertToHtml } = await import("mammoth");
   const { load } = cheerio;
  
  const { value: html } = await convertToHtml({ buffer });
  const $ = load(html);
  
  // Extract structured blocks preserving table/row/cell metadata
  const blocks: CanonicalBlock[] = [];
  let order = 0;
  
  // Process all elements in document order
  $('body').children().each((_, element) => {
    const elem = $(element);
    const tagName = elem.prop('tagName')?.toLowerCase();
    const text = elem.text().trim();
    
    if (!text) return;
    
    switch (tagName) {
      case 'p': // Paragraph
        blocks.push({
          text,
          page: 1,
          order: order++,
          blockType: "PARAGRAPH" as CanonicalBlockType,
          bbox: null,
          row: null,
          column: null,
          style: null,
          sourceStrategy: "mammoth_html",
          confidence: 0.7,
          metadata: {},
        });
        break;
        
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': // Headings
        blocks.push({
          text,
          page: 1,
          order: order++,
          blockType: "HEADING" as CanonicalBlockType,
          bbox: null,
          row: null,
          column: null,
          style: null,
          sourceStrategy: "mammoth_html",
          confidence: 0.9,
          metadata: {},
        });
        break;
        
      case 'ul': case 'ol': // Lists
        elem.children('li').each((_, li) => {
          const liText = $(li).text().trim();
          if (liText) {
            blocks.push({
              text: liText,
              page: 1,
              order: order++,
              blockType: "PARAGRAPH" as CanonicalBlockType,
              bbox: null,
              row: null,
              column: null,
              style: null,
              sourceStrategy: "mammoth_html",
              confidence: 0.7,
              metadata: {},
            });
          }
        });
        break;
        
      case 'table': // Tables
        // Generate a unique table ID for this table
        const tableId = `table_${blocks.length}_${order}`;
        elem.find('tr').each((rowIndex, tr) => {
          $(tr).find('td, th').each((cellIndex, td) => {
            const cellText = $(td).text().trim();
            if (cellText) {
              // First row of table is typically the header row
              const isHeader = rowIndex === 0;
              blocks.push({
                text: cellText,
                page: 1,
                order: order++,
                blockType: "PARAGRAPH" as CanonicalBlockType,
                bbox: null,
                row: rowIndex,
                column: cellIndex,
                style: null,
                sourceStrategy: "mammoth_html",
                confidence: 0.7,
                metadata: { 
                  tableId: tableId, 
                  isHeader: isHeader 
                },
              });
            }
          });
        });
        break;
    }
  });
  
  return {
    blocks,
    pageCount: 1,
    ocrUsed: false,
    sourceStrategy: "mammoth_html",
    extractionWarnings: [],
    durationMs: 0,
    sourceHash: "",
  };
}

/**
 * Extract text from DOCX using mammoth (legacy fallback)
 */
async function extractWithMammoth(buffer: Buffer, filename: string): Promise<CanonicalExtractedDocument> {
  const { extractDocxTextBounded } = await import("./docx-validator");
  const text = await extractDocxTextBounded(buffer);
  
  const lines = text.split("\n")
    .map((line, idx) => line.trim())
    .filter((line, idx) => line.trim().length > 0)
    .map((line, idx) => ({
      text: line,
      page: 1,
      order: idx,
      blockType: "PARAGRAPH" as CanonicalBlockType,
      bbox: null as BoundingBox | null,
      row: null,
      column: null,
      style: null as BlockStyle | null,
      sourceStrategy: "mammoth" as const,
      confidence: 0.7,
      metadata: {},
    }));

  return {
    blocks: lines,
    pageCount: 1,
    ocrUsed: false,
    sourceStrategy: "mammoth",
    extractionWarnings: [],
    durationMs: 0,
    sourceHash: "",
  };
}

// ============================================================
// MAIN EXTRACTION ROUTER
// ============================================================

/**
 * Main entry point: extract canonical blocks from file buffer
 * Routes to appropriate extractor based on format and quality
 */
async function extractCanonicalBlocks(
  buffer: Buffer, 
  filename: string
): Promise<CanonicalExtractedDocument> {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const format = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "txt";
  const sourceHash = require("crypto").createHash("sha256").update(buffer).digest("hex");
  const warnings: string[] = [];
  const startTime = Date.now();

  try {
    // STEP 1: Initial extraction attempt
    let initialBlocks: CanonicalBlock[];
    let pageCount: number;
    let initialOcrUsed = false;
    let initialStrategy: "native" | "docling" | "rapidocr" | "mammoth" | "mammoth_html";
    let initialDurationMs: number;
    let doclingUnavailable = false;

    if (format === "docx") {
      // Use table-aware HTML extraction for DOCX
      const mammothHtmlResult = await extractWithMammothHtml(buffer, filename);
      initialBlocks = mammothHtmlResult.blocks;
      pageCount = mammothHtmlResult.pageCount;
      initialStrategy = "mammoth_html";
      initialDurationMs = mammothHtmlResult.durationMs;
    } else if (format === "pdf") {
      // Try Docling native (fast path)
      try {
        const doclingResult = await callDoclingParse(buffer, filename, false);
        initialBlocks = doclingResult.blocks;
        pageCount = doclingResult.pageCount;
        initialOcrUsed = doclingResult.ocrUsed;
        initialStrategy = "docling";
        initialDurationMs = doclingResult.durationMs;
      } catch (doclingError) {
        doclingUnavailable = true;
        // Docling unavailable - fall back to native pdf-parse
        const { extractTextFromPDF } = await import("./cv-parser");
        const text = await extractTextFromPDF(buffer);
        initialBlocks = text.split("\n").map((line, idx) => ({
          text: line.trim(),
          page: 1,
          order: idx,
          blockType: "PARAGRAPH" as CanonicalBlockType,
          bbox: null,
          row: null,
          column: null,
          style: null,
          sourceStrategy: "native" as const,
          confidence: 0.5,
          metadata: {},
        })).filter(b => b.text.length > 0);
        pageCount = 1;
        initialStrategy = "native";
        initialDurationMs = Date.now() - startTime;
        warnings.push("Docling unavailable, used fallback pdf-parse");
      }
    } else {
      // TXT
      const text = buffer.toString("utf-8");
      initialBlocks = text.split("\n").map((line, idx) => ({
        text: line.trim(),
        page: 1,
        order: idx,
        blockType: "PARAGRAPH" as CanonicalBlockType,
        bbox: null,
        row: null,
        column: null,
        style: null,
        sourceStrategy: "native" as const,
        confidence: 0.9,
        metadata: {},
      })).filter(b => b.text.length > 0);
      pageCount = 1;
      initialStrategy = "native";
      initialDurationMs = Date.now() - startTime;
    }

    // STEP 2: Assess quality and decide route
    const quality = assessExtractionQuality(initialBlocks, pageCount);
    const route = decideExtractionRoute(format, quality, initialBlocks);
    
    warnings.push(`Quality: ${quality.totalChars} chars, ${quality.emptyPages}/${pageCount} empty pages, tables: ${quality.tableIndicators}, interleaved: ${quality.interleavedColumns}`);
    warnings.push(`Route: ${route.strategy} - ${route.reason}`);

// STEP 3: Apply routing decision
    let finalBlocks: CanonicalBlock[];
    let finalOcrUsed = initialOcrUsed;
    let finalStrategy: ExtractionStrategyType = "docling-native";
    let finalDurationMs = initialDurationMs;
    const ocrPages: number[] = [];

    switch (route.strategy) {
      case "mammoth":
      case "mammoth_html":
        // Already done
        finalBlocks = initialBlocks;
        finalStrategy = route.strategy;
        break;

      case "docling-native":
        if (doclingUnavailable || initialStrategy !== "docling") {
          if (doclingUnavailable) {
            // Docling was already unavailable during initial extraction; use pdf-parse fallback
            finalBlocks = initialBlocks;
            finalStrategy = "native";
            warnings.push("Docling unavailable, using fallback pdf-parse results");
          } else {
            // Re-extract with Docling
            const doclingResult = await callDoclingParse(buffer, filename, false);
            finalBlocks = doclingResult.blocks;
            pageCount = doclingResult.pageCount;
            finalOcrUsed = doclingResult.ocrUsed;
            finalStrategy = "docling-native";
            finalDurationMs = doclingResult.durationMs;
          }
        } else {
          finalBlocks = initialBlocks;
        }
        break;

      case "docling-ocr":
        if (doclingUnavailable) {
          finalBlocks = initialBlocks;
          finalStrategy = "native";
          warnings.push("Docling OCR unavailable, using fallback pdf-parse results");
        } else {
          const ocrResult = await callDoclingParse(buffer, filename, true);
          finalBlocks = ocrResult.blocks;
          pageCount = ocrResult.pageCount;
          finalOcrUsed = true;
          finalStrategy = "docling-ocr";
          finalDurationMs = ocrResult.durationMs;
        }
        break;

      case "rapidocr":
        // Use Docling OCR endpoint or RapidOCR fallback
        if (doclingUnavailable) {
          finalBlocks = initialBlocks;
          finalStrategy = "native";
          warnings.push("Docling OCR unavailable, using fallback pdf-parse results");
        } else {
          try {
            const ocrResult = await callDoclingParse(buffer, filename, true);
            finalBlocks = ocrResult.blocks;
            pageCount = ocrResult.pageCount;
            finalOcrUsed = true;
            finalStrategy = "rapidocr";
            finalDurationMs = ocrResult.durationMs;
          } catch {
            // Try direct RapidOCR call
            warnings.push("Docling OCR failed, attempting direct RapidOCR");
            throw new Error("RapidOCR fallback not yet implemented in Node layer");
          }
        }
        break;

      case "mixed-native-ocr":
        if ("ocrPages" in route) {
          if (doclingUnavailable) {
            finalBlocks = initialBlocks;
            finalStrategy = "native";
            warnings.push("Docling OCR unavailable, using fallback pdf-parse results");
          } else {
            ocrPages.push(...route.ocrPages);
            warnings.push(`Mixed extraction: native for most pages, OCR for pages ${route.ocrPages.join(", ")}`);

            // For now, use Docling OCR on entire document
            // TODO: Implement true page-level mixed extraction
            const mixedResult = await callDoclingParse(buffer, filename, true);
            finalBlocks = mixedResult.blocks;
            pageCount = mixedResult.pageCount;
            finalOcrUsed = true;
            finalStrategy = "mixed-native-ocr";
            finalDurationMs = mixedResult.durationMs;
          }
        } else {
          finalBlocks = initialBlocks;
        }
        break;

      case "unstructured":
        // Unstructured structural extraction for PDF
        const unstructuredResult = await extractWithUnstructured(buffer, filename);
        finalBlocks = unstructuredResult.blocks;
        pageCount = unstructuredResult.pageCount;
        finalOcrUsed = unstructuredResult.ocrUsed;
        finalStrategy = "unstructured";
        finalDurationMs = unstructuredResult.durationMs;
        break;

      default:
        finalBlocks = initialBlocks;
    }

    // STEP 4: Secondary structure reconciliation (pdf-parse line boundaries for Docling-flattened regions)
    if (format === "pdf" && finalStrategy.startsWith("docling") && !finalOcrUsed) {
      finalBlocks = await reconcileStructureWithPdfParse(finalBlocks, buffer, pageCount, warnings);
    }

    // STEP 5: Deduplicate blocks (native + OCR overlap)
    finalBlocks = deduplicateCanonicalBlocks(finalBlocks);

    // STEP 6: Header/footer deduplication using layout metadata
    finalBlocks = deduplicateHeadersFootersCanonical(finalBlocks, pageCount);

// Map detailed extraction strategy to the sourceStrategy type expected by the rest of the system
      let sourceStrategyForDoc: "native" | "docling" | "rapidocr" | "mammoth" | "mammoth_html" | "mixed" | "unstructured";
      if (finalStrategy === "docling-native" || finalStrategy === "docling-ocr") {
        sourceStrategyForDoc = "docling";
      } else if (finalStrategy === "mixed-native-ocr") {
        sourceStrategyForDoc = "mixed";
      } else if (finalStrategy === "unstructured") {
        sourceStrategyForDoc = "unstructured";
      } else {
        // finalStrategy is guaranteed to be one of: mammoth, rapidocr
        sourceStrategyForDoc = finalStrategy as any;
      }
     
     return {
       blocks: finalBlocks,
       pageCount,
       ocrUsed: finalOcrUsed,
       sourceStrategy: sourceStrategyForDoc,
       extractionWarnings: warnings,
       durationMs: Date.now() - startTime,
       sourceHash,
     };
  } catch (error: any) {
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

/**
 * Deduplicate overlapping equivalent blocks from multiple extraction strategies
 */
export function deduplicateCanonicalBlocks(blocks: CanonicalBlock[]): CanonicalBlock[] {
  if (blocks.length <= 1) return blocks;

  // Group by normalized text + page
  const groups = new Map<string, CanonicalBlock[]>();
  
  for (const block of blocks) {
    const normalized = block.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
    const key = `${block.page}:${normalized}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(block);
  }

  const keep = new Set<CanonicalBlock>();
  
  for (const [, group] of groups) {
    if (group.length === 1) {
      keep.add(group[0]);
      continue;
    }
    // Identical text emitted by the SAME extractor at DIFFERENT positions
    // is a legitimately repeated line (e.g. "Product Design Intern" used as
    // the role for four internships) — never collapse those. Only merge
    // real multi-strategy overlaps: different source strategies or bboxes
    // that actually intersect.
    const strategies = new Set(group.map(b => b.sourceStrategy));
    const bboxOverlap = group.length === 2 && group[0].bbox && group[1].bbox &&
      !(group[0].bbox!.b <= group[1].bbox!.t || group[1].bbox!.b <= group[0].bbox!.t);
    if (strategies.size <= 1 && !bboxOverlap) {
      group.forEach(b => keep.add(b));
      continue;
    }
    // Keep the one with highest confidence and layout metadata
    const best = group.reduce((a, b) => {
      // Prefer blocks with bbox and higher confidence
      const aScore = (a.bbox ? 10 : 0) + (a.confidence * 10);
      const bScore = (b.bbox ? 10 : 0) + (b.confidence * 10);
      return aScore >= bScore ? a : b;
    });
    keep.add(best);
  }

  return blocks.filter(b => keep.has(b)).sort((a, b) => a.order - b.order);
}

/**
 * Header/footer deduplication using canonical blocks with layout metadata
 */
function deduplicateHeadersFootersCanonical(
  blocks: CanonicalBlock[], 
  pageCount: number
): CanonicalBlock[] {
  if (blocks.length === 0 || pageCount < 2) return blocks;

  // Group by normalized text
  const textGroups = new Map<string, CanonicalBlock[]>();
  for (const block of blocks) {
    const normalized = block.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (normalized.length < 10) continue;
    if (!textGroups.has(normalized)) textGroups.set(normalized, []);
    textGroups.get(normalized)!.push(block);
  }

  const toRemove = new Set<CanonicalBlock>();
  
  for (const [, group] of textGroups) {
    if (group.length < 2) continue;

    const pages = new Set(group.map(b => b.page));
    if (pages.size < 2) continue; // not repeated across pages

    // Check if consistently at top or bottom of pages
    const isHeader = group.every(b => {
      const pageBlocks = blocks.filter(x => x.page === b.page).sort((a, b) => a.order - b.order);
      const idx = pageBlocks.indexOf(b);
      return idx >= 0 && idx < 3;
    });
    const isFooter = group.every(b => {
      const pageBlocks = blocks.filter(x => x.page === b.page).sort((a, b) => a.order - b.order);
      const idx = pageBlocks.indexOf(b);
      return idx >= 0 && idx >= pageBlocks.length - 3;
    });

    // Also use bbox if available (top 10% or bottom 10% of page)
    const hasBboxEvidence = group.some(b => b.bbox && (
      (b.bbox!.t < 72) || // top inch
      (b.bbox!.b > 720)   // bottom inch (assuming letter)
    ));

    if ((isHeader || isFooter) && (group.length >= 2 || hasBboxEvidence)) {
      // Mark all but first occurrence for removal
      group.slice(1).forEach(b => toRemove.add(b));
    }
  }

  if (toRemove.size === 0) return blocks;
  
  return blocks.filter(b => !toRemove.has(b));
}

/**
 * Reconcile Docling-flattened blocks with pdf-parse native line structure
 * when strong evidence proves Docling lost original line boundaries.
 * 
 * Only activates for native-text PDFs where:
 * 1. Docling is primary extractor (no OCR used)
 * 2. pdf-parse returns meaningful text
 * 3. Docling has heading + single flattened body block
 * 4. pdf-parse has same heading with multiple lines
 * 5. Normalized text equivalence is confirmed
 */
async function reconcileStructureWithPdfParse(
  doclingBlocks: CanonicalBlock[],
  buffer: Buffer,
  pageCount: number,
  warnings: string[]
): Promise<CanonicalBlock[]> {
  try {
    // Get pdf-parse native text
    const { extractTextFromPDF } = await import("./cv-parser");
    const pdfParseText = await extractTextFromPDF(buffer);
    
    if (!pdfParseText || pdfParseText.trim().length < 50) {
      return doclingBlocks; // pdf-parse returned nothing useful
    }
    
    const pdfLines = pdfParseText.split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);
    
    if (pdfLines.length <= doclingBlocks.length) {
      return doclingBlocks; // pdf-parse doesn't have more lines
    }
    
// Find Docling headings and their associated body blocks
    const reconciled: CanonicalBlock[] = [];
    let i = 0;
    
    while (i < doclingBlocks.length) {
      const block = doclingBlocks[i];
      const isHeading = block.blockType === "HEADING" || 
                        (block.blockType === "PARAGRAPH" && looksLikeHeading(block.text));
      
      if (isHeading && i + 1 < doclingBlocks.length) {
        const nextBlock = doclingBlocks[i + 1];
        // Only split for list-type sections (PROJECTS, CERTIFICATIONS, INITIATIVES, etc.)
        // NOT for narrative sections (PROFILE, SUMMARY, EDUCATION, EXPERIENCE)
        if (!isListTypeHeading(block.text)) {
          // Not a list-type heading, skip reconciliation
         } else {
          
          // Find ALL consecutive body blocks that belong to this heading
          // (until next KNOWN canonical section heading or end of array)
          let bodyEnd = i + 1;
          while (bodyEnd < doclingBlocks.length) {
            const b = doclingBlocks[bodyEnd];
            // Only stop at KNOWN canonical section headings, not arbitrary heading-like text
            // This prevents TOOLS, SKILLS, etc. from incorrectly terminating list-type sections
            const bIsCanonicalHeading = b.blockType === "HEADING" && 
              ["EDUCATION", "EXPERIENCE", "PROJECTS", "SKILLS", "CERTIFICATIONS", "ACHIEVEMENTS", "PERSONAL", "SUMMARY", "OBJECTIVE", "PROFILE", "CERTIFICATIONS"].some(h => 
                b.text.toUpperCase().includes(h)
              );
            if (bIsCanonicalHeading && bodyEnd > i + 1) {
              // Next canonical heading found - body region ends before it
              break;
            }
            if (bodyEnd === i + 1 || b.blockType === "PARAGRAPH" || b.blockType === "LIST_ITEM") {
              bodyEnd++;
            } else {
              break;
            }
          }
          
          const bodyBlocks = doclingBlocks.slice(i + 1, bodyEnd);
          
          // For list-type headings, check if pdf-parse has more lines than Docling body blocks
          // This handles cases where Docling splits a section across multiple headings incorrectly
          const matchedLines = matchHeadingInPdfParse(
            block.text, 
            bodyBlocks.map(b => b.text).join(" "), 
            pdfLines
          );
          
          // If pdf-parse has more lines than Docling body blocks, attempt reconciliation
          if (!matchedLines || matchedLines.length <= bodyBlocks.length) {
            i = bodyEnd;
            continue;
          }
          
          const bodyText = bodyBlocks.map(b => b.text).join(" ");
          
          if (matchedLines && matchedLines.length > 1 && 
              textEquivalenceCheck(bodyText, matchedLines.join(" "))) {
            
            // EQUIVALENCE CONFIRMED - split Docling body blocks using pdf-parse lines
            warnings.push(`Structure reconciliation: split heading "${block.text.substring(0, 50)}..." into ${matchedLines.length} lines via pdf-parse`);
            
            reconciled.push(block); // Keep heading
            
            // Create separate blocks for each recovered line
            for (let j = 0; j < matchedLines.length; j++) {
              reconciled.push({
                text: matchedLines[j],
                page: nextBlock.page,
                order: nextBlock.order + j + 0.1, // Preserve order
                blockType: "PARAGRAPH",
                bbox: nextBlock.bbox,
                row: null,
                column: null,
                style: nextBlock.style,
                sourceStrategy: "docling",
                confidence: 0.7,
                metadata: { 
                  recoveredFrom: "pdf-parse", 
                  originalBlockOrder: nextBlock.order 
                },
              });
            }
            
            // Skip heading and ALL body blocks in the matched region
            i = bodyEnd;
            continue;
          }
        }
      }
      
      reconciled.push(block);
      i++;
    }
    
    return reconciled;
  } catch (error: any) {
    // If reconciliation fails for any reason, return original Docling blocks
    return doclingBlocks;
  }
}

/**
 * Check if text looks like a heading
 */
function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  if (t.match(/^[•\-*▪◦·]\s/)) return false;
  if (t.match(/^\d+\.\s/)) return false;
  if (t.includes("@")) return false;
  if (t.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/)) return false;
  if (t.split(" ").length > 12) return false;
  
  // Common heading keywords
  const headingKeywords = /^(education|experience|projects|skills|certifications|achievements|personal|summary|objective|profile|initiatives|selected initiatives|key initiatives|major initiatives|selected projects|accomplishments|awards|honors|publications|languages|interests|references|board|advisory)/i;
  return headingKeywords.test(t);
}

/**
 * Check if heading is a list-type section where line splitting is appropriate
 * (PROJECTS, CERTIFICATIONS, INITIATIVES, etc.)
 * NOT narrative sections like PROFILE, SUMMARY, EDUCATION
 */
function isListTypeHeading(text: string): boolean {
  const t = text.trim().toLowerCase();
  const listTypeKeywords = /^(projects|certifications|initiatives|selected initiatives|key initiatives|major initiatives|selected projects|accomplishments|awards|honors|publications|activities|achievements)/i;
  // Exclude narrative sections
  const narrativeKeywords = /^(profile|summary|objective|education|experience|personal|skills|languages|interests|references|board|advisory)/i;
  return listTypeKeywords.test(t) && !narrativeKeywords.test(t);
}

/**
 * Check if text looks like flattened content (multiple lines merged)
 */
function looksLikeFlattenedContent(text: string): boolean {
  const t = text.trim();
  if (t.length < 80) return false;
  
  // Count title-case phrase boundaries (heuristic for merged lines)
  const titleCasePhrases = t.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  return titleCasePhrases.length >= 3;
}

/**
 * Match a heading in pdf-parse lines and return content lines until next heading
 */
function matchHeadingInPdfParse(
  headingText: string, 
  doclingBodyText: string,
  pdfLines: string[]
): string[] | null {
  // Find the heading in pdf-parse lines (fuzzy match)
  const headingNorm = normalizeText(headingText);
  let headingIndex = -1;
  
  for (let i = 0; i < pdfLines.length; i++) {
    if (normalizeText(pdfLines[i]).includes(headingNorm) || 
        headingNorm.includes(normalizeText(pdfLines[i]))) {
      headingIndex = i;
      break;
    }
  }
  
  if (headingIndex === -1) return null;
  
  // Collect lines after heading until next heading-like line
  const matched: string[] = [];
  for (let i = headingIndex + 1; i < pdfLines.length; i++) {
    if (looksLikeHeading(pdfLines[i])) break;
    if (pdfLines[i].trim().length > 0) {
      matched.push(pdfLines[i].trim());
    }
  }
  
  return matched.length > 0 ? matched : null;
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "");
}

/**
 * Check if normalized concatenation of lines substantially matches Docling body
 */
function textEquivalenceCheck(doclingText: string, pdfParseText: string): boolean {
  const normDocling = normalizeText(doclingText);
  const normPdfParse = normalizeText(pdfParseText);
  
  // Check if pdf-parse text is contained in Docling or vice versa
  // Allow for minor differences in punctuation/spacing
  if (normDocling.length > normPdfParse.length) {
    return normDocling.includes(normPdfParse);
  } else {
    return normPdfParse.includes(normDocling);
  }
}
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
    const mmMatch = fullMatch.match(/\d{4}\/(\d{2})$/);
    if (mmMatch) {
      const month = mmMatch[1];
      if (parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) {
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
        
        currentExp.startDate = dateMatch[1];
        currentExp.endDate = dateMatch[2];
        currentExp.currentlyWorking = /present|current|ongoing/i.test(dateMatch[2] || "");
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
        currentExp = {
          startDate: dateMatch[1],
          endDate: dateMatch[2],
          currentlyWorking: /present|current|ongoing/i.test(dateMatch[2] || ""),
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

// ============================================================
// EXPORTED API
// ============================================================

// These are used by cv-parser.ts - export them
export { 
   extractCanonicalBlocks,
   extractWithMammoth,
   extractWithMammothHtml,
   assessExtractionQuality,
   decideExtractionRoute,
   reconcileStructureWithPdfParse
};

