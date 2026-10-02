"use client";

// ============================================================
// Shared UI states — loading skeletons, error panels, and the
// human-readable <UserMessage> renderer fed by the error catalog.
// ============================================================

import { useState } from "react";
import { getUserMessage, type MessageSeverity } from "@/lib/ui/user-messages";

const SEVERITY_STYLES: Record<MessageSeverity, { wrap: string; icon: string; title: string }> = {
  INFO: {
    wrap: "bg-dvivid-info-light border-dvivid-primary-border",
    icon: "text-dvivid-primary",
    title: "text-dvivid-text-primary",
  },
  WARNING: {
    wrap: "bg-dvivid-warning-light border-dvivid-warning/25",
    icon: "text-dvivid-warning",
    title: "text-dvivid-text-primary",
  },
  ERROR: {
    wrap: "bg-dvivid-error-light border-dvivid-error/25",
    icon: "text-dvivid-error",
    title: "text-dvivid-text-primary",
  },
  ACTION_REQUIRED: {
    wrap: "bg-dvivid-primary-light border-dvivid-primary-border",
    icon: "text-dvivid-primary",
    title: "text-dvivid-text-primary",
  },
};

const SEVERITY_ICON: Record<MessageSeverity, string> = {
  INFO: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  WARNING: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  ERROR: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  ACTION_REQUIRED: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
};

/**
 * Renders consultant-facing copy for an internal error code.
 * The raw code is never displayed unless the user expands
 * "Technical details".
 */
export function UserMessage({
  code,
  fallback,
  onAction,
  className = "",
}: {
  /** Stable internal error code (e.g. "CV_EXTRACTION_FAILED"). */
  code?: string | null;
  /** Free-form fallback text when no code is present. */
  fallback?: string;
  onAction?: (actionType: string) => void;
  className?: string;
}) {
  const [showTech, setShowTech] = useState(false);
  const msg = getUserMessage(code);
  const s = SEVERITY_STYLES[msg.severity];

  return (
    <div className={`rounded-input border p-4 ${s.wrap} ${className}`} role={msg.severity === "ERROR" ? "alert" : "status"}>
      <div className="flex items-start gap-3">
        <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${s.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEVERITY_ICON[msg.severity]} />
        </svg>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${s.title}`}>{msg.title}</p>
          <p className="text-sm text-dvivid-text-secondary mt-0.5">
            {fallback || msg.description}
          </p>
          {(msg.actionLabel && onAction) && (
            <button
              type="button"
              onClick={() => onAction(msg.actionType || "NONE")}
              className="mt-2 text-sm font-medium text-dvivid-primary hover:underline"
            >
              {msg.actionLabel}
            </button>
          )}
          {msg.technicalCode && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowTech(v => !v)}
                className="text-xs text-dvivid-text-muted hover:text-dvivid-text-secondary underline-offset-2 hover:underline"
                aria-expanded={showTech}
              >
                Technical details {showTech ? "▴" : "▾"}
              </button>
              {showTech && (
                <code className="block mt-1 text-xs text-dvivid-text-muted font-mono">{msg.technicalCode}</code>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Skeleton block — keep shapes compact and realistic. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-dvivid-border/60 ${className}`} aria-hidden="true" />;
}

/** Table/worklist skeleton. */
export function LoadingRows({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-0 divide-y divide-dvivid-border-light ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="w-9 h-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Panel-level load error with retry. */
export function ErrorState({
  title = "We couldn't load this",
  description = "Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="text-center py-14 px-6" role="alert">
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-dvivid-error-light flex items-center justify-center">
        <svg className="w-6 h-6 text-dvivid-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEVERITY_ICON.ERROR} />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-dvivid-text-primary mb-1">{title}</h3>
      <p className="text-sm text-dvivid-text-secondary mb-5 max-w-sm mx-auto">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium rounded-input border border-dvivid-border bg-white text-dvivid-text-primary hover:border-dvivid-primary hover:text-dvivid-primary transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
