/**
 * @file resume-import/index.ts
 * Resilient multi-strategy CV import orchestrator.
 *
 * file → strategy 1 → strategy 2 → … → best candidate by structural
 * coverage → ResumeParseState for the review UI.
 *
 * Invariants:
 *  - no strategy can stall the whole upload (per-strategy timeout)
 *  - a PARTIAL candidate is never discarded for a later weaker one
 *  - early exit only on GOOD (spec: PARTIAL keeps trying for stronger)
 *  - FAILED_FILE only when NO strategy could extract text at all
 *  - no LLM calls, no paid services, no profile mutation
 */
import type {
  ResumeParseCandidate, ResumeParserStrategy,
  ResumeImportResult, ResumeParseState,
} from "./types";
import { strategiesFor, ocrTextExtractionStrategy, needsOcrFallback } from "./strategies";
import { chooseBestCandidate } from "./coverage";
import { chooseBestCandidateDetailed, computeCandidateDiagnostics, isCleanlyGood } from "./diagnostics";
import { inspectDocxImages, IMAGE_DOMINANT_TEXT_MAX } from "./docx-image-inspect";
import { inspectPdfWithService } from "../docling-client";
import { createCVParseFailure } from "../cv-parser";

class StrategyTimeoutError extends Error {
  code = "STRATEGY_TIMEOUT";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new StrategyTimeoutError("strategy timed out")), ms),
    ),
  ]);
}

function stateFor(candidate: ResumeParseCandidate): ResumeParseState {
  switch (candidate.coverage.status) {
    case "GOOD":
      return candidate.warnings.length > 0 ? "PARSED_WITH_WARNINGS" : "PARSED";
    case "PARTIAL":
      return "PARTIAL_PARSE";
    case "EXTRACTION_ONLY":
      return "EXTRACTION_ONLY";
    case "UNREADABLE":
      return "FAILED_FILE";
  }
}

/**
 * Run the strategy chain for a file. Returns the best candidate wrapped
 * in an import result — throws CVParseFailure only when every strategy
 * failed or no text could be extracted at all.
 */
export async function importResume(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  strategies?: ResumeParserStrategy[],
  ocrStrategy?: ResumeParserStrategy | null,
  pdfInspector?: (buffer: Buffer, filename: string) => Promise<{ contentImageCount: number } | null>,
): Promise<ResumeImportResult> {
  const chain = strategies ?? strategiesFor(filename);
  const ocr = ocrStrategy === undefined ? ocrTextExtractionStrategy : ocrStrategy;
  const candidates: ResumeParseCandidate[] = [];
  const attempts: ResumeImportResult["attempts"] = [];
  let lastError: any = null;

  for (const strategy of chain) {
    const started = Date.now();
    try {
      const candidate = await withTimeout(
        strategy.parse(buffer, filename, mimeType),
        strategy.timeoutMs,
      );
      const durationMs = Date.now() - started;
      candidates.push(candidate);
      attempts.push({
        strategy: strategy.id,
        status: "OK",
        coverage: candidate.coverage.status,
        durationMs,
      });
      // Early exit only on a CLEAN GOOD result — a GOOD-coverage
      // candidate with malformed/duplicated/polluted records keeps the
      // chain running so plausibility ranking can compare candidates.
      if (candidate.coverage.status === "GOOD") {
        const diag = computeCandidateDiagnostics(candidate.parsed, candidate.coverage.status);
        candidate.candidateDiagnostics = diag;
        if (isCleanlyGood(diag)) break;
      }
    } catch (e: any) {
      const durationMs = Date.now() - started;
      lastError = e;
      attempts.push({
        strategy: strategy.id,
        status: e instanceof StrategyTimeoutError ? "TIMEOUT" : "FAILED",
        durationMs,
        errorCode: e?.code || e?.name || "UNKNOWN",
      });
      // continue to next strategy
    }
  }

  // ===== OCR FALLBACK =====
  // Deterministic trigger ONLY — image-only/scanned files where the
  // normal chain recovered no usable text, OR a document that is
  // structurally image-dominant (small live text + large embedded
  // page images carrying the actual resume). Never fires on a clean
  // GOOD parse.
  let selection = chooseBestCandidateDetailed(candidates);
  let imageDominant = false;
  if (
    selection.best &&
    selection.best.coverage.status !== "GOOD" &&
    selection.best.diagnostics.rawTextLength < IMAGE_DOMINANT_TEXT_MAX
  ) {
    if (/\.docx$/i.test(filename)) {
      const inspect = await inspectDocxImages(buffer).catch(() => null);
      imageDominant = !!inspect && inspect.contentImageCount >= 1;
    } else if (/\.pdf$/i.test(filename)) {
      // Docling's do_ocr retry only fires at ≤10 chars — a mixed PDF
      // (thin text layer + page-sized CV image) needs structural
      // detection to decide whether OCR is worth it.
      const inspect = await (
        pdfInspector ??
        ((b: Buffer, f: string) => inspectPdfWithService(b, f))
      )(buffer, filename).catch(() => null);
      imageDominant = !!inspect && inspect.contentImageCount >= 1;
    }
  }
  let ocrError: any = null;
  if (ocr && needsOcrFallback(selection.best, candidates.length, imageDominant)) {
    const ocrStarted = Date.now();
    try {
      const oc = await withTimeout(
        ocr.parse(buffer, filename, mimeType),
        ocr.timeoutMs,
      );
      candidates.push(oc);
      attempts.push({
        strategy: ocr.id,
        status: "OK",
        coverage: oc.coverage.status,
        durationMs: Date.now() - ocrStarted,
      });
    } catch (e: any) {
      ocrError = e;
      attempts.push({
        strategy: ocr.id,
        status: e instanceof StrategyTimeoutError ? "TIMEOUT" : "FAILED",
        durationMs: Date.now() - ocrStarted,
        errorCode: e?.code || e?.name || "UNKNOWN",
      });
    }
    selection = chooseBestCandidateDetailed(candidates);
  }

  const best = selection.best;
  if (!best) {
    // Every strategy threw — surface the most actionable error we saw.
    // When OCR actually ran on image content and still got nothing, say so;
    // when the file had no image content at all (corrupt), keep the
    // original extraction error.
    if (ocrError && ocrError?.code !== "OCR_NO_IMAGE_CONTENT") {
      throw createCVParseFailure(
        ocrError?.code === "OCR_LIMIT_EXCEEDED" ? "CV_OCR_LIMIT_EXCEEDED" : "CV_OCR_EXTRACTION_FAILED",
        undefined,
        { strategiesTried: attempts.length },
      );
    }
    throw lastError || createCVParseFailure("PARSE_FAILED");
  }
  if (best.coverage.status === "UNREADABLE") {
    throw createCVParseFailure("CV_EXTRACTION_EMPTY", undefined, {
      rawTextLength: best.diagnostics.rawTextLength,
      strategiesTried: attempts.length,
    });
  }

  // Sections present ONLY in non-winning candidates — advisory audit
  // trail for future review/merge. The winner stays a single canonical
  // candidate; nothing is unioned into it.
  const winnerDiag = best.candidateDiagnostics;
  const secondaryOnlySections: string[] = [];
  if (winnerDiag) {
    const has = (d: any, k: string) => (d?.[k] || 0) > 0;
    const SECTION_KEYS: Array<[string, string]> = [
      ["projects", "projectCount"],
      ["certifications", "certificationCount"],
      ["achievements", "achievementCount"],
      ["publications", "publicationCount"],
      ["languages", "languageCount"],
    ];
    for (const d of selection.diagnostics) {
      if (d.strategy === best.sourceStrategy) continue;
      for (const [label, key] of SECTION_KEYS) {
        if (has(d, key) && !has(winnerDiag, key) && !secondaryOnlySections.includes(label)) {
          secondaryOnlySections.push(label);
        }
      }
    }
  }

  const winningIndex = candidates.indexOf(best);
  const ocrRecovered =
    best.sourceStrategy === "OCR_TEXT_EXTRACTION" ||
    !!best.parsed?.parserMeta?.ocrUsed;
  return {
    state: stateFor(best),
    candidate: best,
    attempts,
    fallbackUsed: winningIndex > 0 || attempts.some((a) => a.status !== "OK"),
    ocrRecovered,
    ocrEngine: ocrRecovered
      ? (best.parsed?.parserMeta?.engine === "rapidocr" ? "rapidocr" : "docling")
      : undefined,
    winnerReasons: selection.winnerReasons,
    candidateDiagnostics: selection.diagnostics.map(d => ({
      ...d,
      strategy: d.strategy as any,
    })),
    secondaryOnlySections,
  };
}
