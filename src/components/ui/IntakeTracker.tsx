"use client";

import Link from "next/link";
import { INTAKE_SECTIONS } from "@/lib/application/intake-completion";
import type { SectionCompletion } from "@/lib/application/intake-completion";

interface IntakeTrackerProps {
  studentId: string;
  applicationId: string;
  currentStep: number;
  completions: SectionCompletion[];
}

/**
 * 9-section intake tracker.
 * Desktop: all 9 steps visible in a grid (no scrollbar).
 * Mobile: horizontal scroll.
 * Completed: check mark (blue, clickable).
 * Current: solid blue.
 * Upcoming: gray.
 */
export function IntakeTracker({ studentId, applicationId, currentStep, completions }: IntakeTrackerProps) {
  const basePath = `/students/${studentId}/applications/${applicationId}/intake`;

  const steps = INTAKE_SECTIONS.map((section, i) => {
    const completion = completions.find(c => c.sectionId === section.id);
    const isCurrent = section.id === currentStep;
    const isCompleted = completion?.status === "complete";
    const isOptional = section.optional;
    const isOptionalSkipped = completion?.status === "optional";
    const isClickable = (isCompleted || i < currentStep - 1) && !isCurrent;

    return {
      ...section,
      isCurrent,
      isCompleted,
      isOptional,
      isOptionalSkipped,
      isClickable,
      href: isClickable ? `${basePath}/${section.slug}` : undefined,
    };
  });

  return (
    <>
      {/* Desktop: 9-column grid */}
      <div className="hidden lg:grid grid-cols-9 gap-0 bg-white border border-dvivid-border rounded-card shadow-card px-4 py-4 mb-6">
        {steps.map((step, i) => {
          const circle = (
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all ${
                step.isCompleted
                  ? "bg-dvivid-primary border-dvivid-primary text-white"
                  : step.isCurrent
                  ? "bg-white border-dvivid-primary text-dvivid-primary shadow-cta"
                  : "bg-white border-dvivid-border text-dvivid-text-muted"
              } ${step.isClickable ? "cursor-pointer hover:scale-110" : ""}`}
            >
              {step.isCompleted ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step.id
              )}
            </div>
          );

          return (
            <div key={i} className="relative flex flex-col items-center">
              {i < steps.length - 1 && (
                <div
                  className={`absolute top-[16px] left-[calc(50%+20px)] right-[calc(-50%+20px)] h-0.5 ${
                    step.isCompleted ? "bg-dvivid-primary" : "bg-dvivid-border"
                  }`}
                />
              )}
              <div className="relative z-10 bg-white">
                {step.isClickable && step.href ? (
                  <Link href={step.href}>{circle}</Link>
                ) : (
                  circle
                )}
              </div>
              <span
                className={`mt-1.5 text-[11px] font-medium text-center leading-tight max-w-[90px] ${
                  step.isCurrent
                    ? "text-dvivid-primary"
                    : step.isCompleted
                    ? "text-dvivid-text-primary"
                    : "text-dvivid-text-muted"
                } ${step.isClickable ? "cursor-pointer hover:text-dvivid-primary" : ""}`}
              >
                {step.isClickable && step.href ? (
                  <Link href={step.href}>{step.label}</Link>
                ) : (
                  step.label
                )}
                {step.isOptional && !step.isCompleted && (
                  <span className="block text-[10px] text-dvivid-text-muted/70">Optional</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mobile: horizontal scroll */}
      <div
        className="lg:hidden overflow-x-auto bg-white border border-dvivid-border rounded-card shadow-card px-3 py-3 mb-6"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
        <div className="flex items-center min-w-max">
          {steps.map((step, i) => {
            const circle = (
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all flex-shrink-0 ${
                  step.isCompleted
                    ? "bg-dvivid-primary border-dvivid-primary text-white"
                    : step.isCurrent
                    ? "bg-white border-dvivid-primary text-dvivid-primary shadow-cta"
                    : "bg-white border-dvivid-border text-dvivid-text-muted"
                } ${step.isClickable ? "cursor-pointer hover:scale-110" : ""}`}
              >
                {step.isCompleted ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.id
                )}
              </div>
            );

            return (
              <div key={i} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  {step.isClickable && step.href ? (
                    <Link href={step.href}>{circle}</Link>
                  ) : (
                    circle
                  )}
                  <span
                    className={`text-[11px] font-medium whitespace-nowrap ${
                      step.isCurrent
                        ? "text-dvivid-primary"
                        : step.isCompleted
                        ? "text-dvivid-text-primary"
                        : "text-dvivid-text-muted"
                    }`}
                  >
                    {step.isClickable && step.href ? (
                      <Link href={step.href}>{step.label}</Link>
                    ) : (
                      step.label
                    )}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-0.5 mx-2 -mt-6" style={{ minWidth: "20px" }}>
                    <div
                      className={`h-full ${step.isCompleted ? "bg-dvivid-primary" : "bg-dvivid-border"}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
