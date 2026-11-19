"use client";

// ============================================================
// AI Writing Studio — AI Detection Report
// Runs ONLY when the user clicks Run Report, on the saved version,
// with the detectors they selected. Findings are aggregated per
// unique document sentence; no composite score is invented. Past
// runs are kept in this browser and marked outdated once the
// document changes — never re-run automatically.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/ui";
import type { DetectionResult, DetectorId, DetectorScore } from "@/lib/writing-review/types";
import { listDetectorDescriptors } from "@/lib/writing-review/detectors";
import { aggregateFindings, detectorVerdict, type ReportRun } from "@/lib/writing-review/report";
import { segmentDocumentSentences, type DocumentSentence } from "@/lib/writing-review/segmentation";
import {
  DETECTOR_NAMES, Gauge, Notice, REPORT_HISTORY_LIMIT, reportStoreKey, Toggle, type StudioVersion,
} from "./shared";
const VERDICT: Record<string, { label: string; cls: string }> = {
  AI: { label: "AI-written", cls: "text-dvivid-error" },
  MIXED: { label: "Mixed", cls: "text-dvivid-warning" },
  HUMAN: { label: "Human-like", cls: "text-dvivid-success" },
};
const MEANING: Record<string, string> = {
  AI_PROBABILITY_PERCENT: "AI probability",
  RAW_MODEL_SIGNAL_PERCENT: "model signal (not a probability)",
  CLASSIFICATION_ONLY: "classification",
};

export interface DetectionConfig { runnable: string[]; maxDetectorsPerRun: number; configured: boolean; reservationCeilingUsd?: number | null }

function DetectorResultCard({ s }: { s: DetectorScore }) {
  const v = detectorVerdict(s);
  return (
    <div className="border border-dvivid-border rounded-card p-3 flex flex-col items-center gap-1.5 min-w-0 bg-white">
      <span className="text-xs font-semibold text-dvivid-text-primary self-start truncate">{DETECTOR_NAMES[s.detector]}</span>
      <Gauge percent={s.status === "SCORED" ? s.scorePercent : undefined} />
      {s.status === "SCORED" ? (
        <span className={`text-[11px] font-semibold ${v ? VERDICT[v].cls : "text-dvivid-text-secondary"}`}>
          {v ? VERDICT[v].label : s.classification || "Scored"}
        </span>
      ) : s.status === "ERROR" ? (
        <span className="text-[11px] font-semibold text-dvivid-error">Provider not responding</span>
      ) : (
        <span className="text-[11px] font-semibold text-dvivid-text-secondary">Unavailable</span>
      )}
      <span className="text-[10px] text-dvivid-text-muted text-center leading-tight line-clamp-3" title={s.error?.message ?? s.note}>
        {s.status === "SCORED"
          ? `${s.scoreMeaning ? MEANING[s.scoreMeaning] : ""}${s.granularity === "DOCUMENT" ? " · document-level" : ""}${s.fallback ? ` · produced by ${s.fallback.to}` : ""}`
          : s.status === "ERROR"
            ? `${s.error?.message ?? "Check failed"} — a failed check is not a 0% score.`
            : s.note ?? "Not run."}
      </span>
    </div>
  );
}

export default function DetectionReportPanel({ version, config, apiUrl, documentId, hasUnsavedRewrite, demoRun }: {
  version: StudioVersion;
  config: DetectionConfig | null;
  apiUrl: string;
  documentId: string;
  hasUnsavedRewrite: boolean;
  demoRun?: ReportRun | null;
}) {
  const storeKey = reportStoreKey(documentId);
  const descriptors = useMemo(() => listDetectorDescriptors(), []);
  const runnable = useMemo(() => new Set(config?.runnable ?? []), [config]);
  const max = config?.maxDetectorsPerRun ?? 3;
  const [selected, setSelected] = useState<string[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [highlight, setHighlight] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setSelected((config?.runnable ?? []).slice(0, max)); }, [config, max]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "[]") as ReportRun[];
      const all = demoRun ? [demoRun, ...saved] : saved;
      setRuns(all); setActiveId(all[0]?.id ?? null);
    } catch { /* corrupt history is ignored */ }
  }, [storeKey, demoRun]);

  const persist = (next: ReportRun[]) => {
    setRuns(next);
    try { localStorage.setItem(storeKey, JSON.stringify(next.filter(r => r.id !== "demo").slice(0, REPORT_HISTORY_LIMIT))); } catch { /* quota */ }
  };

  const active = runs.find(r => r.id === activeId) ?? null;
  const outdated = !!active && active.contentHash !== version.contentHash;
  const agg = useMemo(() => active
    ? aggregateFindings(version.content, active.detection.passages, active.detection.scores.filter(s => active.detectors.includes(s.detector)))
    : null, [active, version.content]);
  const runScores = active ? active.detection.scores.filter(s => active.detectors.includes(s.detector)) : [];
  const verdicts = runScores.map(detectorVerdict).filter(Boolean);

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= max ? prev : [...prev, id]);
  }

  async function runReport() {
    if (running || !selected.length) return;
    if (hasUnsavedRewrite && !window.confirm("You have an unsaved humanized draft. The report checks the SAVED version only. Continue?")) return;
    if (!window.confirm(
      `Run an AI detection report on saved version v${version.versionNumber}?\n\n` +
      `Detectors: ${selected.map(d => DETECTOR_NAMES[d as DetectorId]).join(", ")} (${selected.length} billed request${selected.length > 1 ? "s" : ""})\n` +
      `Cost: Ryne per-detector pricing is unverified — billed in prepaid credits.\n\n` +
      `The document text will be sent to Ryne's detection API.`)) return;
    setRunning(true); setNotice("");
    try {
      const res = await fetch(apiUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck", detectors: selected, confirmPaid: true, operationId: crypto.randomUUID() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data.error || `Report failed (HTTP ${res.status}).`); return; }
      if (data.notice) setNotice(data.notice);
      const d = data.detection as DetectionResult | undefined;
      if (!d || !d.scores?.some(s => selected.includes(s.detector) && (s.status === "SCORED" || s.status === "ERROR"))) return;
      const run: ReportRun = {
        id: crypto.randomUUID(), checkedAt: d.checkedAt, versionId: d.baseVersionId,
        contentHash: d.contentHash, detectors: selected as DetectorId[], detection: d,
      };
      persist([run, ...runs]); setActiveId(run.id); setExpanded(null);
    } catch (e: any) {
      setNotice(e?.message || "Report failed");
    } finally {
      setRunning(false);
    }
  }

  const paragraphs = useMemo(() => {
    const m = new Map<number, DocumentSentence[]>();
    for (const x of segmentDocumentSentences(version.content)) m.set(x.paragraphIndex, [...(m.get(x.paragraphIndex) ?? []), x]);
    return [...m.values()];
  }, [version.content]);
  const findingByStart = new Map(agg?.findings.map((f, i) => [f.start, { f, n: i + 1 }]) ?? []);
  const keyOf = (start: number) => `f${start}`;

  return (
    <section aria-label="AI Detection Report" className="space-y-4">
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-card-title text-dvivid-text-primary">AI Detection Report</h2>
            <p className="text-xs text-dvivid-text-secondary mt-1">
              Checks saved version v{version.versionNumber}. Runs only when you click Run Report — up to {max} detectors per run.
            </p>
          </div>
          <PrimaryButton onClick={runReport} disabled={running || !selected.length || !config?.configured}>
            {running ? "Running report…" : "Run Report"}
          </PrimaryButton>
        </div>
        <fieldset className="mt-4">
          <legend className="sr-only">Detectors</legend>
          <div className="flex flex-wrap gap-2">
            {/* Only verified-runnable detectors — non-API placeholders
                (Beast Mode, Turnitin) and upstream-broken tools are
                hidden, not shown as dead pills. */}
            {descriptors.filter(d => runnable.has(d.detector)).map(d => {
              const on = selected.includes(d.detector);
              const blocked = !on && selected.length >= max;
              return (
                <label key={d.detector}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium select-none ${
                    on ? "border-dvivid-primary bg-dvivid-primary-light text-dvivid-primary"
                      : blocked ? "border-dvivid-border-light text-dvivid-text-muted" : "border-dvivid-border text-dvivid-text-primary cursor-pointer hover:border-dvivid-primary"}`}>
                  <input type="checkbox" className="accent-dvivid-primary" checked={on} disabled={blocked || running} onChange={() => toggle(d.detector)} />
                  {DETECTOR_NAMES[d.detector]}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-3 space-y-2" aria-live="polite">
          {notice && <Notice tone="error">{notice}</Notice>}
          {running && <Notice tone="info">Running {selected.length} detector{selected.length > 1 ? "s" : ""}… usually under 20 seconds.</Notice>}
        </div>
      </div>

      {!active ? (
        <div className="bg-white border border-dvivid-border rounded-card shadow-card p-8 text-center text-sm text-dvivid-text-secondary">
          No report yet. Choose detectors and click <b>Run Report</b>.
        </div>
      ) : (
        <div className="grid xl:grid-cols-[1fr_18rem] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {outdated && (
              <Notice tone="warning">The document changed after this report — results are outdated. Click Run Report to check the current version.</Notice>
            )}
            {active.id === "demo" && <Notice tone="info">Demo report: labeled local fixture, not real detector output.</Notice>}
            <div className="bg-white border border-dvivid-border rounded-card shadow-card p-4 sm:p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3">
                <div className="col-span-2 sm:col-span-1 border border-dvivid-border rounded-card p-3 bg-dvivid-surface-alt">
                  <p className="text-xs font-semibold text-dvivid-text-primary">Summary</p>
                  <p className="mt-2 text-sm text-dvivid-text-primary">
                    <b>{verdicts.filter(v => v === "AI").length}</b> of {runScores.length} detector{runScores.length === 1 ? "" : "s"} classify it as AI-written
                  </p>
                  {agg && (
                    <p className="mt-1 text-xs text-dvivid-text-secondary">
                      {agg.flaggedSentences} of {agg.totalSentences} unique sentences flagged
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-dvivid-text-muted">{new Date(active.checkedAt).toLocaleString()}</p>
                </div>
                {runScores.map(s => <DetectorResultCard key={s.detector} s={s} />)}
              </div>
              {agg && agg.documentLevelOnly.length > 0 && (
                <p className="mt-3 text-xs text-dvivid-text-muted">
                  {agg.documentLevelOnly.map(d => DETECTOR_NAMES[d]).join(", ")} returned a document-level score only — no sentence findings.
                </p>
              )}
            </div>

            <div className="bg-white border border-dvivid-border rounded-card shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-dvivid-border-light">
                <h3 className="text-sm font-semibold text-dvivid-text-primary">Findings (unique sentences)</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-dvivid-text-secondary">{agg?.flaggedSentences ?? 0} of {agg?.totalSentences ?? 0} flagged</span>
                  <Toggle checked={highlight} onChange={setHighlight} label="Show in document" />
                </div>
              </div>
              {!agg?.findings.length ? (
                <p className="px-4 sm:px-6 py-6 text-sm text-dvivid-text-secondary">No sentence-level findings in this report.</p>
              ) : (
                <ol className="max-h-[26rem] overflow-auto divide-y divide-dvivid-border-light">
                  {agg.findings.map((f, i) => {
                    const k = keyOf(f.start), open = expanded === k;
                    return (
                      <li key={k}>
                        <button type="button" onClick={() => setExpanded(open ? null : k)} aria-expanded={open}
                          className="w-full text-left flex items-start gap-3 px-4 sm:px-6 py-2.5 hover:bg-dvivid-surface-alt focus:outline-none focus-visible:shadow-focus">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-dvivid-error-light text-dvivid-error text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span className={`flex-1 min-w-0 text-sm text-dvivid-text-primary ${open ? "" : "truncate"}`}>{f.text}</span>
                          <span className="shrink-0 flex flex-wrap justify-end gap-1 max-w-[45%]">
                            {f.detectors.map(d => (
                              <span key={d.detector} className="px-1.5 py-0.5 rounded bg-dvivid-error-light text-dvivid-error text-[10px] font-semibold">{DETECTOR_NAMES[d.detector]}</span>
                            ))}
                          </span>
                        </button>
                        {open && (
                          <dl className="px-4 sm:px-6 pb-3 pl-12 grid gap-1 text-xs">
                            {f.detectors.map(d => (
                              <div key={d.detector} className="flex gap-2">
                                <dt className="font-semibold text-dvivid-text-primary">{DETECTOR_NAMES[d.detector]}</dt>
                                <dd className="text-dvivid-text-secondary">
                                  {typeof d.scorePercent === "number" ? `${d.scorePercent.toFixed(1)}% AI probability` : "flagged (no per-sentence score supplied)"}
                                  {d.isAI === true ? " · marked AI by provider" : ""}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {highlight && agg && (
                <div className="border-t border-dvivid-border-light px-4 sm:px-6 py-4 max-h-[60vh] overflow-auto text-[15px] leading-relaxed text-dvivid-text-primary space-y-3">
                  {paragraphs.map((sents, pi) => (
                    <p key={pi}>
                      {sents.map(s => {
                        const hit = findingByStart.get(s.start);
                        if (!hit) return <span key={s.index}>{s.text} </span>;
                        return (
                          <span key={s.index}>
                            <button type="button" onClick={() => setExpanded(keyOf(hit.f.start))}
                              title={hit.f.detectors.map(d => DETECTOR_NAMES[d.detector]).join(", ")}
                              className="text-left underline decoration-red-300 decoration-2 underline-offset-4 bg-red-50/50 rounded-sm focus:outline-none focus-visible:shadow-focus">
                              {s.text}
                            </button>{" "}
                          </span>
                        );
                      })}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="bg-white border border-dvivid-border rounded-card shadow-card" aria-label="Report history">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dvivid-border-light">
              <h3 className="text-sm font-semibold text-dvivid-text-primary">Report history</h3>
              {runs.some(r => r.id !== "demo") && (
                <button type="button" className="text-xs text-dvivid-text-secondary hover:text-dvivid-error"
                  onClick={() => { if (window.confirm("Clear report history in this browser?")) { persist(runs.filter(r => r.id === "demo")); setActiveId(null); } }}>
                  Clear
                </button>
              )}
            </div>
            <ul className="max-h-[22rem] overflow-auto divide-y divide-dvivid-border-light">
              {runs.map(r => {
                const a = aggregateFindings(version.content, r.detection.passages);
                const old = r.contentHash !== version.contentHash;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setActiveId(r.id)} aria-current={r.id === activeId}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-dvivid-surface-alt ${r.id === activeId ? "bg-dvivid-primary-light" : ""}`}>
                      <span className="flex justify-between gap-2">
                        <span className="font-medium text-dvivid-text-primary">{new Date(r.checkedAt).toLocaleString()}</span>
                        {old && <span className="text-dvivid-warning font-semibold">outdated</span>}
                      </span>
                      <span className="block text-dvivid-text-secondary truncate">
                        {r.detectors.map(d => DETECTOR_NAMES[d]).join(", ")} · {old ? "—" : `${a.flaggedSentences}/${a.totalSentences}`} flagged
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="px-4 py-2 text-[10px] text-dvivid-text-muted border-t border-dvivid-border-light">Stored in this browser only.</p>
          </aside>
        </div>
      )}
    </section>
  );
}
