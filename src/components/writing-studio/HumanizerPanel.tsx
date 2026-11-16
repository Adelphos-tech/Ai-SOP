"use client";

// ============================================================
// AI Writing Studio — full-document Humanizer (split view)
// LEFT: the saved version (read-only). RIGHT: the humanized draft.
// The draft lives only in this component until the user applies and
// saves it as a new version — generation never touches the document.
// Detection is never triggered from here.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import {
  countSentences, countWords, missingDetails, planSections, splitParagraphs, wordDiff, type DiffToken,
} from "@/lib/writing-review/document-structure";
import type { DocumentHumanizeResult } from "@/lib/writing-review/document-humanizer";
import { beastModeBadge, latestVersionScore, type ReportRun } from "@/lib/writing-review/report";
import type { DetectorId, DetectorScore } from "@/lib/writing-review/types";
import {
  DETECTOR_NAMES, fmtUsd, Notice, persistReportRun, prefersReducedMotion,
  readReportRuns, ScoreBadge, TabBar, Toggle, type StudioVersion,
} from "./shared";

type Mode = "balanced" | "titan";

interface Pair { key: string; left: string; right: string; linked: boolean; heading: boolean; warn: boolean }

function buildPairs(original: string, result: DocumentHumanizeResult | null, edited: string | null): Pair[] {
  if (!result) return [];
  if (edited !== null) {
    const lp = splitParagraphs(original), rp = splitParagraphs(edited);
    if (lp.length === rp.length) {
      return lp.map((l, i) => ({ key: `e${i}`, left: l, right: rp[i], linked: true, heading: false, warn: false }));
    }
    return [{ key: "e-all", left: lp.join("\n\n"), right: rp.join("\n\n"), linked: false, heading: false, warn: false }];
  }
  return result.sections.flatMap((s): Pair[] => {
    if (s.kind === "HEADING") return [{ key: `h${s.index}`, left: s.original[0], right: s.rewritten[0], linked: true, heading: true, warn: false }];
    if (s.structureChanged) {
      return [{ key: `s${s.index}`, left: s.original.join("\n\n"), right: s.rewritten.join("\n\n"), linked: false, heading: false, warn: true }];
    }
    return s.original.map((l, i) => ({ key: `s${s.index}p${i}`, left: l, right: s.rewritten[i], linked: true, heading: false, warn: false }));
  });
}

function Tokens({ tokens, side }: { tokens: DiffToken[]; side: "left" | "right" }) {
  const cls = side === "left"
    ? "bg-red-50 text-red-700 line-through decoration-red-300"
    : "bg-green-50 text-green-800";
  return <>{tokens.map((t, i) => t.changed ? <span key={i} className={`${cls} rounded-sm`}>{t.text}</span> : t.text)}</>;
}

export interface HumanizerPanelProps {
  version: StudioVersion;
  configured: boolean;
  pricing: { balancedPer1k: number; titanPer1k: number };
  apiUrl: string;
  documentId: string;
  /** Runnable ai-score detectors + server kill-switch for Check AI. */
  detection: { runnable: string[]; configured: boolean } | null;
  onSave: (content: string) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  restorable: { content: string; versionNumber: number } | null;
  onRestore: () => void;
  /** Called when the server's saved version moved ahead of the version
   *  this page is displaying (saved elsewhere since load) — the page
   *  reloads so badge, text and hash realign. */
  onVersionDrift?: () => Promise<void> | void;
}

export default function HumanizerPanel({ version, configured, pricing, apiUrl, documentId, detection, onSave, onDirtyChange, restorable, onRestore, onVersionDrift }: HumanizerPanelProps) {
  const [mode, setMode] = useState<Mode>("balanced");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<DocumentHumanizeResult | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [view, setView] = useState<"original" | "humanized">("original");
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warning" | "error" | "success"; text: string } | null>(null);
  // Compact AI-detection badges — never fetched implicitly. Original
  // reuses the stored report history for THIS exact version hash;
  // the draft badge is an explicit Check AI on the exact draft text
  // (or Ryne's own Beast Mode score when the provider returned one).
  const [reportRuns, setReportRuns] = useState<ReportRun[]>([]);
  const [draftCheck, setDraftCheck] = useState<{ text: string; detector: DetectorId; pct: number; meaning?: string } | null>(null);
  const [checking, setChecking] = useState<"original" | "humanized" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Reused ONLY when the previous attempt never got a response (network
  // failure) — the server then dedupes instead of billing twice.
  const pendingOpRef = useRef<{ key: string; id: string } | null>(null);
  const leftRefs = useRef(new Map<string, HTMLElement>());
  const rightRefs = useRef(new Map<string, HTMLElement>());

  // A new saved version invalidates any draft built from the old one.
  useEffect(() => { setResult(null); setEdited(null); setApplied(false); setEditing(false); setDraftCheck(null); }, [version.id]);
  useEffect(() => { setReportRuns(readReportRuns(documentId)); }, [documentId]);
  useEffect(() => { onDirtyChange(!!result); }, [result, onDirtyChange]);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [running]);

  const plan = useMemo(() => planSections(version.content), [version.content]);
  const billableWords = plan.ok ? plan.bodyWords : countWords(version.content);
  const per1k = mode === "titan" ? pricing.titanPer1k : pricing.balancedPer1k;
  const estimate = (billableWords / 1000) * per1k;
  const output = edited ?? result?.content ?? "";
  const pairs = useMemo(() => buildPairs(version.content, result, edited), [version.content, result, edited]);
  const diffs = useMemo(() => highlight ? new Map(pairs.map(p => [p.key, wordDiff(p.left, p.right)])) : null, [pairs, highlight]);
  const missing = useMemo(() => result ? missingDetails(version.content, output) : [], [result, version.content, output]);
  const stats = useMemo(() => ({
    ow: countWords(version.content), os: countSentences(version.content),
    rw: countWords(output), rs: countSentences(output),
  }), [version.content, output]);

  // Badge detector: Reilaa when runnable (Ryne's own standalone
  // detector — same provider family as the rewrite's Beast Mode
  // score), otherwise the first runnable tool — one billed request.
  const checkDetector = useMemo(() => {
    const r = detection?.runnable ?? [];
    return (r.includes("REILAA") ? "REILAA" : r[0]) as DetectorId | undefined;
  }, [detection]);
  // Original badge: only a stored score for THIS version's exact hash.
  const origScore = useMemo(() => latestVersionScore(reportRuns, version.contentHash), [reportRuns, version.contentHash]);
  // Humanized badge: an explicit Check AI on the CURRENT draft text
  // first (named detector); else the provider's Beast Mode score.
  const validDraftCheck = draftCheck && draftCheck.text === output ? draftCheck : null;
  const beast = result ? beastModeBadge(result.sections) : undefined;
  const meaningNote = (m?: string) => m === "RAW_MODEL_SIGNAL_PERCENT" ? " Raw model signal — not a calibrated probability." : "";
  const humBadge: { label: string; pct: number; title?: string } | null = validDraftCheck
    ? { label: DETECTOR_NAMES[validDraftCheck.detector], pct: validDraftCheck.pct,
        title: `${DETECTOR_NAMES[validDraftCheck.detector]} check on this exact draft text.${meaningNote(validDraftCheck.meaning)}` }
    : beast !== undefined
      ? { label: "Ryne check", pct: beast, title: "Ryne's Beast Mode detector score for this rewrite (detector not named by the provider) — an estimate, not a guarantee." }
      : null;
  const canCheck = !!detection?.configured && !!checkDetector && !running && !checking;

  async function checkAi(text: string, side: "original" | "humanized") {
    const detector = checkDetector;
    if (!detector || !canCheck) return;
    const what = side === "original" ? `the saved original (v${version.versionNumber})` : "the current humanized draft";
    if (!window.confirm(
      `Check ${what} with ${DETECTOR_NAMES[detector]}?\n\n` +
      `This sends the text to Ryne's ai-score API — 1 billed request (per-detector pricing unverified).\n\n` +
      `AI detection scores are estimates — detectors can be wrong.`)) return;
    setChecking(side);
    try {
      const res = await fetch(apiUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recheck", detectors: [detector], confirmPaid: true,
          operationId: crypto.randomUUID(),
          ...(side === "humanized" ? { text } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ tone: "error", text: data.error || `Check failed (HTTP ${res.status}).` }); return; }
      const s = (data.detection?.scores ?? []).find((x: DetectorScore) => x.detector === detector && x.status === "SCORED");
      if (!s || typeof s.scorePercent !== "number") {
        setNotice({ tone: "error", text: `${DETECTOR_NAMES[detector]} returned no numeric score for this text — nothing was assumed.` });
        return;
      }
      if (side === "humanized") {
        setDraftCheck({ text, detector, pct: s.scorePercent, meaning: s.scoreMeaning });
      } else {
        // A real run on the saved version belongs in report history too.
        const run: ReportRun = {
          id: crypto.randomUUID(), checkedAt: data.detection.checkedAt,
          versionId: data.detection.baseVersionId, contentHash: data.detection.contentHash,
          detectors: [detector], detection: data.detection,
        };
        persistReportRun(documentId, run);
        setReportRuns(readReportRuns(documentId));
        // The server always checks the CURRENT saved version. If it
        // moved ahead of what this page shows (saved elsewhere since
        // load), the fresh score belongs to a different text than the
        // one on screen — realign instead of leaving the old badge up.
        if (data.detection.contentHash !== version.contentHash) {
          setNotice({ tone: "warning", text: "The saved document changed since this page loaded — the check ran on the latest saved version. Reloading so the score matches the text shown." });
          await onVersionDrift?.();
        }
      }
    } finally { setChecking(null); }
  }

  const checkButton = (side: "original" | "humanized", text: string) => (
    <button type="button" onClick={() => checkAi(text, side)}
      disabled={!canCheck}
      title={detection?.configured ? `Run one ${checkDetector ? DETECTOR_NAMES[checkDetector] : ""} check (billed)` : "Ryne detection is not configured on the server."}
      className="px-2 py-0.5 text-[11px] font-medium border border-dvivid-border rounded-button bg-white hover:border-dvivid-primary hover:text-dvivid-primary disabled:opacity-50 whitespace-nowrap">
      {checking === side ? "Checking…" : "Check AI"}
    </button>
  );

  async function humanize() {
    if (running) return;
    if (!configured) { setNotice({ tone: "error", text: "Ryne is not configured on the server." }); return; }
    if (!plan.ok) { setNotice({ tone: "error", text: plan.reason }); return; }
    if ((edited !== null || applied) && !window.confirm("Discard the current humanized draft and generate a new one?")) return;
    const requests = plan.ok ? plan.sections.filter(s => s.kind === "BODY").length : 0;
    if (!window.confirm(
      `Humanize the full document with Ryne ${mode === "titan" ? "Titan" : "Balanced"}?\n\n` +
      `Sends saved version v${version.versionNumber}: ${billableWords.toLocaleString()} words` +
      `${plan.sections.some(s => s.kind === "HEADING") ? " (headings are kept unchanged and not sent)" : ""}.\n` +
      `Estimated cost: ~${fmtUsd(estimate)} for the whole document (documented $${per1k}/1K words — billed by Ryne in prepaid credits).\n` +
      `This one action makes ${requests} billable Ryne request${requests === 1 ? "" : "s"} — one per document section, up to 3 at a time.\n\n` +
      `Your document is not changed until you apply and save the rewrite. No AI detection is run.`)) return;
    const opKey = `${version.id}:${mode}`;
    const operationId = pendingOpRef.current?.key === opKey ? pendingOpRef.current.id : crypto.randomUUID();
    pendingOpRef.current = { key: opKey, id: operationId };
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true); setElapsed(0); setNotice(null); setEditing(false);
    try {
      const res = await fetch(apiUrl, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ action: "humanize-document", mode, confirmPaid: true, operationId, baseVersionId: version.id }),
      });
      pendingOpRef.current = null; // a response arrived — the next click is a new operation
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ tone: "error", text: data.error || `Humanizing failed (HTTP ${res.status}).` }); return; }
      const r = data.result as DocumentHumanizeResult;
      setResult(r); setEdited(null); setApplied(false); setView("humanized");
      setNotice(r.structureWarnings
        ? { tone: "warning", text: `Ryne changed the paragraph structure in ${r.structureWarnings} section(s) — those are shown as whole blocks. Review them before applying.` }
        : null);
    } catch (e: any) {
      setNotice(e?.name === "AbortError"
        ? { tone: "warning", text: "Cancelled. If Ryne had already started, the request may still be billed." }
        : { tone: "error", text: `${e?.message || "Network error"} — retrying reuses the same request id, so it will not be billed twice.` });
      if (e?.name === "AbortError") pendingOpRef.current = null;
    } finally {
      setRunning(false); abortRef.current = null;
    }
  }

  function linkTo(key: string, from: "left" | "right") {
    setActive(key);
    const target = (from === "left" ? rightRefs : leftRefs).current.get(key);
    target?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function keepOriginal() {
    if ((edited !== null || applied) && !window.confirm("Discard the humanized draft and keep the original?")) return;
    setResult(null); setEdited(null); setApplied(false); setEditing(false); setView("original");
    setNotice({ tone: "info", text: "Draft discarded — the original document is unchanged." });
  }

  async function save() {
    if (!window.confirm(`Save the humanized text as a new version (v${version.versionNumber + 1})? The current version stays in the version history.`)) return;
    setSaving(true);
    try { await onSave(output); } finally { setSaving(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(output); setNotice({ tone: "success", text: "Humanized text copied to clipboard." }); }
    catch { setNotice({ tone: "error", text: "Copy failed — select the text manually." }); }
  }

  const paraCls = (key: string, linked: boolean) =>
    `rounded-input px-2 -mx-2 py-1 transition-colors ${linked ? "cursor-pointer hover:bg-dvivid-surface-alt focus:outline-none focus-visible:shadow-focus" : ""} ${active === key ? "bg-dvivid-primary-light ring-1 ring-dvivid-primary-border" : ""}`;

  const renderColumn = (side: "left" | "right") => {
    const refs = side === "left" ? leftRefs : rightRefs;
    return (
      <div className="space-y-3 text-[15px] leading-relaxed text-dvivid-text-primary">
        {pairs.map(p => {
          const text = side === "left" ? p.left : p.right;
          const d = diffs?.get(p.key);
          return (
            <div key={p.key}
              ref={el => { if (el) refs.current.set(p.key, el); else refs.current.delete(p.key); }}
              data-para={p.key}
              role={p.linked ? "button" : undefined} tabIndex={p.linked ? 0 : undefined}
              aria-label={p.linked ? `${side === "left" ? "Original" : "Humanized"} paragraph — show counterpart` : undefined}
              onClick={p.linked ? () => linkTo(p.key, side) : undefined}
              onKeyDown={p.linked ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); linkTo(p.key, side); } } : undefined}
              className={`${paraCls(p.key, p.linked)} whitespace-pre-wrap ${p.heading ? "font-semibold" : ""} ${p.warn ? "border-l-2 border-amber-300 pl-3" : ""}`}>
              {d ? <Tokens tokens={side === "left" ? d.left : d.right} side={side} /> : text}
            </div>
          );
        })}
      </div>
    );
  };

  const originalBody = (
    <div className="space-y-3 text-[15px] leading-relaxed text-dvivid-text-primary">
      {splitParagraphs(version.content).map((p, i) => <p key={i} className="whitespace-pre-wrap">{p}</p>)}
    </div>
  );

  return (
    <section aria-label="Humanizer" className="bg-white border border-dvivid-border rounded-card shadow-card">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 border-b border-dvivid-border-light">
        <label className="flex items-center gap-2 text-sm font-medium text-dvivid-text-primary">
          <span className="whitespace-nowrap">Humanizer model</span>
          <select value={mode} onChange={e => setMode(e.target.value as Mode)} disabled={running}
            className="border border-dvivid-border rounded-input px-3 py-2 text-sm bg-white focus:outline-none focus-visible:shadow-focus">
            <option value="balanced">Balanced (Recommended) · ${pricing.balancedPer1k}/1K</option>
            <option value="titan">Titan · ${pricing.titanPer1k}/1K</option>
          </select>
        </label>
        <p className="hidden md:block text-xs text-dvivid-text-secondary max-w-sm">
          {mode === "titan"
            ? "Strongest rewrite for strict detectors. English only."
            : "Keeps your structure and phrasing while making it read more naturally."}
        </p>
        <div className="ml-auto flex items-center gap-3 text-xs text-dvivid-text-secondary">
          <span>Words: <b className="text-dvivid-text-primary">{stats.ow.toLocaleString()}</b></span>
          <span>Sentences: <b className="text-dvivid-text-primary">{stats.os}</b></span>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-4 space-y-2" aria-live="polite">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {applied && (
          <Notice tone="info" role="status">
            <span className="font-semibold">Rewrite applied to your working draft — not saved yet.</span>{" "}
            Save it as a new version, or undo to keep the original.
          </Notice>
        )}
        {restorable && !result && (
          <Notice tone="success">
            Saved. The previous version (v{restorable.versionNumber}) is kept in history.{" "}
            <button type="button" onClick={onRestore} className="underline font-medium">Restore previous version</button>
          </Notice>
        )}
      </div>

      {/* mobile switch */}
      <div className="lg:hidden px-4 sm:px-6 pt-4">
        <TabBar label="Document view" value={view} onChange={setView} className="w-full"
          tabs={[
            { id: "original", label: `Original (${stats.ow.toLocaleString()})` },
            { id: "humanized", label: result ? `Humanized (${stats.rw.toLocaleString()})` : "Humanized" },
          ]} />
      </div>

      {/* before/after score comparison — only when BOTH sides hold a
          genuine score for the exact text shown */}
      {origScore && humBadge && (
        <div className="px-4 sm:px-6 pt-3 -mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-dvivid-text-secondary" role="status">
          <span>
            <b className="text-dvivid-text-primary">{DETECTOR_NAMES[origScore.detector]} {Math.round(origScore.scorePercent!)}%</b>
            <span className="text-dvivid-text-muted"> (original) → </span>
            <b className="text-dvivid-text-primary">{humBadge.label} {Math.round(humBadge.pct)}%</b>
            <span className="text-dvivid-text-muted"> (rewrite) · </span>
            <b className={humBadge.pct <= origScore.scorePercent! ? "text-dvivid-success" : "text-dvivid-warning"}>
              {humBadge.pct <= origScore.scorePercent! ? "−" : "+"}{Math.abs(Math.round(humBadge.pct - origScore.scorePercent!))} pts
            </b>
          </span>
          {humBadge.label !== DETECTOR_NAMES[origScore.detector] && (
            <span className="text-dvivid-warning">Different detectors — scores aren&apos;t directly comparable.</span>
          )}
          <span className="text-dvivid-text-muted">AI detection scores are estimates — a lower score does not guarantee the text won&apos;t be flagged.</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 p-4 sm:p-6">
        {/* LEFT: original */}
        <div className={`${view === "original" ? "flex" : "hidden"} lg:flex flex-col min-w-0 border border-dvivid-border rounded-card`}>
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-dvivid-border-light bg-dvivid-surface-alt rounded-t-card">
            <h2 className="text-sm font-semibold text-dvivid-text-primary truncate">Original SOP <span className="font-normal text-dvivid-text-muted">· v{version.versionNumber}</span></h2>
            <span className="shrink-0">
              {origScore
                ? <ScoreBadge label={DETECTOR_NAMES[origScore.detector]} percent={origScore.scorePercent!}
                    title={`${DETECTOR_NAMES[origScore.detector]} score for the saved version shown — checked ${origScore.lastCheckedAt ? new Date(origScore.lastCheckedAt).toLocaleString() : "earlier"}. Applies to this exact text only.${meaningNote(origScore.scoreMeaning)}`} />
                : checkButton("original", version.content)}
            </span>
          </div>
          <div className="px-4 py-4 overflow-auto max-h-[60vh] lg:max-h-[62vh]" tabIndex={0} aria-label="Original text">
            {result ? renderColumn("left") : originalBody}
          </div>
          <div className="px-4 py-2 border-t border-dvivid-border-light text-xs text-dvivid-text-muted text-right">
            {stats.ow.toLocaleString()} words · {stats.os} sentences
          </div>
        </div>

        {/* RIGHT: humanized */}
        <div className={`${view === "humanized" ? "flex" : "hidden"} lg:flex flex-col min-w-0 border rounded-card ${result ? "border-green-200" : "border-dvivid-border"}`}>
          <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b rounded-t-card ${result ? "bg-dvivid-success-light/60 border-green-100" : "bg-dvivid-surface-alt border-dvivid-border-light"}`}>
            <h2 className="text-sm font-semibold text-dvivid-text-primary truncate">
              Humanized SOP {result && <span className="font-normal text-dvivid-text-muted">· Ryne {result.mode === "titan" ? "Titan" : "Balanced"}{edited !== null ? " · edited" : ""}</span>}
            </h2>
            {result && (
              <div className="flex items-center gap-1.5 shrink-0">
                {humBadge && <ScoreBadge label={humBadge.label} percent={humBadge.pct} title={humBadge.title} />}
                {/* The named-detector check stays available next to the
                    free Ryne score — same detector on both panes. */}
                {!validDraftCheck && checkButton("humanized", output)}
                <button type="button" onClick={() => { if (!editing && edited === null) setEdited(result.content); setEditing(!editing); }}
                  className="px-2.5 py-1 text-xs font-medium border border-dvivid-border rounded-button bg-white hover:border-dvivid-primary hover:text-dvivid-primary">
                  {editing ? "Done" : "Edit"}
                </button>
                <button type="button" onClick={copy} aria-label="Copy humanized text"
                  className="px-2.5 py-1 text-xs font-medium border border-dvivid-border rounded-button bg-white hover:border-dvivid-primary hover:text-dvivid-primary">
                  Copy
                </button>
              </div>
            )}
          </div>
          <div className="px-4 py-4 overflow-auto max-h-[60vh] lg:max-h-[62vh] min-h-[16rem]" tabIndex={0} aria-label="Humanized text" aria-busy={running}>
            {running ? (
              <div className="space-y-3" role="status">
                <p className="text-sm text-dvivid-text-secondary">
                  Humanizing {billableWords.toLocaleString()} words with Ryne {mode === "titan" ? "Titan" : "Balanced"}… {elapsed}s
                  <span className="block text-xs text-dvivid-text-muted">Full documents usually take 20–90 seconds.</span>
                </p>
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="h-3 rounded bg-dvivid-border-light motion-safe:animate-pulse" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
                ))}
                <SecondaryButton onClick={() => abortRef.current?.abort()} className="!px-3 !py-1.5 text-xs">Cancel</SecondaryButton>
              </div>
            ) : !result ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                <p className="text-sm font-semibold text-dvivid-text-primary">Rewrite the whole document at once</p>
                <p className="text-xs text-dvivid-text-secondary max-w-xs">
                  Ryne rewrites every paragraph while keeping the structure, names, institutions and dates. You can compare, edit and decide before anything is saved.
                </p>
                <PrimaryButton onClick={humanize} disabled={!configured || !plan.ok}>Humanize Document</PrimaryButton>
                <p className="text-[11px] text-dvivid-text-muted">~{fmtUsd(estimate)} · {billableWords.toLocaleString()} words · {mode === "titan" ? "Titan" : "Balanced"}</p>
                {!configured && <p className="text-xs text-dvivid-error">Ryne is not configured on the server.</p>}
              </div>
            ) : editing ? (
              <textarea value={output} onChange={e => setEdited(e.target.value)} aria-label="Edit humanized text"
                className="w-full min-h-[50vh] text-[15px] leading-relaxed border border-dvivid-border rounded-input p-3 focus:outline-none focus-visible:shadow-focus resize-y" />
            ) : renderColumn("right")}
          </div>
          <div className="px-4 py-2 border-t border-dvivid-border-light text-xs text-dvivid-text-muted flex flex-wrap justify-between gap-2">
            <span>
              {result?.sections.some(s => typeof s.aiScore === "number") &&
                `Ryne Beast Mode score (provider-reported): ${result.sections.filter(s => typeof s.aiScore === "number").map(s => s.aiScore).join(", ")}`}
            </span>
            <span>{result ? `${stats.rw.toLocaleString()} words · ${stats.rs} sentences` : ""}</span>
          </div>
        </div>
      </div>

      {result && missing.length > 0 && (
        <div className="px-4 sm:px-6 -mt-2 pb-2">
          <Notice tone="warning">
            Check these details from the original — they don&apos;t appear in the rewrite: <b>{missing.join(", ")}</b>
          </Notice>
        </div>
      )}

      {/* action bar */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 border-t border-dvivid-border bg-white/95 backdrop-blur rounded-b-card">
        <Toggle checked={highlight} onChange={setHighlight} label="Highlight changes" />
        {highlight && result && (
          <span className="hidden sm:flex items-center gap-2 text-[11px] text-dvivid-text-muted">
            <span className="px-1.5 rounded-sm bg-red-50 text-red-700 line-through">Removed</span>
            <span className="px-1.5 rounded-sm bg-green-50 text-green-800">Added</span>
          </span>
        )}
        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
          {result && !applied && <>
            <SecondaryButton onClick={humanize} disabled={running} className="flex-1 sm:flex-none">Regenerate</SecondaryButton>
            <SecondaryButton onClick={keepOriginal} disabled={running} className="flex-1 sm:flex-none">Keep Original</SecondaryButton>
            <PrimaryButton onClick={() => { setApplied(true); setEditing(false); }} disabled={running || !output.trim()} className="w-full sm:w-auto">Apply This Rewrite</PrimaryButton>
          </>}
          {result && applied && <>
            <SecondaryButton onClick={() => setApplied(false)} disabled={saving} className="flex-1 sm:flex-none">Undo Apply</SecondaryButton>
            <PrimaryButton onClick={save} disabled={saving || !output.trim()} className="flex-1 sm:flex-none">{saving ? "Saving…" : "Save as New Version"}</PrimaryButton>
          </>}
          {!result && (
            <PrimaryButton onClick={humanize} disabled={running || !configured || !plan.ok} className="w-full sm:w-auto">
              {running ? "Humanizing…" : "Humanize Document"}
            </PrimaryButton>
          )}
        </div>
      </div>
    </section>
  );
}
