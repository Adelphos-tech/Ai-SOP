"use client";

import Link from "next/link";

export interface StepperStep {
  label: string;
  status: "completed" | "active" | "upcoming";
  /** Optional href for clickable completed steps */
  href?: string;
}

export function ProgressStepper({
  steps,
  className = "",
}: {
  steps: StepperStep[];
  className?: string;
}) {
  return (
    <>
      {/* Desktop: CSS grid with 6 equal columns — no scrollbar, labels can wrap */}
      <div className={`hidden lg:grid grid-cols-6 gap-0 ${className}`}>
        {steps.map((step, i) => {
          const isClickable = step.status === "completed" && step.href;
          const circle = (
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all ${
                step.status === "completed"
                  ? "bg-dvivid-primary border-dvivid-primary text-white"
                  : step.status === "active"
                  ? "bg-white border-dvivid-primary text-dvivid-primary shadow-cta"
                  : "bg-white border-dvivid-border text-dvivid-text-muted"
              } ${isClickable ? "cursor-pointer hover:scale-110" : ""}`}
            >
              {step.status === "completed" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
          );

          return (
            <div key={i} className="relative flex flex-col items-center">
              {/* Connector line to next step (absolute, centered on circle) */}
              {i < steps.length - 1 && (
                <div
                  className={`absolute top-[18px] left-[calc(50%+22px)] right-[calc(-50%+22px)] h-0.5 ${
                    step.status === "completed" ? "bg-dvivid-primary" : "bg-dvivid-border"
                  }`}
                />
              )}
              {/* Circle */}
              <div className="relative z-10 bg-white">
                {isClickable ? (
                  <Link href={step.href!}>{circle}</Link>
                ) : (
                  circle
                )}
              </div>
              {/* Label — allowed to wrap to 2 lines */}
              <span
                className={`mt-2 text-xs font-medium text-center leading-tight ${
                  step.status === "active"
                    ? "text-dvivid-primary"
                    : step.status === "completed"
                    ? "text-dvivid-text-primary"
                    : "text-dvivid-text-muted"
                } ${isClickable ? "cursor-pointer hover:text-dvivid-primary" : ""}`}
              >
                {isClickable ? (
                  <Link href={step.href!}>{step.label}</Link>
                ) : (
                  step.label
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mobile/tablet: horizontal scroll with hidden scrollbar */}
      <div
        className={`lg:hidden overflow-x-auto scrollbar-hide ${className}`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
        <div className="flex items-center min-w-max">
          {steps.map((step, i) => {
            const isClickable = step.status === "completed" && step.href;
            const circle = (
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all flex-shrink-0 ${
                  step.status === "completed"
                    ? "bg-dvivid-primary border-dvivid-primary text-white"
                    : step.status === "active"
                    ? "bg-white border-dvivid-primary text-dvivid-primary shadow-cta"
                    : "bg-white border-dvivid-border text-dvivid-text-muted"
                } ${isClickable ? "cursor-pointer hover:scale-110" : ""}`}
              >
                {step.status === "completed" ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
            );

            return (
              <div key={i} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                  {isClickable ? (
                    <Link href={step.href!}>{circle}</Link>
                  ) : (
                    circle
                  )}
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      step.status === "active"
                        ? "text-dvivid-primary"
                        : step.status === "completed"
                        ? "text-dvivid-text-primary"
                        : "text-dvivid-text-muted"
                    } ${isClickable ? "cursor-pointer hover:text-dvivid-primary" : ""}`}
                  >
                    {isClickable ? (
                      <Link href={step.href!}>{step.label}</Link>
                    ) : (
                      step.label
                    )}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-0.5 mx-3 -mt-6" style={{ minWidth: "24px" }}>
                    <div
                      className={`h-full transition-all ${
                        step.status === "completed" ? "bg-dvivid-primary" : "bg-dvivid-border"
                      }`}
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
