"use client";

// ============================================================
// AI Writing Review workspace — Brick 1
// Review AI-detection findings on a generated document and refine
// flagged sentences with approved, range-anchored rewrites.
// No detector is called yet; cards report honest connectivity.
// Demo findings are available via ?demo=1 in development only.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton, SectionCard, EmptyState,
} from "@/components/ui";
import { useNavigationGuard } from "@/components/layout/NavigationGuardContext";
import type {
  DetectionResult, DetectorScore, DocumentRevision, FlaggedPassage,
} from "@/lib/writing-review/types";
import { segmentDocumentSentences, type DocumentSentence } from "@/lib/writing-review/segmentation";
import { applyApprovedRevisions, reanchorPassage } from "@/lib/writing-review/revisions";
import { buildAnalysisSummary, listDetectorDescriptors } from "@/lib/writing-review/detectors";

// ---------- shared client-side types ----------

interface DocumentInfo {
  id: string;
  applicationId: string;
  documentType: string;
  documentTitle: string;
  generationStatus: string;
  reviewStatus: string;
  currentVersionId?: string;
}

interface CurrentVersion {
  id: string;
  versionNumber: number;
  content: string;
  contentFormat: string;
  contentHash: string;
  wordCount: number;
  createdByType: string;
  createdAt: string;
}

interface Application {
  id: string;
  universityName: string;
  programName: string;
  degree: string;
}

interface RewriteProvider {
  id: string;
  name: string;
  configured: boolean;
  supportedModes: string[];
  note?: string;
}

// Cards render for every registered detector — not a fixed set.
const DETECTOR_ORDER = listDetectorDescriptors().map(d => d.detector);
const DETECTOR_NAMES: Record<string, string> = {
  RYNE_AI: "Ryne AI", TURNITIN: "Turnitin", GPTZERO: "GPTZero",
  ZEROGPT: "ZeroGPT", REILAA: "Reilaa", ORIGINALITY: "Originality.ai",
  QUILLBOT: "QuillBot", SURFER: "Surfer",
};

const MEANING_LABELS: Record<string, string> = {
  AI_PROBABILITY_PERCENT: "AI-written",
  RAW_MODEL_SIGNAL_PERCENT: "model signal",
  CLASSIFICATION_ONLY: "classified",
};

const DETECTOR_ICONS: Record<string, React.ReactNode> = {
  RYNE_AI: <span className="text-[13px] font-bold text-violet-600">R</span>,
  TURNITIN: <span className="text-[13px] font-bold text-blue-500">T</span>,
  GPTZERO: <span className="text-[13px] font-bold text-indigo-500">G</span>,
  ZEROGPT: <span className="text-[13px] font-bold text-teal-600">Z</span>,
  REILAA: <span className="text-[13px] font-bold text-purple-600">R</span>,
  ORIGINALITY: <span className="text-[13px] font-bold text-amber-600">O</span>,
  QUILLBOT: <span className="text-[13px] font-bold text-emerald-600">Q</span>,
  SURFER: <span className="text-[13px] font-bold text-cyan-600">S</span>,
};

function statusLabel(s: DetectorScore): { label: string; tone: string } {
  switch (s.status) {
    case "SCORED": return { label: s.classification || "Scored", tone: "text-dvivid-error" };
    case "PENDING": return { label: "Pending", tone: "text-dvivid-warning" };
    case "NOT_CONNECTED": return { label: "Not connected", tone: "text-dvivid-text-muted" };
    case "UNAVAILABLE": return { label: "Unavailable", tone: "text-dvivid-text-muted" };
    case "ERROR": return { label: "Error", tone: "text-dvivid-error" };
  }
}

// ---------- small components ----------

function Gauge({ percent, status }: { percent?: number; status: string }) {
  const R = 26, C = 2 * Math.PI * R;
  const scored = status === "SCORED" && typeof percent === "number";
  const frac = scored ? Math.min(100, Math.max(0, percent!)) / 100 : 0;
  const color = !scored ? "#E2E8F0" : percent! >= 50 ? "#D14343" : percent! >= 25 ? "#D97706" : "#159455";
  return (
    <div className="relative w-[72px] h-[72px]">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="#EEF1F6" strokeWidth="6" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${scored ? "text-dvivid-text-primary" : "text-dvivid-text-muted"}`}>
          {scored ? `${Math.round(percent!)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function DetectorCard({ score, stale }: { score: DetectorScore; stale: boolean }) {
  const { label, tone } = statusLabel(score);
  return (
    <div className="bg-white border border-dvivid-border rounded-card shadow-card px-4 py-4 flex flex-col items-center gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5 self-start">
        {DETECTOR_ICONS[score.detector] ?? null}
        <span className="text-xs font-semibold text-dvivid-text-primary truncate">{DETECTOR_NAMES[score.detector]}</span>
      </div>
      <Gauge percent={score.scorePercent} status={score.status} />
      <span className={`text-[11px] font-semibold ${tone}`}>
        {score.status === "SCORED" && score.scoreMeaning
          ? `${MEANING_LABELS[score.scoreMeaning]} · ${label}`
          : label}
      </span>
      {stale && <span className="text-[10px] text-dvivid-warning">outdated</span>}
      <span className="text-[10px] text-dvivid-text-muted text-center leading-tight line-clamp-2" title={score.note}>
        {score.note}
      </span>
      {score.lastCheckedAt && (
        <span className="text-[10px] text-dvivid-text-muted">
          {new Date(score.lastCheckedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

type TabId = "rewrite" | "explanation" | "history";

// ---------- main page ----------

export default function WritingReviewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;
  const documentId = params.documentId as string;
  const demo = searchParams.get("demo") === "1";
  const docHref = `/students/${studentId}/applications/${applicationId}/documents/${documentId}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [version, setVersion] = useState<CurrentVersion | null>(null);
  const [detectors, setDetectors] = useState<DetectorScore[]>([]);
  const [provider, setProvider] = useState<RewriteProvider | null>(null);

  // draft = working copy the consultant is refining
  const [draft, setDraft] = useState("");
  const [baseVersionId, setBaseVersionId] = useState("");
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<DocumentRevision[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("rewrite");
  const [mode, setMode] = useState("balanced");
  const [manualEdit, setManualEdit] = useState("");
  const [editingManual, setEditingManual] = useState(false);

  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { registerGuard, unregisterGuard, checkGuard } = useNavigationGuard();
  const passageRefs = useRef<Record<string, HTMLElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(
        `/api/application/writing-review?documentId=${documentId}&applicationId=${applicationId}&studentId=${studentId}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to load"); return; }
      setDocument(data.document);
      setVersion(data.currentVersion);
      setDetectors(data.detectors || []);
      setProvider(data.rewriteProvider);
      if (data.currentVersion) {
        setDraft(data.currentVersion.content);
        setBaseVersionId(data.currentVersion.id);
      }
      const appRes = await fetch(`/api/application/list?applicationId=${applicationId}&studentId=${studentId}`);
      if (appRes.ok) setApplication((await appRes.json()).application);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [documentId, applicationId, studentId]);

  useEffect(() => { load(); }, [load]);

  // demo fixture — dev-only, clearly labeled, never production
  useEffect(() => {
    if (!demo || !version) return;
    import("@/lib/writing-review/fixture").then(m => {
      const built = m.buildDemoDetection(draft, version.id);
      if (!built) { setNotice("Demo fixture is disabled in this environment."); return; }
      setDetection(built.result);
      setSuggestions(built.suggestions);
      setDetectors(prev => mergeScores(prev, built.result.scores));
      setSelectedId(built.result.passages[0]?.id ?? null);
      setNotice("Demo mode: findings are a labeled local fixture, not real detector output.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, version]);

  const sentences = useMemo(() => segmentDocumentSentences(draft), [draft]);
  const dirty = version ? draft !== version.content : false;

  // unsaved-changes protection
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    if (dirty) {
      registerGuard(() => window.confirm("You have unsaved AI Writing Review changes. Leave anyway?"));
    } else {
      unregisterGuard();
    }
    return () => { window.removeEventListener("beforeunload", handler); unregisterGuard(); };
  }, [dirty, registerGuard, unregisterGuard]);

  // re-anchor passages into the live draft for display
  const displayPassages = useMemo(() => {
    if (!detection) return [];
    return detection.passages.map(p => {
      const r = reanchorPassage(draft, p);
      return { passage: p, range: r, stale: r === null };
    });
  }, [detection, draft]);

  const selected = displayPassages.find(x => x.passage.id === selectedId) || null;
  const selectedIndex = displayPassages.findIndex(x => x.passage.id === selectedId);
  const suggestionFor = (id: string) => revisions.find(r => r.passageId === id && r.status === "APPROVED")?.suggestionText
    || suggestions[id]
    || "";

  function mergeScores(base: DetectorScore[], extra: DetectorScore[]): DetectorScore[] {
    const map = new Map(base.map(s => [s.detector, s]));
    extra.forEach(s => map.set(s.detector, s));
    return [...map.values()];
  }

  // detection staleness: compare against the draft text captured when
  // the check ran — no second hashing scheme needed client-side.
  const detectionSnapshot = useRef<string>("");
  useEffect(() => {
    if (detection) detectionSnapshot.current = draft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection?.checkedAt]);
  const detectionStale = detection ? detectionSnapshot.current !== draft : false;

  // ---------- actions ----------

  async function handleRecheck() {
    if (dirty && !window.confirm(
      "The document has unsaved edits. A recheck would run on unsaved text only after saving. Continue anyway?")) return;
    setChecking(true); setNotice("");
    try {
      const res = await fetch(`/api/application/writing-review?documentId=${documentId}&applicationId=${applicationId}&studentId=${studentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck" }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice(data.error || "Check failed"); return; }
      if (data.detection) {
        setDetection(data.detection);
        setDetectors(prev => mergeScores(prev, data.detection.scores));
      }
      if (data.notice) setNotice(data.notice);
    } catch (e: any) {
      setNotice(e?.message || "Check failed");
    } finally {
      setChecking(false);
    }
  }

  function selectPassage(id: string) {
    setSelectedId(id);
    setEditingManual(false);
    setTab("rewrite");
    passageRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function navPassage(dir: -1 | 1) {
    const next = displayPassages[selectedIndex + dir];
    if (next) selectPassage(next.passage.id);
  }

  function decideRevision(status: "APPROVED" | "REJECTED", editedText?: string) {
    if (!selected) return;
    const p = selected.passage;
    const suggestion = editedText ?? suggestionFor(p.id);
    const rev: DocumentRevision = {
      id: `rev-${Date.now()}-${p.id}`,
      passageId: p.id,
      passageStart: p.start,
      passageEnd: p.end,
      originalText: p.text,
      suggestionText: suggestion,
      editedText,
      status,
      createdAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    };
    setRevisions(prev => [...prev.filter(r => r.passageId !== p.id || r.status !== "APPROVED"), rev]);
    if (status === "APPROVED") {
      const out = applyApprovedRevisions(draft, [rev]);
      if (out.applied.length) setDraft(out.content);
      else setNotice("Could not apply that revision — the sentence no longer matches the draft.");
    }
    setEditingManual(false);
  }

  function applyAllApproved() {
    const pending = revisions.filter(r => r.status === "APPROVED");
    if (!pending.length) { setNotice("No approved revisions to apply."); return; }
    const out = applyApprovedRevisions(draft, pending);
    if (out.skipped.length) {
      setNotice(`${out.skipped.length} approved revision(s) could not be applied because the text changed.`);
    }
    if (out.applied.length) {
      setDraft(out.content);
      setNotice(`Applied ${out.applied.length} approved change(s).`);
    }
  }

  async function handleSave() {
    if (!dirty) { setNotice("No changes to save."); return; }
    if (window.confirm("Save the reviewed document as a new version?") === false) return;
    setSaving(true); setSaveError(""); setSaveSuccess(false);
    try {
      const res = await fetch("/api/application/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId, content: draft, baseVersionId }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || "Failed to save"); return; }
      setSaveSuccess(true);
      await load();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setSaveError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(format: "PDF" | "DOCX") {
    const versionId = version?.id;
    if (!versionId) return;
    if (dirty && !window.confirm("There are unsaved review edits. Export the last saved version anyway?")) return;
    setExporting(true);
    try {
      const res = await fetch("/api/application/document/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId, versionId, format, mode: "PREVIEW" }),
      });
      if (!res.ok) { setNotice((await res.json()).error || "Export failed"); return; }
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "export";
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url; a.download = name; a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setNotice(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function restoreRevision(passageId: string) {
    const revs = revisions.filter(r => r.passageId === passageId);
    const lastApproved = [...revs].reverse().find(r => r.status === "APPROVED" || r.status === "EDITED");
    if (!lastApproved) return;
    if (!window.confirm("Restore the original sentence for this passage? This overwrites the approved rewrite.")) return;
    // find current text range for the applied text and swap back
    const appliedText = lastApproved.status === "EDITED" ? lastApproved.editedText! : lastApproved.suggestionText;
    const idx = draft.indexOf(appliedText);
    if (idx < 0) { setNotice("Could not locate the rewritten text to restore."); return; }
    setDraft(draft.slice(0, idx) + lastApproved.originalText + draft.slice(idx + appliedText.length));
    setRevisions(prev => [...prev, {
      ...lastApproved,
      id: `rev-${Date.now()}-restore`,
      status: "REJECTED",
      decidedAt: new Date().toISOString(),
    }]);
  }

  // ---------- render helpers ----------

  function renderDocument() {
    const paraMap = new Map<number, DocumentSentence[]>();
    sentences.forEach(s => {
      const arr = paraMap.get(s.paragraphIndex) || [];
      arr.push(s); paraMap.set(s.paragraphIndex, arr);
    });
    const passageBySentence = new Map<number, { p: FlaggedPassage; stale: boolean }>();
    displayPassages.forEach(({ passage, range, stale: ps }) => {
      if (!range) return;
      const sIdx = sentences.findIndex(s => s.start === range.start && s.end === range.end);
      if (sIdx >= 0) passageBySentence.set(sIdx, { p: passage, stale: ps });
    });
    // passages that no longer resolve still get listed (marked outdated)
    const flagNums = new Map(displayPassages.map((x, i) => [x.passage.id, i + 1]));

    // paragraphIndex in segmentation counts every split segment, so
    // render the unfiltered split to keep indexes aligned.
    const paragraphs = draft.split(/\n\s*\n/);
    return (
      <div className="text-sm leading-relaxed text-dvivid-text-primary">
        {paragraphs.map((raw, pi) => {
          const paraText = raw.trim();
          if (!paraText) return null;
          const sents = paraMap.get(pi) || [];
          return (
            <p key={pi} className="mb-4 last:mb-0">
              {sents.length === 0 ? paraText : sents.map(s => {
                const flag = passageBySentence.get(s.index);
                const rel = s.text;
                const trailing = "";
                if (!flag) return <span key={s.index}>{rel} </span>;
                const active = flag.p.id === selectedId;
                const n = flagNums.get(flag.p.id);
                const decided = revisions.find(r => r.passageId === flag.p.id && r.status === "APPROVED");
                const cls = flag.stale
                  ? "bg-dvivid-surface-alt text-dvivid-text-muted"
                  : active
                    ? "bg-red-100 ring-1 ring-red-300"
                    : decided
                      ? "bg-green-50"
                      : "bg-red-50";
                return (
                  <button
                    key={s.index}
                    ref={el => { passageRefs.current[flag.p.id] = el; }}
                    onClick={() => selectPassage(flag.p.id)}
                    aria-label={`Flagged sentence ${n}${flag.stale ? " (outdated)" : ""}`}
                    className={`inline text-left rounded px-0.5 cursor-pointer transition-colors ${cls} focus:outline-none focus:ring-2 focus:ring-dvivid-primary`}
                  >
                    {n !== undefined && (
                      <sup className="mr-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-dvivid-error text-white text-[9px] font-bold align-middle">{n}</sup>
                    )}
                    {rel}{" "}
                  </button>
                );
              })}
            </p>
          );
        })}
      </div>
    );
  }

  const summary = useMemo(() => buildAnalysisSummary(detectors, detection?.checkedAt), [detectors, detection?.checkedAt]);
  const flaggedCount = displayPassages.filter(x => !x.stale).length;

  // ---------- render ----------

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading writing review...</div></PageContainer>;
  }
  if (error || !document) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error || "Document not found"}</p>
          <Link href={`/students/${studentId}/applications/${applicationId}`} className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">← Back to application</Link>
        </div>
      </PageContainer>
    );
  }

  const noVersion = !version;

  return (
    <PageContainer>
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: "Application", href: `/students/${studentId}/applications/${applicationId}` },
        { label: document.documentTitle, href: docHref },
        { label: "AI Writing Review" },
      ]} onNavigate={checkGuard ? (href) => checkGuard(href) : undefined} />

      {/* Header */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card px-7 py-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-page-title text-dvivid-text-primary flex items-center gap-2">
              AI Writing Review <span className="text-xs font-medium text-dvivid-text-secondary">({provider?.name ?? "Ryne AI"})</span>
            </h1>
            <p className="text-sm text-dvivid-text-secondary mt-1">
              Detect AI-written content, see flagged sentences, and refine them with human-like rewrites.
            </p>
            {application && (
              <p className="text-xs text-dvivid-text-muted mt-1">
                {application.universityName} · {application.programName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
              Powered by Ryne AI
            </span>
            <select
              value={mode}
              onChange={e => setMode(e.target.value)}
              aria-label="Rewrite mode"
              className="text-sm border border-dvivid-border rounded-input px-2.5 py-1.5 bg-white text-dvivid-text-primary"
            >
              <option value="balanced">Balanced Mode</option>
              <option value="titan">Titan Mode</option>
            </select>
            <PrimaryButton onClick={handleRecheck} disabled={checking || noVersion}>
              {checking ? "Checking…" : "Recheck Detection"}
            </PrimaryButton>
            <SecondaryButton onClick={() => { if (checkGuard ? checkGuard(docHref) : true) router.push(docHref); }}>
              Return to Document
            </SecondaryButton>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-4 text-sm px-4 py-2.5 rounded-input bg-dvivid-info-light text-dvivid-info border border-dvivid-primary-border">
          {notice}
        </div>
      )}
      {detectionStale && (
        <div className="mb-4 text-sm px-4 py-2.5 rounded-input bg-dvivid-warning-light text-dvivid-warning border border-dvivid-warning">
          The document changed after the last check — detection results may be outdated. Save, then recheck.
        </div>
      )}

      {/* Detector dashboard */}
      <SectionCard title="AI Detection Results" className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-9 gap-3">
          {DETECTOR_ORDER.map(id => {
            const s = detectors.find(d => d.detector === id) || {
              detector: id as any, status: "NOT_CONNECTED" as const,
              note: "Not connected.",
            };
            return <DetectorCard key={id} score={s} stale={detectionStale && s.status === "SCORED"} />;
          })}
          <div className="bg-dvivid-surface-alt border border-dvivid-border rounded-card px-4 py-4 flex flex-col items-center justify-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-dvivid-text-primary">Analysis Summary</span>
            <div className="text-[11px] text-dvivid-text-secondary space-y-0.5">
              <div>{summary.scored} scored{summary.sentenceLevel.length > 0 ? ` · ${summary.sentenceLevel.length} sentence-level` : ""}</div>
              <div>{summary.documentLevel.length > 0 ? `${summary.documentLevel.length} document-level · ` : ""}{summary.pending} pending</div>
              <div>{summary.notConnected} not connected · {summary.unavailable} unavailable{summary.failed > 0 ? ` · ${summary.failed} failed` : ""}</div>
            </div>
            {summary.checkedAt && (
              <span className="text-[10px] text-dvivid-text-muted">Checked {new Date(summary.checkedAt).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Document + refinement */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* Left: document */}
        <div className="flex-1 min-w-0 w-full bg-white border border-dvivid-border rounded-card shadow-card p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-dvivid-text-primary">{document.documentTitle}</h2>
              {version && (
                <p className="text-xs text-dvivid-text-muted mt-0.5">
                  {version.wordCount} words · v{version.versionNumber}
                </p>
              )}
            </div>
            <span className="text-[11px] font-medium text-dvivid-error">
              {flaggedCount > 0 ? `${flaggedCount} of ${sentences.length} sentences flagged` : "No flagged sentences"}
            </span>
          </div>
          {noVersion ? (
            <EmptyState
              title="No generated content yet"
              description="Generate the document first, then run AI Writing Review on the generated version."
            />
          ) : (
            renderDocument()
          )}
        </div>

        {/* Right: refinement panel */}
        <div className="w-full xl:w-[42%] xl:max-w-[460px] xl:sticky xl:top-4 flex-shrink-0 bg-white border border-dvivid-border rounded-card shadow-card overflow-hidden">
          <div className="flex border-b border-dvivid-border" role="tablist" aria-label="Review panel">
            {([["rewrite", "Rewrite Suggestion"], ["explanation", "Explanation"], ["history", "Sentence History"]] as [TabId, string][]).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 px-3 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  tab === id ? "border-dvivid-primary text-dvivid-primary" : "border-transparent text-dvivid-text-secondary hover:text-dvivid-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "rewrite" && (
              !selected ? (
                <EmptyState
                  title="Nothing selected"
                  description={flaggedCount ? "Select a flagged sentence in the document." : "Run a detection check to see flagged sentences."}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <SecondaryButton onClick={() => navPassage(-1)} disabled={selectedIndex <= 0} aria-label="Previous flagged sentence">‹</SecondaryButton>
                      <span className="text-xs font-medium text-dvivid-text-secondary">
                        Flagged Sentence {selectedIndex + 1} of {displayPassages.length}
                      </span>
                      <SecondaryButton onClick={() => navPassage(1)} disabled={selectedIndex >= displayPassages.length - 1} aria-label="Next flagged sentence">›</SecondaryButton>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-dvivid-error">
                      {selected.passage.scorePercent != null ? `${Math.round(selected.passage.scorePercent)}% AI` : "Flagged"}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="text-[11px] font-semibold text-dvivid-error mb-1.5">
                      Original ({selected.passage.detector === "REILAA" ? "AI-detected" : DETECTOR_NAMES[selected.passage.detector]})
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-input px-3 py-2.5 text-sm text-dvivid-text-primary leading-relaxed">
                      {selected.passage.text}
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="text-[11px] font-semibold text-dvivid-success mb-1.5">
                      Suggested Rewrite ({provider?.name ?? "Ryne"} — {mode === "balanced" ? "Balanced" : "Titan"})
                    </div>
                    {provider?.configured || demo ? (
                      editingManual ? (
                        <div>
                          <textarea
                            value={manualEdit}
                            onChange={e => setManualEdit(e.target.value)}
                            rows={4}
                            aria-label="Edit suggestion manually"
                            className="w-full text-sm border border-dvivid-border rounded-input px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-dvivid-primary"
                          />
                          <div className="flex gap-2 mt-2">
                            <PrimaryButton onClick={() => decideRevision("APPROVED", manualEdit.trim() || suggestionFor(selected.passage.id))} className="flex-1">
                              Apply Edited Rewrite
                            </PrimaryButton>
                            <SecondaryButton onClick={() => setEditingManual(false)}>Cancel</SecondaryButton>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-green-50 border border-green-100 rounded-input px-3 py-2.5 text-sm text-dvivid-text-primary leading-relaxed">
                          {suggestionFor(selected.passage.id) || "No suggestion yet."}
                        </div>
                      )
                    ) : (
                      <div className="bg-dvivid-surface-alt border border-dvivid-border rounded-input px-3 py-2.5 text-sm text-dvivid-text-muted">
                        Rewrite provider not connected — {provider?.note ?? "configure RYNE_API_KEY to enable suggestions."}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <PrimaryButton
                      onClick={() => decideRevision("APPROVED")}
                      disabled={!suggestionFor(selected.passage.id) || selected.stale}
                      className="flex-1"
                    >
                      Apply This Rewrite
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={() => { setManualEdit(suggestionFor(selected.passage.id) || selected.passage.text); setEditingManual(true); }}
                      disabled={selected.stale}
                    >
                      Edit
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setNotice("Regenerate requires a connected rewrite provider (Brick 3).")} disabled={!provider?.configured}>
                      Regenerate
                    </SecondaryButton>
                    <SecondaryButton onClick={() => decideRevision("REJECTED")} disabled={selected.stale}>
                      Keep Original
                    </SecondaryButton>
                  </div>
                </>
              )
            )}

            {tab === "explanation" && (
              !selected ? (
                <EmptyState title="Nothing selected" description="Select a flagged sentence to see why it was flagged." />
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-[11px] font-semibold text-dvivid-text-secondary mb-1">Source</div>
                    <p className="text-dvivid-text-primary">{DETECTOR_NAMES[selected.passage.detector]}</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-dvivid-text-secondary mb-1">Detector explanation</div>
                    <p className="text-dvivid-text-primary leading-relaxed">
                      {selected.passage.explanation ?? "The detector did not provide a per-sentence explanation."}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-dvivid-border-light">
                    <div className="text-[11px] font-semibold text-dvivid-text-secondary mb-1">Editorial note</div>
                    <p className="text-dvivid-text-muted leading-relaxed">
                      Detector scores are estimates, not proof of authorship. Refinements preserve facts, names, dates and experiences.
                    </p>
                  </div>
                </div>
              )
            )}

            {tab === "history" && (
              !selected ? (
                <EmptyState title="Nothing selected" description="Select a flagged sentence to see its revision history." />
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold text-dvivid-text-secondary mb-1">Original</div>
                    <p className="text-sm bg-dvivid-surface-alt rounded-input px-3 py-2 text-dvivid-text-primary">{selected.passage.text}</p>
                  </div>
                  {revisions.filter(r => r.passageId === selected.passage.id).length === 0 ? (
                    <p className="text-xs text-dvivid-text-muted">No revisions yet.</p>
                  ) : (
                    revisions.filter(r => r.passageId === selected.passage.id).map(r => (
                      <div key={r.id} className="border border-dvivid-border rounded-input px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            r.status === "APPROVED" ? "bg-green-50 text-dvivid-success"
                            : r.status === "EDITED" ? "bg-blue-50 text-dvivid-info"
                            : "bg-dvivid-surface-alt text-dvivid-text-muted"}`}>
                            {r.status}
                          </span>
                          <span className="text-[10px] text-dvivid-text-muted">{new Date(r.decidedAt || r.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-xs text-dvivid-text-primary">{r.editedText ?? r.suggestionText}</p>
                      </div>
                    ))
                  )}
                  {revisions.some(r => r.passageId === selected.passage.id && (r.status === "APPROVED" || r.status === "EDITED")) && (
                    <SecondaryButton onClick={() => restoreRevision(selected.passage.id)} className="w-full">
                      Restore Original Sentence
                    </SecondaryButton>
                  )}
                </div>
              )
            )}
          </div>

          {/* Other flagged sentences */}
          {displayPassages.length > 1 && (
            <div className="border-t border-dvivid-border px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-dvivid-text-primary">Other Flagged Sentences</span>
                <span className="text-[10px] text-dvivid-text-muted">{displayPassages.length - 1} more</span>
              </div>
              <div className="space-y-1.5">
                {displayPassages.filter(x => x.passage.id !== selectedId).map(({ passage }) => (
                  <button
                    key={passage.id}
                    onClick={() => selectPassage(passage.id)}
                    className="w-full flex items-center justify-between gap-2 text-left text-xs px-2.5 py-2 rounded-input hover:bg-dvivid-surface-alt transition-colors"
                  >
                    <span className="truncate text-dvivid-text-secondary">{passage.text}</span>
                    {passage.scorePercent != null && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-dvivid-error">{Math.round(passage.scorePercent)}%</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer note + actions */}
      <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-[11px] text-dvivid-text-muted max-w-xl">
          Note: AI detection results are estimates, not proof of authorship. Suggested rewrites preserve your meaning, facts and experiences.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <SecondaryButton onClick={handleExport.bind(null, "PDF")} disabled={exporting || noVersion}>
            {exporting ? "Exporting…" : "Export Document"}
          </SecondaryButton>
          <SecondaryButton onClick={handleRecheck} disabled={checking || noVersion}>
            Recheck Detection
          </SecondaryButton>
          <SecondaryButton onClick={applyAllApproved} disabled={!revisions.some(r => r.status === "APPROVED")}>
            Apply All Approved Changes
          </SecondaryButton>
          <PrimaryButton onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : saveSuccess ? "Saved ✓" : "Save Changes"}
          </PrimaryButton>
        </div>
      </div>
      {saveError && <p className="mt-2 text-sm text-dvivid-error">{saveError}</p>}
    </PageContainer>
  );
}
