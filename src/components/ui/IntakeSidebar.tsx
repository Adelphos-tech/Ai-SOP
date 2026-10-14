"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { INTAKE_SECTIONS } from "@/lib/application/intake-completion";
import type { SectionCompletion } from "@/lib/application/intake-completion";

interface IntakeSidebarProps {
  studentId: string;
  applicationId: string;
  completions: SectionCompletion[];
  readiness: {
    requiredComplete: number;
    requiredTotal: number;
    optionalComplete: number;
    optionalTotal: number;
    canGenerate: boolean;
    weakAreas: string[];
  };
  application?: {
    universityName: string;
    programName: string;
    degree: string;
    country: string;
    intake: string;
    intakeYear: string;
  } | null;
  studentName?: string;
  /** Called before navigation; return false to block. */
  onNavigate?: (href: string) => boolean;
}

/**
 * Desktop sticky sidebar for the 9-section intake.
 * Shows:
 *   - Application context (student name, university, program)
 *   - Overall progress bar
 *   - All 9 sections with status badges
 *   - Next recommended action
 *   - Review link
 */
export function IntakeSidebar({
  studentId,
  applicationId,
  completions,
  readiness,
  application,
  studentName,
  onNavigate,
}: IntakeSidebarProps) {
  const pathname = usePathname();
  const basePath = `/students/${studentId}/applications/${applicationId}/intake`;

  const currentSlug = pathname.split("/intake/")[1]?.split("/")[0] || "";

  const requiredPercent =
    readiness.requiredTotal > 0
      ? Math.round((readiness.requiredComplete / readiness.requiredTotal) * 100)
      : 0;

  const firstMissing = completions.find(
    c => !c.optional && c.status !== "complete"
  );
  const nextAction = readiness.canGenerate
    ? { text: "Ready for document generation", type: "ready" as const }
    : firstMissing
    ? { text: `Next: ${firstMissing.label}`, slug: firstMissing.slug, type: "next" as const }
    : { text: "Complete optional sections", type: "optional" as const };

  return (
    <aside className="hidden lg:block sticky top-[88px] self-start w-[280px] flex-shrink-0">
      {/* Application Context Card */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-5 mb-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-dvivid-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dvivid-text-primary truncate">
              {application?.universityName || "Application"}
            </p>
            <p className="text-xs text-dvivid-text-secondary truncate">
              {application?.programName} {application?.degree && `· ${application.degree}`}
            </p>
            {studentName && (
              <p className="text-xs text-dvivid-text-muted mt-0.5 truncate">{studentName}</p>
            )}
          </div>
        </div>
      </div>

      {/* Progress Card */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-dvivid-text-primary">Progress</span>
          <span className="text-xs font-medium text-dvivid-primary">{requiredPercent}%</span>
        </div>
        <div className="w-full h-2 bg-dvivid-border-light rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-dvivid-primary rounded-full transition-all duration-500"
            style={{ width: `${requiredPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-dvivid-text-secondary">
            {readiness.requiredComplete}/{readiness.requiredTotal} required
          </span>
          {readiness.optionalTotal > 0 && (
            <span className="text-dvivid-text-muted">
              {readiness.optionalComplete}/{readiness.optionalTotal} optional
            </span>
          )}
        </div>
      </div>

      {/* Sections List */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-4 mb-4">
        <p className="text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide mb-3">
          Sections
        </p>
        <nav className="space-y-1">
          {INTAKE_SECTIONS.map(section => {
            const completion = completions.find(c => c.sectionId === section.id);
            const isCurrent = section.slug === currentSlug;
            const isComplete = completion?.status === "complete";
            const isOptional = section.optional;
            const isClickable = isComplete || section.id < (completions.find(c => c.slug === currentSlug)?.sectionId || 99);

            return (
              <Link
                key={section.id}
                href={`${basePath}/${section.slug}`}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  isCurrent
                    ? "bg-dvivid-primary-light text-dvivid-primary font-medium"
                    : isClickable
                    ? "text-dvivid-text-secondary hover:bg-dvivid-surface-alt hover:text-dvivid-text-primary"
                    : "text-dvivid-text-muted cursor-default pointer-events-none"
                }`}
                onClick={e => {
                  if (!isClickable && !isCurrent) {
                    e.preventDefault();
                    return;
                  }
                  if (onNavigate && !onNavigate(`${basePath}/${section.slug}`)) {
                    e.preventDefault();
                  }
                }}
              >
                <StatusIcon
                  status={isComplete ? "complete" : isOptional ? "optional" : "incomplete"}
                  isCurrent={isCurrent}
                />
                <span className="flex-1 truncate">{section.label}</span>
                {isOptional && (
                  <span className="text-[10px] text-dvivid-text-muted flex-shrink-0">Opt</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Next Action Card */}
      <div
        className={`rounded-card p-4 mb-4 ${
          readiness.canGenerate
            ? "bg-dvivid-success-light border border-dvivid-success/20"
            : "bg-dvivid-primary-light border border-dvivid-primary-border"
        }`}
      >
        <p className="text-xs font-semibold text-dvivid-text-secondary mb-1.5">Recommended</p>
        {nextAction.type === "ready" ? (
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-dvivid-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-dvivid-success">{nextAction.text}</span>
          </div>
        ) : nextAction.type === "next" && nextAction.slug ? (
          <Link
            href={`${basePath}/${nextAction.slug}`}
            className="flex items-center gap-2 text-sm font-medium text-dvivid-primary hover:underline"
            onClick={e => {
              if (onNavigate && nextAction.slug && !onNavigate(`${basePath}/${nextAction.slug}`)) {
                e.preventDefault();
              }
            }}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            {nextAction.text}
          </Link>
        ) : (
          <span className="text-sm text-dvivid-text-secondary">{nextAction.text}</span>
        )}
      </div>

      {/* Review Link */}
      <Link
        href={`${basePath}/student-details`}
        className="flex items-center gap-2 text-sm text-dvivid-text-secondary hover:text-dvivid-primary transition-colors px-2"
        onClick={e => {
          if (onNavigate && !onNavigate(`${basePath}/student-details`)) {
            e.preventDefault();
          }
        }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
        Review all information
      </Link>
    </aside>
  );
}

function StatusIcon({
  status,
  isCurrent,
}: {
  status: "complete" | "incomplete" | "optional";
  isCurrent: boolean;
}) {
  if (status === "complete") {
    return (
      <div className="w-5 h-5 rounded-full bg-dvivid-primary flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (isCurrent) {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-dvivid-primary flex items-center justify-center flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-dvivid-primary" />
      </div>
    );
  }
  if (status === "optional") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-dvivid-text-muted/40 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] text-dvivid-text-muted">-</span>
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border-2 border-dvivid-border flex items-center justify-center flex-shrink-0">
      <span className="text-[10px] text-dvivid-text-muted">{/* empty */}</span>
    </div>
  );
}

/**
 * Mobile section selector dropdown.
 * Shows current section + all sections in a dropdown.
 */
export function IntakeMobileNav({
  studentId,
  applicationId,
  completions,
  readiness,
  onNavigate,
}: {
  studentId: string;
  applicationId: string;
  completions: SectionCompletion[];
  readiness: {
    requiredComplete: number;
    requiredTotal: number;
    canGenerate: boolean;
  };
  onNavigate?: (href: string) => boolean;
}) {
  const pathname = usePathname();
  const basePath = `/students/${studentId}/applications/${applicationId}/intake`;
  const currentSlug = pathname.split("/intake/")[1]?.split("/")[0] || "";
  const currentSection = INTAKE_SECTIONS.find(s => s.slug === currentSlug);

  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden mb-4">
      {/* Current section + progress */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-4">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between text-left"
        >
          <div>
            <p className="text-sm font-medium text-dvivid-text-primary">
              {currentSection?.label || "Select section"}
            </p>
            <p className="text-xs text-dvivid-text-secondary mt-0.5">
              {readiness.requiredComplete}/{readiness.requiredTotal} required complete
            </p>
          </div>
          <svg
            className={`w-5 h-5 text-dvivid-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Progress bar */}
        <div className="mt-3 w-full h-1.5 bg-dvivid-border-light rounded-full overflow-hidden">
          <div
            className="h-full bg-dvivid-primary rounded-full transition-all duration-500"
            style={{
              width: `${readiness.requiredTotal > 0 ? Math.round((readiness.requiredComplete / readiness.requiredTotal) * 100) : 0}%`,
            }}
          />
        </div>

        {/* Dropdown */}
        {open && (
          <nav className="mt-3 pt-3 border-t border-dvivid-border-light space-y-0.5">
            {INTAKE_SECTIONS.map(section => {
              const completion = completions.find(c => c.sectionId === section.id);
              const isCurrent = section.slug === currentSlug;
              const isComplete = completion?.status === "complete";
              const isOptional = section.optional;

              return (
                <Link
                  key={section.id}
                  href={`${basePath}/${section.slug}`}
                  onClick={e => {
                    if (onNavigate && !onNavigate(`${basePath}/${section.slug}`)) {
                      e.preventDefault();
                      return;
                    }
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${
                    isCurrent
                      ? "bg-dvivid-primary-light text-dvivid-primary font-medium"
                      : "text-dvivid-text-secondary hover:bg-dvivid-surface-alt"
                  }`}
                >
                  <StatusIcon status={isComplete ? "complete" : isOptional ? "optional" : "incomplete"} isCurrent={isCurrent} />
                  <span className="flex-1">{section.label}</span>
                  {isOptional && (
                    <span className="text-[10px] text-dvivid-text-muted">Optional</span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

