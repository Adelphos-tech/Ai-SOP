/**
 * @file resume-import/strategies.ts
 * The concrete free/local-first parser strategies.
 *
 * DOCX order:  MAMMOTH_SEMANTIC → DOCLING_MAPPER → TEXT_EXTRACTION
 *   (benchmarked: docling's block typing emits no section_header blocks
 *    for the table-layout DOCX class, so its mapper starves; the
 *    text-line parser reads the same content correctly.)
 * PDF order:   DOCLING_MAPPER → MAMMOTH_SEMANTIC → TEXT_EXTRACTION
 *   (docling layout model gives cleaner block structure on real PDFs;
 *    the text-line parser over-segments multi-column PDFs.)
 * TXT:         MAMMOTH_SEMANTIC (plain text → legacy parser)
 */
import { parseWithDocling, ocrWithService } from "../docling-client";
import { mapDoclingToParsedCV } from "../cv-mapper-docling";
import { parseCVText, parseCVFile, extractTextFromFile, createCVParseFailure } from "../cv-parser";
import { evaluateCoverage } from "./coverage";
import type {
  ResumeParseCandidate, ResumeParserStrategy,
} from "./types";

function emptyParsedCV(): import("../cv-parser").ParsedCV {
  return {
    personalData: {},
    education: [],
    experience: [],
    projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [] },
    certifications: [],
    achievements: [],
    rawTextLength: 0,
    parseWarnings: [],
  };
}

function makeCandidate(
  sourceStrategy: ResumeParseCandidate["sourceStrategy"],
  parsed: import("../cv-parser").ParsedCV,
  rawText: string,
  diagnostics: ResumeParseCandidate["diagnostics"],
): ResumeParseCandidate {
  const coverage = evaluateCoverage(parsed, rawText.length);
  return {
    sourceStrategy,
    coverage,
    diagnostics,
    rawText,
    parsed,
    warnings: parsed.parseWarnings || [],
  };
}

// ============================================================
// A. Mammoth/text-line semantic parser (legacy cv-parser.ts)
// ============================================================

export const mammothSemanticStrategy: ResumeParserStrategy = {
  id: "MAMMOTH_SEMANTIC",
  timeoutMs: 30_000,
  async parse(buffer, filename) {
    const started = Date.now();
    // parseCVFile does extractTextFromFile + parseCVText internally and
    // already classifies unreadable/image-only cases as typed failures.
    const parsed = await parseCVFile(buffer, filename);
    const rawText = await extractTextFromFile(buffer, filename).catch(() => "");
    return makeCandidate(
      "MAMMOTH_SEMANTIC",
      parsed,
      rawText,
      { rawTextLength: rawText.length, engine: "mammoth", mapperVersion: "legacy-1" },
    );
  },
};

// ============================================================
// B. Docling blocks + semantic mapper
// ============================================================

export const doclingMapperStrategy: ResumeParserStrategy = {
  id: "DOCLING_MAPPER",
  timeoutMs: parseInt(process.env.CV_PARSER_TIMEOUT_MS || "120000", 10),
  async parse(buffer, filename) {
    const started = Date.now();
    const doc = await parseWithDocling(buffer, filename);
    const rawText = (doc.blocks || []).map((b) => b.text).join("\n");
    try {
      const parsed = mapDoclingToParsedCV(doc);
      return makeCandidate("DOCLING_MAPPER", parsed, rawText, {
        rawTextLength: rawText.length,
        blockCount: doc.blocks?.length || 0,
        engine: "docling",
        mapperVersion: "2",
      });
    } catch (e: any) {
      // Mapper produced an empty structure on a non-empty document —
      // keep the extracted text as an EXTRACTION_ONLY candidate instead
      // of discarding the extraction entirely.
      if (e?.code === "CV_PARSE_EMPTY_STRUCTURE") {
        return makeCandidate("DOCLING_MAPPER", emptyParsedCV(), rawText, {
          rawTextLength: rawText.length,
          blockCount: doc.blocks?.length || 0,
          engine: "docling",
          mapperVersion: "2",
        });
      }
      throw e;
    }
  },
};

// ============================================================
// C. Extraction-only — last resort: raw text + whatever the text-line
//    heuristics can do; never structured-applyable on its own.
// ============================================================

export const textExtractionStrategy: ResumeParserStrategy = {
  id: "TEXT_EXTRACTION",
  timeoutMs: 30_000,
  async parse(buffer, filename) {
    const started = Date.now();
    let rawText = "";
    try {
      rawText = await extractTextFromFile(buffer, filename);
    } catch (e: any) {
      throw createCVParseFailure("CV_EXTRACTION_FAILED", e?.message);
    }
    if (!rawText || rawText.trim().length === 0) {
      throw createCVParseFailure("CV_EXTRACTION_EMPTY");
    }
    return makeCandidate("TEXT_EXTRACTION", emptyParsedCV(), rawText, {
      rawTextLength: rawText.length,
      engine: filename.toLowerCase().endsWith(".docx") ? "mammoth" : "pdf-parse",
    });
  },
};

// ============================================================
// D. OCR fallback — free local OCR (RapidOCR sidecar). NOT part of the
//    normal chain: the orchestrator invokes it only when every normal
//    strategy produced no usable text (image-only/scanned file).
//    OCR text goes through the SAME semantic parser + plausibility
//    ranking — no privileged score, no separate schema.
// ============================================================

const OCR_MIN_TEXT = 40; // below this, OCR output isn't a usable recovery

export const ocrTextExtractionStrategy: ResumeParserStrategy = {
  id: "OCR_TEXT_EXTRACTION",
  timeoutMs: parseInt(process.env.CV_OCR_TIMEOUT_MS || "240000", 10),
  async parse(buffer, filename) {
    const doc = await ocrWithService(buffer, filename);
    const rawText = (doc.blocks || []).map((b) => b.text).join("\n").trim();
    if (rawText.length < OCR_MIN_TEXT) {
      throw createCVParseFailure("CV_OCR_EXTRACTION_FAILED", undefined, {
        rawTextLength: rawText.length,
      });
    }
    // Feed OCR text through the existing deterministic text parser.
    // Weak structure → EXTRACTION_ONLY, never a hard failure.
    let parsed: import("../cv-parser").ParsedCV;
    try {
      parsed = parseCVText(rawText);
    } catch {
      parsed = emptyParsedCV();
    }
    parsed.rawTextLength = rawText.length;
    parsed.parserMeta = {
      engine: "rapidocr",
      ocrUsed: true,
      durationMs: doc.durationMs,
      parsedAt: new Date().toISOString(),
    };
    if (!parsed.parseWarnings.includes("OCR_TEXT_RECOVERED")) {
      parsed.parseWarnings.push("OCR_TEXT_RECOVERED");
    }
    return makeCandidate("OCR_TEXT_EXTRACTION", parsed, rawText, {
      rawTextLength: rawText.length,
      blockCount: doc.blocks?.length || 0,
      durationMs: doc.durationMs,
      engine: "rapidocr",
    });
  },
};

/**
 * Deterministic OCR trigger — fire ONLY when the normal chain produced
 * no usable text, or the document is structurally image-dominant.
 * Never on a clean GOOD parse, never merely because structure is weak
 * but substantial text exists.
 *
 * `imageDominant` is a structural signal (large content images +
 * low live text) computed by the caller — see docx-image-inspect.ts.
 */
export function needsOcrFallback(
  best: ResumeParseCandidate | null,
  candidateCount: number,
  imageDominant = false,
): boolean {
  if (candidateCount === 0 || !best) return true; // everything threw
  if (best.coverage.status === "UNREADABLE") return true;
  if (imageDominant && best.coverage.status !== "GOOD") return true;
  return (
    best.coverage.status === "EXTRACTION_ONLY" &&
    best.diagnostics.rawTextLength < OCR_MIN_TEXT
  );
}

// ============================================================
// STRATEGY ORDERING (per file type — empirical, not arbitrary)
// ============================================================

export function strategiesFor(filename: string): ResumeParserStrategy[] {
  const ext = filename.toLowerCase().split(".").pop() || "";
  switch (ext) {
    case "docx":
      return [mammothSemanticStrategy, doclingMapperStrategy, textExtractionStrategy];
    case "pdf":
      return [doclingMapperStrategy, mammothSemanticStrategy, textExtractionStrategy];
    case "txt":
      return [mammothSemanticStrategy];
    default:
      return [mammothSemanticStrategy, textExtractionStrategy];
  }
}
