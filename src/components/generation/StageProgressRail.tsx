"use client";

// ============================================================
// StageProgressRail — animated six-stage rail.
// REAL PROGRESS (nodes/checks/active index) comes only from
// backend lifecycle state. LIVE ACTIVITY (tracer + pulse) runs
// only while the backend reports a healthy heartbeat.
// Reduced-motion: no continuous animation, solid accents instead.
// ============================================================

import { motion, useReducedMotion } from "motion/react";

export interface RailStage {
  short: string;
}

interface StageProgressRailProps {
  stages: RailStage[];
  activeIndex: number;      // index of the currently-running stage
  completedCount: number;   // backend completedStages
  healthy: boolean;         // heartbeat healthy AND status RUNNING
  compact?: boolean;        // mobile dot/segment variant
}

function Node({ state, healthy }: { state: "done" | "active" | "todo"; healthy: boolean }) {
  const reduce = useReducedMotion();
  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-6 h-6 rounded-full bg-dvivid-primary text-white flex items-center justify-center text-xs flex-shrink-0"
      >
        ✓
      </motion.span>
    );
  }
  if (state === "active") {
    return (
      <motion.span
        className="w-6 h-6 rounded-full bg-dvivid-primary flex items-center justify-center flex-shrink-0"
        animate={reduce || !healthy ? {} : { scale: [1, 1.08, 1], opacity: [1, 0.75, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="w-2 h-2 rounded-full bg-white" />
      </motion.span>
    );
  }
  return (
    <span className="w-6 h-6 rounded-full border-2 border-dvivid-border bg-white flex-shrink-0" />
  );
}

function Segment({ state, healthy }: { state: "done" | "active" | "todo"; healthy: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex-1 h-1 rounded-full bg-dvivid-border-light overflow-hidden relative min-w-4">
      {state === "done" && <div className="absolute inset-0 bg-dvivid-primary" />}
      {state === "active" && (
        <>
          <div className="absolute inset-0 bg-dvivid-primary/25" />
          {!reduce && healthy && (
            <motion.div
              className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-dvivid-primary to-transparent"
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 2, ease: "linear", repeat: Infinity }}
            />
          )}
          {(reduce || !healthy) && <div className="absolute inset-0 bg-dvivid-primary/50" />}
        </>
      )}
    </div>
  );
}

export function StageProgressRail({ stages, activeIndex, completedCount, healthy, compact }: StageProgressRailProps) {
  const stateFor = (i: number): "done" | "active" | "todo" =>
    i < completedCount ? "done" : i === activeIndex ? "active" : "todo";

  if (compact) {
    // Mobile: dots/segments only — no cramped labels.
    return (
      <div className="flex items-center gap-1.5" role="list" aria-label="Generation stages">
        {stages.map((s, i) => (
          <div key={s.short} className="flex-1 h-1.5 rounded-full overflow-hidden bg-dvivid-border-light relative" role="listitem" aria-label={`${s.short} ${stateFor(i)}`}>
            {stateFor(i) === "done" && <div className="absolute inset-0 bg-dvivid-primary" />}
            {stateFor(i) === "active" && (
              healthy ? (
                <motion.div
                  className="absolute inset-y-0 w-1/2 bg-dvivid-primary"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, ease: "linear", repeat: Infinity }}
                />
              ) : (
                <div className="absolute inset-0 bg-dvivid-primary/50" />
              )
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-start" role="list" aria-label="Generation stages">
      {stages.map((s, i) => {
        const state = stateFor(i);
        return (
          <div key={s.short} className="flex items-center flex-1 last:flex-none" role="listitem">
            <div className="flex flex-col items-center gap-1.5">
              <Node state={state} healthy={healthy} />
              <span className={`text-[11px] leading-tight text-center whitespace-nowrap ${
                state === "active" ? "font-semibold text-dvivid-primary" :
                state === "done" ? "text-dvivid-text-secondary" : "text-dvivid-text-muted"
              }`}>
                {s.short}
              </span>
            </div>
            {i < stages.length - 1 && <Segment state={state} healthy={healthy} />}
          </div>
        );
      })}
    </div>
  );
}
