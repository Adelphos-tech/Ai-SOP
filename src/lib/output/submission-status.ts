/**
 * @file submission-status.ts
 * @description
 * Explicit final output status model.
 *
 * The document NEVER shows READY_TO_SUBMIT until all applicable gates pass.
 *
 * Render validation is integrated as a separate gate. Factual safety ALWAYS
 * takes precedence over render success — a PDF can exist while the submission
 * remains REVIEW_REQUIRED due to factual failures.
 *
 * NO automatic second finalization loop. If the Finalizer shortens content
 * but render overflow persists, the status is REVIEW_REQUIRED with
 * PHYSICAL_PAGE_LIMIT_EXCEEDED. A controlled manual revision workflow
 * may be designed later.
 */

import { DocumentPageValidation } from "../render/page-validator";
import { RenderLifecycleResult } from "../render/render-lifecycle-types";

export type SubmissionStatus =
  | "DRAFT_GENERATED"
  | "REVIEW_REQUIRED"
  | "READY_FOR_RENDER_VALIDATION"
  | "RENDER_OVERFLOW"
  | "READY_TO_SUBMIT";

export interface RenderValidationResult {
  /** Whether a PDF was physically generated */
  pdfGenerated: boolean;
  /** Physical page validation from the renderer */
  pageValidation: DocumentPageValidation | null;
  /** Whether the render engine encountered an error */
  renderEngineError: boolean;
  /** Full render lifecycle result (pre-final + final) */
  renderLifecycle: RenderLifecycleResult | null;
}

export interface FinalCompliance {
  documentStructure: "PASS" | "FAIL";
  officialPromptCoverage: "PASS" | "FAIL";
  requiredTopicCoverage: "PASS" | "FAIL";
  factSafety: {
    status: "PASS" | "FAIL";
    inventedFacts: number;
    alteredFacts: number;
    interpretiveElaborations: number;
  };
  wordLimit: "PASS" | "FAIL" | "N/A";
  characterLimit: "PASS" | "FAIL" | "N/A";
  pageLimit: "PASS" | "FAIL" | "RENDER_VALIDATION_REQUIRED";
  renderValidation: RenderValidationResult | null;
  submissionStatus: SubmissionStatus;
  /** Physical page blocker reason if applicable */
  physicalPageBlocker: string | null;
}

/**
 * Compute the submission status from the fact review, constraint checks,
 * and physical render validation.
 *
 * Precedence (highest to lowest):
 *   A. AI policy blocked → generation never occurs (handled upstream)
 *   B. Final fact safety failed → REVIEW_REQUIRED (always, regardless of render)
 *   C. Final fact safety PASS but physical render overflow → REVIEW_REQUIRED
 *      blocker: PHYSICAL_PAGE_LIMIT_EXCEEDED
 *   D. Final fact safety PASS and physical render PASS and other deterministic
 *      constraints PASS → READY_TO_SUBMIT
 *
 * Render success does NOT override factual failure.
 * A PDF can exist while submission remains REVIEW_REQUIRED.
 * NO automatic second finalization loop.
 */
export function computeSubmissionStatus(args: {
  factReviewPass: boolean;
  inventedFacts: number;
  alteredFacts: number;
  hasPageConstraint: boolean;
  deterministicChecksPass: boolean;
  renderValidation?: RenderValidationResult | null;
}): { status: SubmissionStatus; physicalPageBlocker: string | null } {
  // B. Factual failure blocks submission — ALWAYS, regardless of render status
  if (!args.factReviewPass || args.inventedFacts > 0 || args.alteredFacts > 0) {
    return { status: "REVIEW_REQUIRED", physicalPageBlocker: null };
  }

  // Facts pass — now check render validation
  const renderVal = args.renderValidation ?? null;

  if (renderVal) {
    // Render engine error
    if (renderVal.renderEngineError) {
      return { status: "REVIEW_REQUIRED", physicalPageBlocker: "RENDER_ENGINE_ERROR" };
    }

    // C. Render overflow — facts pass but pages exceed limits
    // Check the final render (not pre-final, since Finalizer may have fixed it)
    const lifecycle = renderVal.renderLifecycle;
    if (lifecycle && lifecycle.hasOverflowFinal) {
      // NO automatic second finalization loop
      return { status: "REVIEW_REQUIRED", physicalPageBlocker: "PHYSICAL_PAGE_LIMIT_EXCEEDED" };
    }

    // Also check pageValidation for backward compatibility
    if (renderVal.pageValidation && renderVal.pageValidation.status === "RENDER_OVERFLOW") {
      return { status: "REVIEW_REQUIRED", physicalPageBlocker: "PHYSICAL_PAGE_LIMIT_EXCEEDED" };
    }

    // Render not yet performed for a document with page constraints
    if (args.hasPageConstraint && !renderVal.pdfGenerated) {
      return { status: "READY_FOR_RENDER_VALIDATION", physicalPageBlocker: null };
    }
  } else {
    // No render validation provided yet
    if (args.hasPageConstraint) {
      return { status: "READY_FOR_RENDER_VALIDATION", physicalPageBlocker: null };
    }
  }

  // D. All checks passed
  if (args.deterministicChecksPass) {
    return { status: "READY_TO_SUBMIT", physicalPageBlocker: null };
  }

  return { status: "REVIEW_REQUIRED", physicalPageBlocker: null };
}
