"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ProgressStepper, StepperStep } from "./ProgressStepper";

// ============================================================
// CANONICAL WORKFLOW TRACKER
// ============================================================
// 4-step consultant journey (simplified):
//   1. Applicant
//   2. Application   (includes completing missing information)
//   3. Document      (create + generate)
//   4. Review        (review & download)
//
// "Intake" is not a product destination — it is missing information
// inside the Application step. "Generate" is an action inside the
// Document step, not a navigation step.
//
// The active step is derived from BOTH the route AND known
// workflow state (document generation/review status). Completed
// steps link only to canonical database-backed pages.
// ============================================================

// ============================================================
// STEP DEFINITIONS
// ============================================================

export interface CanonicalStepDef {
  label: string;
  /** Index (0-based) of this step */
  index: number;
}

export const CANONICAL_STEPS: CanonicalStepDef[] = [
  { label: "Applicant", index: 0 },
  { label: "Application", index: 1 },
  { label: "Document", index: 2 },
  { label: "Review", index: 3 },
];

// ============================================================
// ROUTE PATTERN MATCHING
// ============================================================

// Dynamic route patterns for the canonical flow.
// We use regex to extract studentId / applicationId / documentId.

const STUDENT_NEW_RE = /^\/students\/new$/;
const STUDENT_WORKSPACE_RE = /^\/students\/([^/]+)$/;
const APPLICATION_WORKSPACE_RE = /^\/students\/([^/]+)\/applications\/([^/]+)$/;
const INTAKE_RE = /^\/students\/([^/]+)\/applications\/([^/]+)\/intake(?:\/(.+))?$/;
const DOCUMENT_RE = /^\/students\/([^/]+)\/applications\/([^/]+)\/documents\/([^/]+)$/;

interface RouteInfo {
  studentId: string | null;
  applicationId: string | null;
  documentId: string | null;
  /** Which canonical step this route maps to (0-based), or null if not a journey page */
  routeStep: number | null;
}

function parseRoute(pathname: string): RouteInfo {
  if (STUDENT_NEW_RE.test(pathname)) {
    return { studentId: null, applicationId: null, documentId: null, routeStep: 0 };
  }
  let m = pathname.match(STUDENT_WORKSPACE_RE);
  if (m) {
    return { studentId: m[1], applicationId: null, documentId: null, routeStep: 0 };
  }
  m = pathname.match(INTAKE_RE);
  if (m) {
    // Intake = completing missing information inside the Application step
    return { studentId: m[1], applicationId: m[2], documentId: null, routeStep: 1 };
  }
  m = pathname.match(DOCUMENT_RE);
  if (m) {
    return { studentId: m[1], applicationId: m[2], documentId: m[3], routeStep: 2 };
  }
  m = pathname.match(APPLICATION_WORKSPACE_RE);
  if (m) {
    return { studentId: m[1], applicationId: m[2], documentId: null, routeStep: 1 };
  }
  return { studentId: null, applicationId: null, documentId: null, routeStep: null };
}

// ============================================================
// STATE-BASED STEP RESOLUTION
// ============================================================

/**
 * Determine the effective active step from route + document state.
 *
 * On the document workspace route (routeStep 2), the step depends on
 * the document's generation/review status:
 *   NOT_STARTED / IN_PROGRESS / GENERATING → Document (step 2)
 *   GENERATED / REVIEWED / FINALIZED / FAILED → Review (step 3)
 *     (FAILED is treated as Review so the consultant can retry)
 *
 * On other routes, the route step is used directly.
 */
function resolveActiveStep(
  routeStep: number,
  documentId: string | null,
  generationStatus?: string,
  reviewStatus?: string,
): number {
  if (routeStep !== 2 || !documentId) {
    return routeStep;
  }

  // Document workspace — derive from document state
  if (!generationStatus || generationStatus === "NOT_STARTED" ||
      generationStatus === "IN_PROGRESS" || generationStatus === "GENERATING") {
    return 2; // Document (create/generate in progress)
  }
  // GENERATED, REVIEWED, FINALIZED, FAILED → Review
  return 3;
}

// ============================================================
// COMPLETED STEP DESTINATIONS
// ============================================================

/**
 * Build the href for a completed step.
 * Only canonical database-backed routes are used.
 * Returns undefined if the step cannot be navigated to (missing IDs).
 */
function stepHref(
  stepIndex: number,
  info: RouteInfo,
  intakeComplete?: boolean,
  firstIncompleteIntakeSlug?: string,
): string | undefined {
  const { studentId, applicationId, documentId } = info;

  switch (stepIndex) {
    case 0: // Applicant → student workspace
      if (studentId) return `/students/${studentId}`;
      return undefined;

    case 1: // Application → application workspace
      if (studentId && applicationId) return `/students/${studentId}/applications/${applicationId}`;
      return undefined;

    case 2: // Document → document workspace
      if (studentId && applicationId && documentId) {
        return `/students/${studentId}/applications/${applicationId}/documents/${documentId}`;
      }
      return undefined;

    case 3: // Review → document workspace
      if (studentId && applicationId && documentId) {
        return `/students/${studentId}/applications/${applicationId}/documents/${documentId}`;
      }
      return undefined;

    default:
      return undefined;
  }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export interface WorkflowStepperProps {
  /** Document generation status — used for state-based Generate/Review steps */
  generationStatus?: string;
  /** Document review status */
  reviewStatus?: string;
  /** Whether all required intake sections are complete */
  intakeComplete?: boolean;
  /** Slug of the first incomplete required intake section (for Intake step link) */
  firstIncompleteIntakeSlug?: string;
  className?: string;
}

export function WorkflowStepper({
  generationStatus,
  reviewStatus,
  intakeComplete,
  firstIncompleteIntakeSlug,
  className = "",
}: WorkflowStepperProps) {
  const pathname = usePathname();
  const info = parseRoute(pathname);

  // Only render on journey pages
  if (info.routeStep === null) {
    return null;
  }

  const activeStep = resolveActiveStep(
    info.routeStep,
    info.documentId,
    generationStatus,
    reviewStatus,
  );

  const steps: StepperStep[] = CANONICAL_STEPS.map((def) => {
    const isCompleted = def.index < activeStep;
    const isActive = def.index === activeStep;

    // Completed steps are clickable if they have a valid destination
    const href = isCompleted
      ? stepHref(def.index, info, intakeComplete, firstIncompleteIntakeSlug)
      : undefined;

    return {
      label: def.label,
      status: isCompleted ? "completed" : isActive ? "active" : "upcoming",
      href,
    };
  });

  return (
    <div className={`bg-white border border-dvivid-border rounded-card shadow-card px-6 py-5 mb-6 ${className}`}>
      <ProgressStepper steps={steps} />
    </div>
  );
}

// ============================================================
// STICKY VERSION
// ============================================================

export function StickyWorkflowStepper(props: WorkflowStepperProps) {
  const pathname = usePathname();
  const info = parseRoute(pathname);

  if (info.routeStep === null) {
    return null;
  }

  const activeStep = resolveActiveStep(
    info.routeStep,
    info.documentId,
    props.generationStatus,
    props.reviewStatus,
  );

  const steps: StepperStep[] = CANONICAL_STEPS.map((def) => {
    const isCompleted = def.index < activeStep;
    const isActive = def.index === activeStep;
    const href = isCompleted
      ? stepHref(def.index, info, props.intakeComplete, props.firstIncompleteIntakeSlug)
      : undefined;

    return {
      label: def.label,
      status: isCompleted ? "completed" : isActive ? "active" : "upcoming",
      href,
    };
  });

  return (
    <div className={`sticky top-[72px] z-20 bg-white/95 backdrop-blur border-b border-dvivid-border px-4 md:px-8 py-3 mb-6 ${props.className || ""}`}>
      <div className="max-w-[1280px] mx-auto">
        <ProgressStepper steps={steps} />
      </div>
    </div>
  );
}

// ============================================================
// EXPORTED HELPERS (for testing / external use)
// ============================================================

export { parseRoute, resolveActiveStep, stepHref };
