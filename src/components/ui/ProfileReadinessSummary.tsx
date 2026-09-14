"use client";

import Link from "next/link";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { getProfileReadiness } from "@/lib/application/intake-completion";

interface ProfileReadinessSummaryProps {
  studentId: string;
  applicationId: string;
  profile: any;
  application?: any;
}

/**
 * Profile readiness summary shown before generation.
 * Displays completion status for all 9 sections.
 */
export function ProfileReadinessSummary({ studentId, applicationId, profile, application }: ProfileReadinessSummaryProps) {
  const readiness = getProfileReadiness(profile, application);

  const statusColors: Record<string, string> = {
    complete: "bg-dvivid-success-light text-dvivid-success",
    incomplete: "bg-amber-50 text-amber-700",
    missing: "bg-dvivid-error-light text-dvivid-error",
    optional: "bg-gray-100 text-dvivid-text-muted",
    "optional-skipped": "bg-gray-100 text-dvivid-text-muted",
  };

  const statusLabels: Record<string, string> = {
    complete: "Complete",
    incomplete: "In Progress",
    missing: "Missing",
    optional: "Optional — Not provided",
    "optional-skipped": "Skipped",
  };

  return (
    <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6">
      <h3 className="text-card-title text-dvivid-text-primary mb-1">Profile Readiness</h3>
      <p className="text-sm text-dvivid-text-secondary mb-4">
        Review your intake completion before generating.
      </p>

      <div className="space-y-2 mb-4">
        {readiness.sections.map(section => (
          <div key={section.sectionId} className="flex items-center justify-between py-1.5 border-b border-dvivid-border-light last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-dvivid-text-primary">{section.label}</span>
              {section.optional && (
                <span className="text-xs text-dvivid-text-muted">(optional)</span>
              )}
            </div>
            <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium ${statusColors[section.status]}`}>
              {statusLabels[section.status]}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-dvivid-text-secondary">
          {readiness.requiredComplete}/{readiness.requiredTotal} required sections complete
        </span>
        <span className="text-dvivid-text-muted">·</span>
        <span className="text-dvivid-text-secondary">
          {readiness.optionalComplete}/{readiness.optionalTotal} optional sections complete
        </span>
      </div>

      {!readiness.canGenerate && readiness.weakAreas.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-input p-3 mb-4">
          <p className="text-sm text-amber-800">
            <strong>Missing:</strong> {readiness.weakAreas.join(", ")}
          </p>
          <p className="text-sm text-amber-700 mt-1">
            Generation is possible, but missing information may make the document more generic.
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Link href={`/students/${studentId}/applications/${applicationId}/intake/student-details`}>
          <SecondaryButton>Improve Profile</SecondaryButton>
        </Link>
        {readiness.canGenerate ? (
          <span className="px-4 py-2 bg-dvivid-success-light text-dvivid-success rounded-input text-sm font-medium">
            ✓ Ready to Generate
          </span>
        ) : (
          <span className="px-4 py-2 bg-amber-50 text-amber-700 rounded-input text-sm font-medium">
            Generate Anyway
          </span>
        )}
      </div>
    </div>
  );
}
