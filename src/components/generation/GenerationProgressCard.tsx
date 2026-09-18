"use client";

// ============================================================
// GenerationProgressCard — animated six-stage generation UX.
//
// REAL PROGRESS = backend lifecycle only (currentStage,
// completedStages, status). LIVE ACTIVITY = looping animation on
// the active segment only while the heartbeat is healthy.
// Nothing advances on timers; no fake percentage.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { StageProgressRail } from "./StageProgressRail";
import { SectionCard, SecondaryButton } from "@/components/ui";

// Internal stage ids (never rendered) → consultant-facing copy.
const STAGES = [
  { id: "planner", short: "Prepare", title: "Preparing your document", desc: "Organizing applicant information and document requirements." },
  { id: "writer", short: "Write", title: "Writing your draft", desc: "Building the first complete version from the applicant's information." },
  { id: "qualityReviewer", short: "Review", title: "Checking your draft", desc: "Reviewing structure, requirements and overall quality." },
  { id: "languageCalibrator", short: "Polish", title: "Improving clarity", desc: "Refining language and readability while preserving facts." },
  { id: "finalizer", short: "Finalize", title: "Finalizing the document", desc: "Applying final formatting and requirement checks." },
  { id: "factReviewer", short: "Verify", title: "Verifying facts", desc: "Checking the final document against approved applicant information." },
];

export interface GenerationLiveStatus {
  status?: string;
  currentStage?: string | null;
  completedStages?: number;
  totalStages?: number;
  startedAt?: string | null;
  currentStageStartedAt?: string | null;
  lastHeartbeatAt?: string | null;
  heartbeatStale?: boolean;
  cancelRequestedAt?: string | null;
}

interface GenerationProgressCardProps {
  documentTitle?: string;
  status: GenerationLiveStatus | null;
  cancelling: boolean;
  onCancel: () => void;
  onCheckAgain: () => void;
}

function fmtElapsed(startedAt?: string | null, now?: number): string {
  if (!startedAt) return "";
  const secs = Math.max(0, Math.floor(((now ?? Date.now()) - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtClock(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function GenerationProgressCard({ documentTitle, status, cancelling, onCancel, onCheckAgain }: GenerationProgressCardProps) {
  const reduce = useReducedMotion();
  const total = status?.totalStages ?? 6;
  const completed = status?.completedStages ?? 0;
  const stageIdx = STAGES.findIndex(s => s.id === status?.currentStage);
  const activeIdx = stageIdx >= 0 ? stageIdx : Math.min(completed, total - 1);
  const active = STAGES[activeIdx];
  const cancelRequested = status?.status === "CANCEL_REQUESTED" || cancelling;

  // Heartbeat staleness — grace window shows "checking", then interrupted.
  const stale = status?.heartbeatStale === true;
  const staleSinceRef = useRef<number | null>(null);
  const [staleConfirmed, setStaleConfirmed] = useState(false);
  useEffect(() => {
    if (!stale) {
      staleSinceRef.current = null;
      setStaleConfirmed(false);
      return;
    }
    if (staleSinceRef.current === null) staleSinceRef.current = Date.now();
    const iv = setInterval(() => {
      if (staleSinceRef.current && Date.now() - staleSinceRef.current > 10000) setStaleConfirmed(true);
    }, 1000);
    return () => clearInterval(iv);
  }, [stale]);

  const healthy = !stale && !cancelRequested;

  // Elapsed time — 1s local tick, no backend calls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Screen-reader announcements on real stage transitions only.
  const [announce, setAnnounce] = useState("");
  const prevIdxRef = useRef(activeIdx);
  useEffect(() => {
    if (activeIdx !== prevIdxRef.current) {
      prevIdxRef.current = activeIdx;
      setAnnounce(`${STAGES[activeIdx].title} started`);
    }
  }, [activeIdx]);
  useEffect(() => {
    if (cancelRequested) setAnnounce("Stopping generation");
  }, [cancelRequested]);

  const activityRows = useMemo(() => {
    const rows: Array<[string, string]> = [];
    if (status?.startedAt) rows.push([fmtClock(status.startedAt), "Generation started"]);
    if (status?.currentStageStartedAt && active) rows.push([fmtClock(status.currentStageStartedAt), `${active.title} started`]);
    if (status?.lastHeartbeatAt) rows.push([fmtClock(status.lastHeartbeatAt), "Last status update"]);
    if (status?.cancelRequestedAt) rows.push([fmtClock(status.cancelRequestedAt), "Cancellation requested"]);
    return rows;
  }, [status, active]);

  return (
    <SectionCard className="mb-8">
      <div aria-live="polite" className="sr-only">{announce}</div>

      <div className="bg-dvivid-primary-light border border-dvivid-primary-border rounded-input p-5">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <p className="text-sm font-medium text-dvivid-primary">
            Generating {documentTitle || "document"}
          </p>
          <p className="text-xs text-dvivid-text-secondary">
            Stage {Math.min(activeIdx + 1, total)} of {total} · {completed} complete
            {status?.startedAt ? ` · ${fmtElapsed(status.startedAt)} elapsed` : ""}
          </p>
        </div>

        {/* Rail — desktop/tablet labels, mobile compact */}
        <div className="hidden sm:block">
          <StageProgressRail stages={STAGES} activeIndex={activeIdx} completedCount={completed} healthy={healthy} />
        </div>
        <div className="sm:hidden">
          <StageProgressRail stages={STAGES} activeIndex={activeIdx} completedCount={completed} healthy={healthy} compact />
        </div>

        {/* Current activity */}
        <div className="mt-5">
          {stale ? (
            <div>
              <p className="text-base font-semibold text-dvivid-warning">
                {staleConfirmed ? "Generation appears interrupted." : "Checking generation status..."}
              </p>
              {staleConfirmed && (
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <SecondaryButton onClick={onCheckAgain}>Check Again</SecondaryButton>
                  <button
                    onClick={onCancel}
                    disabled={cancelling}
                    className="px-4 py-2 text-sm font-medium text-dvivid-error border border-dvivid-error/30 rounded-button hover:bg-dvivid-error-light transition-colors disabled:opacity-50"
                  >
                    {cancelling ? "Cancelling..." : "Cancel / Reset Generation"}
                  </button>
                </div>
              )}
            </div>
          ) : cancelRequested ? (
            <p className="text-base font-semibold text-dvivid-text-primary">Stopping generation...</p>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIdx}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
              >
                <p className="text-base font-semibold text-dvivid-text-primary">{active.title}</p>
                <p className="text-sm text-dvivid-text-secondary mt-0.5">{active.desc}</p>
                {status?.currentStageStartedAt &&
                  Date.now() - new Date(status.currentStageStartedAt).getTime() > 90_000 && (
                  <p className="text-xs text-dvivid-text-secondary mt-1">
                    This stage is taking a little longer than usual, but generation is still active.
                  </p>
                )}
                <p className="text-xs text-dvivid-text-muted mt-2">
                  {status?.startedAt ? `${fmtElapsed(status.startedAt)} elapsed` : "Starting..."}
                  {reduce ? " · In progress" : ""}
                </p>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Footer: leave-page reassurance + activity + cancel */}
        {!stale && !cancelRequested && (
          <p className="text-xs text-dvivid-text-muted mt-4">
            You can leave this page. Generation will continue in the background.
          </p>
        )}

        {activityRows.length > 0 && (
          <details className="mt-3 text-xs text-dvivid-text-muted">
            <summary className="cursor-pointer hover:text-dvivid-text-secondary">View activity</summary>
            <ul className="mt-2 space-y-1 pl-1">
              {activityRows.map(([t, label], i) => (
                <li key={i} className="flex gap-2">
                  <span className="tabular-nums text-dvivid-text-muted">{t}</span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {!stale && (
          <div className="mt-4 pt-4 border-t border-dvivid-primary-border/40">
            {cancelRequested ? (
              <p className="text-sm text-dvivid-text-secondary">Stopping generation...</p>
            ) : (
              <CancelControl onCancel={onCancel} />
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function CancelControl({ onCancel }: { onCancel: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm text-dvivid-text-secondary hover:text-dvivid-error underline-offset-2 hover:underline transition-colors"
      >
        Cancel generation
      </button>
    );
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <p className="text-sm font-medium text-dvivid-text-primary">Stop generating this document?</p>
      <p className="text-xs text-dvivid-text-secondary mt-1">
        The current AI request may already have used some credits. No partial draft will be saved.
      </p>
      <div className="flex items-center gap-3 mt-3">
        <SecondaryButton onClick={() => setConfirming(false)}>Keep generating</SecondaryButton>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-white bg-dvivid-error rounded-button hover:opacity-90 transition-opacity"
        >
          Stop generation
        </button>
      </div>
    </motion.div>
  );
}
