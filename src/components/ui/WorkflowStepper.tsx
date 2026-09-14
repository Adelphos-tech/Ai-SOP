"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ProgressStepper, StepperStep } from "./ProgressStepper";

/**
 * Phase SOP-UI-35A: WorkflowStepper
 *
 * Maps the current route to one of 7 canonical consultant workflow steps:
 *   1. Student
 *   2. School & Program
 *   3. Background & Experience
 *   4. Story & Goals
 *   5. Document & Prompt
 *   6. Generate
 *   7. Review & Export
 *
 * The active step is derived from the route. Completed steps are clickable
 * (navigate backward). The current and upcoming steps are non-clickable
 * from the stepper itself (the page itself drives forward navigation).
 */

export interface WorkflowStepDef {
  label: string;
  /** Routes that belong to this workflow step (prefix match) */
  routes: string[];
  /** Where to navigate when clicking back to this completed step */
  backHref: string;
}

export const WORKFLOW_STEPS: WorkflowStepDef[] = [
  {
    label: "Student",
    routes: ["/students", "/personal", "/app-setup"],
    backHref: "/students",
  },
  {
    label: "School & Program",
    routes: ["/application", "/app-setup"],
    backHref: "/app-setup",
  },
  {
    label: "Background & Experience",
    routes: ["/education", "/english", "/experience", "/projects", "/achievements", "/documents"],
    backHref: "/education",
  },
  {
    label: "Story & Goals",
    routes: ["/personal-story", "/career", "/preferences"],
    backHref: "/personal-story",
  },
  {
    label: "Document & Prompt",
    routes: ["/requirements-library", "/requirements"],
    backHref: "/requirements-library",
  },
  {
    label: "Generate",
    routes: ["/fact-sheet"],
    backHref: "/fact-sheet",
  },
  {
    label: "Review & Export",
    routes: ["/sop-result"],
    backHref: "/",
  },
];

/**
 * Determine which workflow step (0-indexed) a path belongs to.
 * Document and application workspace routes are matched specially
 * since they contain dynamic segments.
 */
export function getWorkflowStepIndex(pathname: string): number {
  // Document workspace → Review & Export (step 6, 0-indexed)
  if (pathname.match(/\/students\/[^/]+\/applications\/[^/]+\/documents\/[^/]+/)) {
    return 6;
  }
  // Application workspace → Document & Prompt (step 4, 0-indexed)
  if (pathname.match(/\/students\/[^/]+\/applications\/[^/]+$/)) {
    return 4;
  }
  // Student workspace → Student (step 0)
  if (pathname.match(/\/students\/[^/]+$/)) {
    return 0;
  }

  // Match against route prefixes
  for (let i = 0; i < WORKFLOW_STEPS.length; i++) {
    for (const route of WORKFLOW_STEPS[i].routes) {
      if (pathname === route || pathname.startsWith(route + "/")) {
        return i;
      }
    }
  }
  return 0;
}

export function WorkflowStepper({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const activeIndex = getWorkflowStepIndex(pathname);

  const steps: StepperStep[] = WORKFLOW_STEPS.map((def, i) => ({
    label: def.label,
    status: i < activeIndex ? "completed" : i === activeIndex ? "active" : "upcoming",
    href: i < activeIndex ? def.backHref : undefined,
  }));

  return (
    <div className={`bg-white border border-dvivid-border rounded-card shadow-card px-6 py-5 mb-6 ${className}`}>
      <ProgressStepper steps={steps} />
    </div>
  );
}

/**
 * Sticky version — stays near the top on long pages.
 * Uses a lighter background and reduced padding to save space.
 */
export function StickyWorkflowStepper({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const activeIndex = getWorkflowStepIndex(pathname);

  const steps: StepperStep[] = WORKFLOW_STEPS.map((def, i) => ({
    label: def.label,
    status: i < activeIndex ? "completed" : i === activeIndex ? "active" : "upcoming",
    href: i < activeIndex ? def.backHref : undefined,
  }));

  return (
    <div className={`sticky top-[72px] z-20 bg-white/95 backdrop-blur border-b border-dvivid-border px-4 md:px-8 py-3 mb-6 ${className}`}>
      <div className="max-w-[1280px] mx-auto">
        <ProgressStepper steps={steps} />
      </div>
    </div>
  );
}
