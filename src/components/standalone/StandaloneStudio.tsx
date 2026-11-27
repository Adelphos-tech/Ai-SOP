"use client";

// ============================================================
// Standalone "Humanizer & AI Check" studio (/humanizer).
// Paste or upload an externally-written SOP, humanize it through
// the shared runDocumentHumanize pipeline (section guard +
// proofreader + spend ledger), then run the shared runDetection
// pipeline against original or humanized text — all without a
// student/application/document row.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { PageContainer, PrimaryButton, SecondaryButton } from "@/components/ui";
import { Notice, TabBar, Gauge, fmtUsd, DETECTOR_NAMES } from "@/components/writing-studio/shared";
import { listDetectorDescriptors, getDetectorLogoPath } from "@/lib/writing-review/detectors";
import { aggregateFindings, detectorVerdict, type ReportRun } from "@/lib/writing-review/report";
import type { CorruptionWarning, DocumentHumanizeResult } from "@/lib/writing-review/document-humanizer";
import type { RyneModelSpec } from "@/lib/writing-review/ryne-models";
import type { DetectorId } from "@/lib/writing-review/types";

type Studio = "humanizer" | "report";

const FALLBACK_MODELS: RyneModelSpec[] = [
  { id: "apex", label: "Apex", pricePer1kUsd: 0.5, recommended: true },
  { id: "titan", label: "Titan", pricePer1kUsd: 0.5 },
  { id: "balanced", label: "Balanced", pricePer1kUsd: 0.08 },
];

const HISTORY_KEY = "standalone-detection-runs";
const MAX_HISTORY = 12;

const countWords = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const countSentences = (t: string) => t.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).length;

/** Extract plain paragraphs from a .docx (zip of XML) — client-side, no upload. */
async function extractDocxText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("Not a valid .docx (missing document.xml)");
  return xml
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

interface StandaloneConfig {
  detectors: Array<{ detector: DetectorId; status: string; note?: string }>;
  detectionConfig: { runnable: string[]; maxDetectorsPerRun: number; configured: boolean; reservationCeilingUsd?: number | null };
  models: RyneModelSpec[];
  defaultModel: string;
  maxWords: number;
}

export function StandaloneStudio() {
  const [tab, setTab] = useState<Studio>("humanizer");
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [configError, setConfigError] = useState("");

  const [input, setInput] = useState("");
  const [humanized, setHumanized] = useState<string | null>(null);
  const [humanizeResult, setHumanizeResult] = useState<DocumentHumanizeResult | null>(null);
  const [mode, setMode] = useState<string>("balanced");
  const [modeChosen, setModeChosen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // detection
  const [checkTarget, setCheckTarget] = useState<"original" | "humanized">("original");
  const [editableText, setEditableText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<any | null>(null);
  const [reportError, setReportError] = useState("");
  const [history, setHistory] = useState<any[]>([]);

  const models = config?.models ?? FALLBACK_MODELS;
  const maxWords = config?.maxWords ?? 5_000;
  const words = countWords(input);
  const runnable = useMemo(() => new Set(config?.detectionConfig.runnable ?? []), [config]);
  const descriptors = useMemo(() => listDetectorDescriptors(), []);

  useEffect(() => {
    fetch("/api/standalone-studio/config")
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setConfig(d);
        setSelected((d.detectionConfig?.runnable ?? []).slice(0, d.detectionConfig?.maxDetectorsPerRun ?? 3));
      })
      .catch(e => setConfigError(e?.message || "Could not load configuration"));
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")); } catch { /* corrupt history ignored */ }
  }, []);

  // Default mode: recommended model for long drafts unless the user picked one.
  const recommended = models.find(m => m.recommended)?.id ?? "titan";
  useEffect(() => {
    if (!modeChosen) setMode(words > 500 ? recommended : "balanced");
  }, [words, modeChosen, recommended]);

  const checkedText = checkTarget === "humanized" && humanized != null ? humanized : input;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    try {
      const text = /\.docx$/i.test(f.name)
        ? await extractDocxText(f)
        : await f.text();
      if (!text.trim()) throw new Error("The file contained no readable text");
      setInput(text);
    } catch (err: any) {
      setError(err?.message || "Could not read that file");
    }
  }

  async function onHumanize() {
    const m = models.find(x => x.id === mode);
    const est = (countWords(input) / 1000) * (m?.pricePer1kUsd ?? 0.5);
    if (!window.confirm(
      `Humanize this text with Ryne ${m?.label ?? mode}?\n\n` +
      `${words.toLocaleString()} words will be sent to Ryne AI for rewriting (~${fmtUsd(est)} plus any retries). ` +
      `The humanized text is then sent to OpenAI for a surgical proofread. Continue?`
    )) return;
    setRunning(true); setError("");
    try {
      const res = await fetch("/api/standalone-studio/humanize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input, mode, confirmPaid: true, operationId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Humanization failed");
      setHumanized(data.result.content);
      setHumanizeResult(data.result);
      setEditableText(data.result.content);
      setCheckTarget("humanized");
    } catch (e: any) {
      setError(e?.message || "Humanization failed");
    } finally {
      setRunning(false);
    }
  }

  async function onExport(format: "docx" | "pdf") {
    const text = (checkTarget === "humanized" ? editableText : humanized ?? input) || input;
    const res = await fetch("/api/standalone-studio/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, format, title: "Humanizer & AI Check" }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Export failed"); return; }
    download(await res.blob(), `humanized.${format}`);
  }

  async function onCheck() {
    if (!selected.length) return;
    setChecking(true); setReportError(""); setReport(null);
    try {
      const text = checkTarget === "humanized" ? editableText : input;
      const res = await fetch("/api/standalone-studio/detect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, detectors: selected, confirmPaid: true, operationId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok && !data.detection) throw new Error(data.error || "Check failed");
      setReport({ ...data.detection, detectors: selected, text });
      if (data.detection) {
        const entry = { id: crypto.randomUUID(), checkedAt: data.detection.checkedAt, detectors: selected, scores: data.detection.scores, target: checkTarget, words: countWords(text) };
        const next = [entry, ...history].slice(0, MAX_HISTORY);
        setHistory(next);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage full — history skipped */ }
      }
      if (!res.ok) setReportError(data.error || "Check failed");
      else if (data.notice) setReportError(data.notice);
    } catch (e: any) {
      setReportError(e?.message || "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function onReportPdf() {
    if (!report) return;
    const res = await fetch("/api/standalone-studio/report-pdf", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: report.text, detection: report, title: "Standalone text" }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setReportError(d.error || "Report failed"); return; }
    download(await res.blob(), "ai-detection-report.pdf");
  }

  const findings = report ? aggregateFindings(report.text, report.passages ?? [], report.scores ?? []) : null;
  const proofread = humanizeResult?.proofreadPatchesApplied ?? 0;

  return (
    <PageContainer>
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-dvivid-text-primary">Humanizer &amp; AI Check</h1>
          <p className="text-sm text-dvivid-text-secondary mt-1">
            Paste or upload an externally-written SOP — humanize it and run AI detection without creating a student or application.
          </p>
        </div>
        {configError && <Notice tone="warning">{configError} — using built-in defaults.</Notice>}

        {/* ---------- Input ---------- */}
        <div className="border border-dvivid-border rounded-card bg-white p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-semibold text-dvivid-text-primary">SOP text</span>
            <div className="flex items-center gap-3 text-xs text-dvivid-text-muted">
              <span>{words.toLocaleString()} / {maxWords.toLocaleString()} words · {countSentences(input)} sentences</span>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="px-2.5 py-1 rounded border border-dvivid-border-light text-dvivid-text-secondary hover:bg-gray-50 font-medium">
                Upload .docx / .txt
              </button>
              <input ref={fileRef} type="file" accept=".txt,.docx" className="hidden" onChange={onUpload} />
            </div>
          </div>
          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); setHumanized(null); setHumanizeResult(null); setReport(null); }}
            placeholder="Paste the SOP text here — paragraphs separated by blank lines…"
            className="w-full min-h-[180px] px-3 py-2.5 text-sm border border-dvivid-border-light rounded-input focus-ring leading-relaxed resize-y"
          />
          {words > maxWords && <Notice tone="error">This text is over the {maxWords.toLocaleString()}-word limit.</Notice>}
        </div>

        <TabBar<Studio>
          tabs={[{ id: "humanizer", label: "Humanizer" }, { id: "report", label: "AI Detection Report" }]}
          value={tab} onChange={setTab} label="Studio"
        />

        {error && <Notice tone="error">{error}</Notice>}

        {/* ---------- Humanizer tab ---------- */}
        {tab === "humanizer" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm text-dvivid-text-secondary whitespace-nowrap">Humanizer model</label>
              <select
                value={mode}
                onChange={e => { setMode(e.target.value); setModeChosen(true); }}
                disabled={running}
                className="px-2.5 py-1.5 text-sm border border-dvivid-border-light rounded-input bg-white text-dvivid-text-primary"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.recommended ? " (Recommended)" : ""}{m.autoDetected ? " — New (Auto-detected)" : ""} · ${m.pricePer1kUsd.toFixed(2)}/1K
                  </option>
                ))}
              </select>
              <PrimaryButton onClick={onHumanize} disabled={running || !input.trim() || words > maxWords}>
                {running ? "Humanizing…" : "Humanize Document"}
              </PrimaryButton>
            </div>
            {words > 500 && !modeChosen && (
              <p className="text-xs text-dvivid-text-muted">{(models.find(m => m.recommended)?.label ?? "Titan")} is recommended for full-length SOPs.</p>
            )}

            {humanized != null && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-dvivid-border rounded-card bg-white p-4">
                  <p className="text-xs font-semibold text-dvivid-text-muted mb-2">Original SOP · {countWords(input)} words</p>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap max-h-[420px] overflow-y-auto text-dvivid-text-secondary">{input}</div>
                </div>
                <div className="border border-dvivid-primary/30 rounded-card bg-white p-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-xs font-semibold text-dvivid-text-primary">
                      Humanized SOP <span className="font-normal text-dvivid-text-muted">· Ryne {models.find(m => m.id === humanizeResult?.mode)?.label ?? humanizeResult?.mode}</span>
                    </p>
                    {proofread > 0 && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-dvivid-success-light text-dvivid-success text-[11px] font-medium cursor-help"
                        title={(humanizeResult?.proofreadSummary ?? []).map(p => `${p.category}: "${p.find}" → "${p.replace}"`).join("\n")}
                      >
                        {proofread} grammar/fact fixes applied automatically
                      </span>
                    )}
                  </div>
                  {(humanizeResult?.corruptionWarnings?.length ?? 0) > 0 && (
                    <Notice tone="warning">
                      {humanizeResult!.corruptionWarnings.length} issue(s) to check: {humanizeResult!.corruptionWarnings.map((w: CorruptionWarning) => `section ${w.sectionIndex + 1} — ${w.reason}`).join("; ")}. Edit below before using.
                    </Notice>
                  )}
                  <textarea
                    value={editableText}
                    onChange={e => setEditableText(e.target.value)}
                    className="w-full min-h-[380px] text-sm leading-relaxed text-dvivid-text-primary whitespace-pre-wrap border-0 focus:outline-none resize-y"
                  />
                </div>
              </div>
            )}

            {humanized != null && (
              <div className="flex items-center gap-3 flex-wrap">
                <SecondaryButton onClick={() => { navigator.clipboard.writeText(editableText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                  {copied ? "✓ Copied" : "Copy Text"}
                </SecondaryButton>
                <SecondaryButton onClick={() => { setCheckTarget("humanized"); setTab("report"); }}>
                  Use as Input for AI Check
                </SecondaryButton>
                <SecondaryButton onClick={() => onExport("docx")}>Export DOCX</SecondaryButton>
                <SecondaryButton onClick={() => onExport("pdf")}>Export PDF</SecondaryButton>
              </div>
            )}
          </div>
        )}

        {/* ---------- AI Detection tab ---------- */}
        {tab === "report" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="inline-flex p-0.5 rounded-button border border-dvivid-border bg-white" role="group" aria-label="Check which text">
                {(["original", "humanized"] as const).map(t => (
                  <button key={t} type="button"
                    disabled={t === "humanized" && humanized == null}
                    onClick={() => setCheckTarget(t)}
                    className={`px-3 py-1 text-xs font-medium rounded-button transition-colors ${checkTarget === t ? "bg-dvivid-primary text-white" : "text-dvivid-text-secondary hover:bg-gray-50 disabled:opacity-40"}`}>
                    {t === "original" ? "Original" : "Humanized"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-dvivid-text-muted">{countWords(checkedText).toLocaleString()} words will be checked</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {descriptors.filter(d => runnable.has(d.detector)).map(d => (
                <label key={d.detector} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-input border text-xs font-medium cursor-pointer ${selected.includes(d.detector) ? "border-dvivid-primary/40 bg-dvivid-primary-light text-dvivid-primary" : "border-dvivid-border-light text-dvivid-text-secondary hover:bg-gray-50"}`}>
                  <input
                    type="checkbox"
                    className="accent-dvivid-primary"
                    checked={selected.includes(d.detector)}
                    onChange={e => setSelected(s => e.target.checked ? [...s, d.detector] : s.filter(x => x !== d.detector))}
                  />
                  {DETECTOR_NAMES[d.detector] ?? d.name}
                </label>
              ))}
              <SecondaryButton onClick={onCheck} disabled={checking || !selected.length || !checkedText.trim()}>
                {checking ? "Checking…" : "Run Report"}
              </SecondaryButton>
            </div>
            {reportError && <Notice tone="error">{reportError}</Notice>}

            {report && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(report.scores ?? []).map((s: any) => {
                    const verdict = detectorVerdict(s);
                    const logo = getDetectorLogoPath(s.detector);
                    return (
                      <div key={s.detector} className="border border-dvivid-border rounded-card bg-white p-4 flex items-center gap-3">
                        <img src={logo} alt="" className="w-8 h-8 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-dvivid-text-primary">{DETECTOR_NAMES[s.detector as DetectorId] ?? s.detector}</p>
                          <p className="text-xs text-dvivid-text-muted">
                            {s.status === "SCORED"
                              ? (verdict ? `${verdict === "AI" ? "Likely AI" : verdict === "HUMAN" ? "Likely human" : "Mixed"}` : "Scored")
                              : s.status === "ERROR" ? `Failed — ${s.error?.message ?? "provider error"}` : s.status}
                          </p>
                        </div>
                        <Gauge percent={s.status === "SCORED" ? s.scorePercent : undefined} size={52} />
                      </div>
                    );
                  })}
                </div>

                {findings && findings.flaggedSentences > 0 && (
                  <div className="border border-dvivid-border rounded-card bg-white p-4">
                    <p className="text-sm font-semibold text-dvivid-text-primary mb-2">
                      {findings.flaggedSentences} of {findings.totalSentences} sentences flagged
                    </p>
                    <div className="text-sm leading-relaxed max-h-[300px] overflow-y-auto space-y-1.5 text-dvivid-text-secondary">
                      {findings.findings.map((f: any, i: number) => (
                        <p key={i} className="bg-red-50/70 rounded px-2 py-1">
                          {f.text}
                          <span className="ml-2 text-[11px] text-dvivid-text-muted">
                            {f.detectors.map((d: any) => DETECTOR_NAMES[d.detector as DetectorId] ?? d.detector).join(", ")}
                          </span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <SecondaryButton onClick={onReportPdf}>Download PDF</SecondaryButton>
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className="border border-dvivid-border rounded-card bg-white p-4">
                <p className="text-sm font-semibold text-dvivid-text-primary mb-2">Report history (this browser)</p>
                <div className="space-y-1.5">
                  {history.map(h => (
                    <div key={h.id} className="flex items-center justify-between text-xs text-dvivid-text-secondary">
                      <span>{new Date(h.checkedAt).toLocaleString()} · {(h.detectors ?? []).map((d: string) => DETECTOR_NAMES[d as DetectorId] ?? d).join(", ")} · {h.target} · {h.words} words</span>
                      <span className="text-dvivid-text-muted">
                        {(h.scores ?? []).filter((s: any) => s.status === "SCORED").map((s: any) => `${DETECTOR_NAMES[s.detector as DetectorId] ?? s.detector} ${Math.round(s.scorePercent)}%`).join(" · ") || "no scores"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
