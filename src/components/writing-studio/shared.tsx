"use client";

// Shared primitives for the AI Writing Studio (D-VIVID design system).

import type { DetectorId } from "@/lib/writing-review/types";

export const DETECTOR_NAMES: Record<DetectorId, string> = {
  RYNE_AI: "Ryne AI (Beast Mode)", TURNITIN: "Turnitin", GPTZERO: "GPTZero",
  ZEROGPT: "ZeroGPT", REILAA: "Ryne AI", ORIGINALITY: "Originality.ai",
  QUILLBOT: "QuillBot", SURFER: "Surfer",
};

export interface StudioVersion {
  id: string;
  versionNumber: number;
  content: string;
  contentHash: string;
}

export function fmtUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function Gauge({ percent, size = 64 }: { percent?: number; size?: number }) {
  const R = 26, C = 2 * Math.PI * R;
  const scored = typeof percent === "number";
  const frac = scored ? Math.min(100, Math.max(0, percent!)) / 100 : 0;
  const color = !scored ? "#E2E8F0" : percent! >= 50 ? "#D14343" : percent! >= 25 ? "#D97706" : "#159455";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="#EEF1F6" strokeWidth="6" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${scored ? "text-dvivid-text-primary" : "text-dvivid-text-muted"}`}>
          {scored ? `${Math.round(percent!)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children, role }: { tone?: "info" | "warning" | "error" | "success"; children: React.ReactNode; role?: string }) {
  const cls = {
    info: "bg-dvivid-info-light border-dvivid-primary-border text-dvivid-primary",
    warning: "bg-dvivid-warning-light border-amber-200 text-dvivid-warning",
    error: "bg-dvivid-error-light border-red-200 text-dvivid-error",
    success: "bg-dvivid-success-light border-green-200 text-dvivid-success",
  }[tone];
  return <div role={role ?? (tone === "error" ? "alert" : "status")} className={`border rounded-input px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-medium text-dvivid-text-secondary cursor-pointer select-none">
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus-visible:shadow-focus ${checked ? "bg-dvivid-primary" : "bg-dvivid-border"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      {label}
    </label>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange, label, className = "" }: {
  tabs: Array<{ id: T; label: React.ReactNode }>; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex p-1 bg-dvivid-surface-alt border border-dvivid-border rounded-button ${className}`}
      onKeyDown={e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = tabs.findIndex(t => t.id === value);
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        onChange(next.id);
        (e.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
      }}>
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`flex-1 px-4 py-2 rounded-[6px] text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:shadow-focus ${
            value === t.id ? "bg-dvivid-primary text-white shadow-cta" : "text-dvivid-text-secondary hover:text-dvivid-primary"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- report-run store (shared by both panels) ----------

import type { ReportRun } from "@/lib/writing-review/report";

export const REPORT_HISTORY_LIMIT = 10;
export function reportStoreKey(documentId: string): string {
  return `dvivid-writing-studio-reports:${documentId}`;
}
export function readReportRuns(documentId: string): ReportRun[] {
  try {
    const v = JSON.parse(localStorage.getItem(reportStoreKey(documentId)) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
/** Merge one run into the browser-local history (dedup by id,
 *  newest first, demo runs never persisted). */
export function persistReportRun(documentId: string, run: ReportRun): void {
  const next = [run, ...readReportRuns(documentId).filter(r => r.id !== run.id)];
  try {
    localStorage.setItem(reportStoreKey(documentId),
      JSON.stringify(next.filter(r => r.id !== "demo").slice(0, REPORT_HISTORY_LIMIT)));
  } catch { /* quota */ }
}

/** Compact inline AI-detection badge for panel headings. Subtle
 *  color only — a percentage is always an estimate, never a verdict. */
export function ScoreBadge({ label, percent, title }: { label: string; percent: number; title?: string }) {
  const cls = percent >= 50
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-green-50 text-green-700 border-green-200";
  return (
    <span title={title ?? `AI detection estimate from ${label} — detectors can be wrong; not a guarantee.`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${cls}`}>
      {label} · {Math.round(percent)}% AI
    </span>
  );
}
