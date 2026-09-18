"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PROMPT_SOURCE_LABELS } from "@/lib/application/application-types";
import { getProfileReadiness } from "@/lib/application/intake-completion";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
  SectionCard, StatusBadge,
} from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";

interface Document {
  id: string;
  applicationId: string;
  documentType: string;
  documentTitle: string;
  promptText: string;
  promptSource: string;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  requirementsStatus: string;
  generationStatus: string;
  reviewStatus: string;
  currentVersionId?: string;
  approvedVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Version {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  contentFormat: string;
  createdByType: string;
  parentVersionId?: string;
  model?: string;
  generationId?: string;
  costUsd?: number;
  costInr?: number;
  createdAt: string;
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface Application {
  id: string;
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  country: string;
  intake: string;
  intakeYear: string;
}

interface GenerationResult {
  status: string;
  generationId: string;
  documentType: string;
  version: {
    id: string;
    versionNumber: number;
    content: string;
    wordCount: number;
    model: string;
    costUsd: number | null;
    costInr: number | null;
    factReview: any;
    compliance: any;
  };
  pipeline: {
    stages: number;
    duration: number;
    cost: any;
  };
  promptResolution: {
    source: string;
    path: string;
    mergedWithDefault: boolean;
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Convert internal blocking-reason codes into consultant-facing language. */
function humanizeBlockReason(reason: string): string {
  const text = reason.replace(/^[A-Z_]+:\s*/, "");
  if (/fact.?sheet|facts must be approved/i.test(reason)) {
    return "Applicant information hasn't been confirmed yet — review and confirm it in the intake.";
  }
  if (/no meaningful data|no student profile/i.test(reason)) {
    return "Applicant information is incomplete.";
  }
  if (/recommender/i.test(reason)) {
    return "Recommender details are required for a Letter of Recommendation.";
  }
  if (/visa/i.test(reason)) {
    return "Visa-specific information is required for a Visa SOP.";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Consultant-facing stage labels — never expose internal stage names.
const generationStageLabels = [
  "Preparing document",
  "Writing draft",
  "Checking quality",
  "Improving language",
  "Finalizing document",
  "Verifying facts",
];

function formatElapsed(startedAt?: string | null): string {
  if (!startedAt) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function DocumentWorkspacePage() {
  const params = useParams();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;
  const documentId = params.documentId as string;

  const [document, setDocument] = useState<Document | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [generationBlockReasons, setGenerationBlockReasons] = useState<string[]>([]);
  const [profile, setProfile] = useState<any>(null);

  const [editorContent, setEditorContent] = useState("");
  const [editorBaseVersionId, setEditorBaseVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  // Live generation status polled from the server — the authoritative
  // source for stage progress, heartbeat, and cancellation state.
  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [cancelling, setCancelling] = useState(false);
  const [, setElapsedTick] = useState(0);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/application/document?id=${documentId}&studentId=${studentId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Document not found");
        return;
      }
      const data = await res.json();
      setDocument(data.document);

      const versionRes = await fetch(`/api/application/version?documentId=${documentId}`);
      if (versionRes.ok) {
        const versionData = await versionRes.json();
        const v: Version[] = versionData.versions || [];
        setVersions(v);
        const currentId = data.document?.currentVersionId;
        const current = currentId ? v.find(ver => ver.id === currentId) : null;
        const target = current || (v.length > 0 ? v[v.length - 1] : null);
        if (target) {
          setSelectedVersion(target);
          setEditorContent(target.content);
          setEditorBaseVersionId(target.id);
        }
      }

      if (data.document?.applicationId) {
        const appRes = await fetch(`/api/application/list?applicationId=${data.document.applicationId}&studentId=${studentId}`);
        if (appRes.ok) {
          const appData = await appRes.json();
          setApplication(appData.application);
        }
        // Fetch student separately since /api/application/list doesn't return student
        const studentRes = await fetch(`/api/application/student?id=${studentId}`);
        if (studentRes.ok) {
          const studentData = await studentRes.json();
          setStudent(studentData.student);
        }
        // Fetch profile for pre-generation readiness display
        const profileRes = await fetch(`/api/application/profile?studentId=${studentId}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setProfile(profileData.profile);
        }
      }
    } catch {
      setError("Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [documentId, studentId]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // ===== Live generation status polling =====
  // While the server reports an active run (QUEUED/RUNNING/
  // CANCEL_REQUESTED) — or the document is marked GENERATING — poll a
  // lightweight status endpoint every 2s. Progress, heartbeat and
  // cancellation all come from the server; nothing is faked locally.
  const generationActive =
    generating ||
    document?.generationStatus === "GENERATING" ||
    liveStatus?.active === true;

  useEffect(() => {
    if (!generationActive) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/application/document/generation-status?documentId=${documentId}&studentId=${studentId}`,
          { cache: "no-store" },
        );
        if (!res.ok || stopped) return;
        const data = await res.json();
        setLiveStatus(data);
        if (data.status === "COMPLETED" || data.status === "FAILED" || data.status === "CANCELLED") {
          setGenerating(false);
          if (data.status === "COMPLETED") {
            await loadDocument();
          }
        }
      } catch { /* transient poll error — keep polling */ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationActive, documentId, studentId]);

  // 1s tick for the elapsed-time display only (not progress).
  useEffect(() => {
    if (!generationActive) return;
    const iv = setInterval(() => setElapsedTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [generationActive]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerationError("");
    setGenerationBlockReasons([]);
    setGenerationResult(null);
    setLiveStatus(null);

    try {
      const res = await fetch("/api/application/document/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId }),
      });
      const data = await res.json();
      if (data.status === "cancelled") {
        await loadDocument();
        return;
      }
      if (!res.ok) {
        // Surface structured blocking reasons so the consultant knows
        // exactly what to fix, not just "generation is blocked".
        if (data.error === "GENERATION_BLOCKED" && Array.isArray(data.blockReasons)) {
          setGenerationBlockReasons(data.blockReasons);
        } else {
          setGenerationBlockReasons([]);
        }
        setGenerationError(data.message || data.error || "Generation failed");
        return;
      }
      setGenerationResult(data);
      await loadDocument();
    } catch (err: any) {
      setGenerationError(err?.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCancelGeneration() {
    setCancelling(true);
    setGenerationError("");
    try {
      await fetch("/api/application/document/generation/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId }),
      });
      // The status poll picks up CANCEL_REQUESTED → CANCELLED.
    } catch {
      setGenerationError("Cancellation request failed — try again.");
    } finally {
      setCancelling(false);
    }
  }

  const wordCount = useMemo(() => countWords(editorContent), [editorContent]);
  const charCount = editorContent.length;

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedVersion) return editorContent.trim().length > 0;
    return editorContent !== selectedVersion.content;
  }, [editorContent, selectedVersion]);

  async function handleSaveNewVersion() {
    if (!editorContent.trim()) {
      setSaveError("Content cannot be empty");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/application/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          applicationId,
          documentId,
          content: editorContent,
          baseVersionId: editorBaseVersionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to save version");
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadDocument();
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save version");
    } finally {
      setSaving(false);
    }
  }

  function handleSelectVersion(v: Version) {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. Switching versions will discard them. Continue?")) {
        return;
      }
    }
    setSelectedVersion(v);
    setEditorContent(v.content);
    setEditorBaseVersionId(v.id);
    setSaveError("");
    setSaveSuccess(false);
  }

  function handleEditFromVersion(v: Version) {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. Loading this version will discard them. Continue?")) {
        return;
      }
    }
    setSelectedVersion(v);
    setEditorContent(v.content);
    setEditorBaseVersionId(v.id);
    setSaveError("");
    setSaveSuccess(false);
  }

  async function handleApprove() {
    if (!selectedVersion) return;
    setApproving(true);
    setApproveError("");
    try {
      const res = await fetch("/api/application/version/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          applicationId,
          documentId,
          versionId: selectedVersion.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApproveError(data.error || "Approval failed");
        return;
      }
      setShowApproveConfirm(false);
      await loadDocument();
    } catch (err: any) {
      setApproveError(err?.message || "Approval failed");
    } finally {
      setApproving(false);
    }
  }

  async function handleExport(format: "PDF" | "DOCX", mode: "PREVIEW" | "FINAL", explicitVersionId?: string) {
    const versionId = explicitVersionId || selectedVersion?.id;
    if (!versionId) return;
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch("/api/application/document/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          applicationId,
          documentId,
          versionId,
          format,
          mode,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setExportError(data.error || "Export failed");
        return;
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? filenameMatch[1] : "export";
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = filename;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading document...</div></PageContainer>;
  }

  if (error && !document) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error}</p>
          <Link href={`/students/${studentId}/applications/${applicationId}`} className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">
            ← Back to application
          </Link>
        </div>
      </PageContainer>
    );
  }

  const promptSourceLabel = PROMPT_SOURCE_LABELS[document?.promptSource as keyof typeof PROMPT_SOURCE_LABELS] || document?.promptSource;
  const canGenerate = document?.generationStatus !== "GENERATING" && !generating;
  const isApproved = document?.reviewStatus === "APPROVED";
  const approvedVersion = versions.find(v => v.id === document?.approvedVersionId);
  // Pre-generation readiness — only gate when profile was actually loaded.
  // If the profile fetch failed, let the server decide (it returns 422 with reasons).
  const readiness = profile ? getProfileReadiness(profile, application) : null;
  const readinessBlocked = readiness ? !readiness.canGenerate : false;

  return (
    <PageContainer>
      <WorkflowStepper
        generationStatus={document?.generationStatus}
        reviewStatus={document?.reviewStatus}
      />
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: student ? `${student.firstName} ${student.lastName}` : "Student", href: `/students/${studentId}` },
        { label: application?.universityName || "Application", href: `/students/${studentId}/applications/${applicationId}` },
        { label: document?.documentTitle || "Document" },
      ]} />

      {/* Document Header */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-7 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-page-title text-dvivid-text-primary">{document?.documentTitle}</h1>
            {application && (
              <p className="text-base text-dvivid-text-secondary mt-1.5">
                {application.universityName} · {application.programName} · {application.degree}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* One clear status — never "Generating + Draft" together */}
            {generationActive ? (
              <StatusBadge status="IN_REVIEW" label="Generating" />
            ) : (
              <>
                <StatusBadge status={document?.generationStatus || "NOT_GENERATED"} />
                <StatusBadge status={document?.reviewStatus || "DRAFT"} />
              </>
            )}
          </div>
        </div>
        {approvedVersion && (
          <div className="mt-4 pt-4 border-t border-dvivid-border-light">
            <p className="text-sm text-dvivid-success font-medium">
              ✓ Approved Version {approvedVersion.versionNumber}
            </p>
          </div>
        )}
      </div>

      {/* Live generation progress — driven by server status, not timers */}
      {generationActive && (
        <SectionCard className="mb-8">
          {(() => {
            const completed = liveStatus?.completedStages ?? 0;
            const total = liveStatus?.totalStages ?? 6;
            const activeIdx = Math.min(completed, total - 1);
            const cancelRequested = liveStatus?.status === "CANCEL_REQUESTED" || cancelling;
            const stale = liveStatus?.heartbeatStale === true;
            return (
              <div className={`border rounded-input p-5 ${
                stale ? "bg-dvivid-warning-light border-dvivid-warning/20" : "bg-dvivid-primary-light border-dvivid-primary-border"
              }`}>
                <p className="text-sm font-medium text-dvivid-primary mb-1">
                  Generating {document?.documentTitle || "document"}
                </p>
                <p className="text-xs text-dvivid-text-secondary mb-3">
                  Stage {activeIdx + 1} of {total} · {completed} stage{completed !== 1 ? "s" : ""} complete
                  {liveStatus?.startedAt ? ` · Elapsed: ${formatElapsed(liveStatus.startedAt)}` : ""}
                </p>
                <div className="space-y-2">
                  {generationStageLabels.map((label, i) => (
                    <div key={i} className={`flex items-center gap-2.5 text-sm ${
                      i <= completed || i === activeIdx ? "text-dvivid-text-primary" : "text-dvivid-text-muted"
                    }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                        i < completed ? "bg-dvivid-primary text-white" :
                        i === activeIdx ? "border-2 border-dvivid-primary text-dvivid-primary animate-pulse" :
                        "border-2 border-dvivid-border"
                      }`}>
                        {i < completed ? "✓" : i === activeIdx ? "●" : ""}
                      </span>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                {stale ? (
                  <div className="mt-4 pt-4 border-t border-dvivid-warning/30">
                    <p className="text-sm text-dvivid-warning font-medium mb-3">
                      Generation connection appears interrupted.
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <SecondaryButton onClick={loadDocument}>Check Again</SecondaryButton>
                      <button
                        onClick={handleCancelGeneration}
                        disabled={cancelling}
                        className="px-4 py-2 text-sm font-medium text-dvivid-error border border-dvivid-error/30 rounded-button hover:bg-dvivid-error-light transition-colors disabled:opacity-50"
                      >
                        {cancelling ? "Cancelling..." : "Cancel / Reset Generation"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 pt-4 border-t border-dvivid-primary-border/40">
                    <button
                      onClick={handleCancelGeneration}
                      disabled={cancelRequested}
                      className="px-4 py-2 text-sm font-medium text-dvivid-error border border-dvivid-error/30 rounded-button hover:bg-dvivid-error-light transition-colors disabled:opacity-50"
                    >
                      {cancelRequested ? "Stopping..." : "Cancel Generation"}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </SectionCard>
      )}

      {/* Cancelled — terminal notice */}
      {!generationActive && liveStatus?.status === "CANCELLED" && (
        <div className="mb-8 p-4 bg-gray-50 border border-dvivid-border rounded-input">
          <p className="text-sm font-medium text-dvivid-text-primary mb-1">Generation cancelled.</p>
          <p className="text-sm text-dvivid-text-secondary">No draft was saved. You can generate again whenever you're ready.</p>
        </div>
      )}

      {/* Failed — terminal notice */}
      {!generationActive && liveStatus?.status === "FAILED" && document?.generationStatus !== "GENERATED" && versions.length === 0 && (
        <div className="mb-8 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
          <p className="text-sm font-medium text-dvivid-error mb-1">Generation stopped because of an error.</p>
          <p className="text-sm text-dvivid-text-secondary">You can try again — if it keeps failing, check that the applicant information is complete.</p>
        </div>
      )}

      {/* Generation Section (only if no versions yet) */}
      {versions.length === 0 && !generating && document?.generationStatus !== "GENERATING" && (
        <SectionCard title="Generate Document" description="Generate a first draft using the AI pipeline." className="mb-8">
          {document?.generationStatus === "FAILED" && (
            <div className="mb-4 p-4 bg-dvivid-warning-light border border-dvivid-warning/20 rounded-input">
              <p className="text-sm text-dvivid-warning">
                A previous generation attempt failed. You can try again — if it fails repeatedly,
                check the readiness items below.
              </p>
            </div>
          )}

          {/* Pre-generation readiness */}
          {readiness && (
            readiness.canGenerate ? (
              <div className="mb-4 p-4 bg-dvivid-success-light border border-dvivid-success/20 rounded-input">
                <p className="text-sm font-medium text-dvivid-success mb-1.5">Ready to generate</p>
                <ul className="space-y-1 text-sm text-dvivid-text-secondary">
                  <li>✓ Applicant information</li>
                  <li>✓ Prompt / instructions</li>
                  <li>✓ Requirements</li>
                </ul>
              </div>
            ) : (
              <div className="mb-4 p-4 bg-dvivid-warning-light border border-dvivid-warning/20 rounded-input">
                <p className="text-sm font-medium text-dvivid-warning mb-2">Before you can generate:</p>
                <ul className="space-y-1.5">
                  {readiness.sections
                    .filter(s => !s.optional && s.status !== "complete")
                    .map(s => (
                      <li key={s.slug} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-dvivid-text-primary">! {s.label} required</span>
                        <Link
                          href={`/students/${studentId}/applications/${applicationId}/intake/missing`}
                          className="text-xs text-dvivid-primary hover:underline whitespace-nowrap"
                        >
                          Complete {s.label} →
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            )
          )}

          <PrimaryButton
            onClick={handleGenerate}
            disabled={!canGenerate || readinessBlocked}
            className="w-full"
          >
            Generate Document
          </PrimaryButton>
          {readinessBlocked && (
            <p className="mt-2 text-xs text-dvivid-text-muted text-center">
              Complete the required intake sections above to enable generation.
            </p>
          )}
          {generationError && (
            <div className="mt-4 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
              <p className="text-sm text-dvivid-error font-medium">We couldn't generate the document.</p>
              {generationBlockReasons.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {generationBlockReasons.map((r, i) => (
                    <li key={i} className="text-sm text-dvivid-error flex items-center justify-between gap-3">
                      <span>{humanizeBlockReason(r)}</span>
                      <Link
                        href={`/students/${studentId}/applications/${applicationId}/intake/missing`}
                        className="text-xs text-dvivid-primary hover:underline whitespace-nowrap"
                      >
                        Complete missing information →
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-dvivid-error">{generationError}</p>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {/* Generation Result */}
      {generationResult && (
        <SectionCard title={`Generation Result — Version ${generationResult.version.versionNumber}`} className="mb-8">
          <div className="flex items-center gap-6 flex-wrap mb-4">
            <div>
              <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Words</p>
              <p className="text-sm font-medium text-dvivid-text-primary mt-1">{generationResult.version.wordCount}</p>
            </div>
            {generationResult.version.factReview && (
              <div>
                <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Fact check</p>
                <p className="text-sm font-medium text-dvivid-text-primary mt-1">
                  {generationResult.version.factReview.overallPass ? "✓ Passed" : "⚠ Needs review"} — invented: {generationResult.version.factReview.totalInventedFacts || 0}, altered: {generationResult.version.factReview.totalAlteredFacts || 0}
                </p>
              </div>
            )}
          </div>
          <details className="group">
            <summary className="text-xs text-dvivid-text-muted cursor-pointer list-none flex items-center gap-1.5">
              <span className="group-open:rotate-90 transition-transform inline-block">▸</span> View details (model, cost)
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 pt-3 border-t border-dvivid-border-light">
              <div>
                <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Model</p>
                <p className="text-sm font-medium text-dvivid-text-primary mt-1">{generationResult.version.model}</p>
              </div>
              <div>
                <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Cost USD</p>
                <p className="text-sm font-medium text-dvivid-text-primary mt-1">${generationResult.version.costUsd?.toFixed(4) || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Cost INR</p>
                <p className="text-sm font-medium text-dvivid-text-primary mt-1">₹{generationResult.version.costInr?.toFixed(2) || "—"}</p>
              </div>
            </div>
          </details>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / Main: Editor */}
        <div className="lg:col-span-2 space-y-6">
          {/* Editor */}
          {versions.length > 0 && (
            <SectionCard
              title={selectedVersion ? `Editor (editing from v${selectedVersion.versionNumber})` : "Editor"}
              action={
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-dvivid-text-muted">
                    {wordCount}{document?.wordMax ? ` / ${document.wordMax}` : ""} words
                  </span>
                  {hasUnsavedChanges && (
                    <span className="px-2 py-0.5 bg-dvivid-warning-light text-dvivid-warning text-xs font-medium rounded-full">
                      Unsaved
                    </span>
                  )}
                </div>
              }
            >
              {/* Word limit warnings */}
              {document?.wordMax && wordCount > document.wordMax && (
                <div className="mb-3 p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input text-sm text-dvivid-error">
                  ⚠ {wordCount} words exceeds the maximum of {document.wordMax}. Approval will be blocked.
                </div>
              )}
              {document?.wordMin && wordCount < document.wordMin && (
                <div className="mb-3 p-3 bg-dvivid-warning-light border border-dvivid-warning/20 rounded-input text-sm text-dvivid-warning">
                  ⚠ {wordCount} words is below the minimum of {document.wordMin}.
                </div>
              )}

              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                className="w-full min-h-[400px] px-4 py-3 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary focus:outline-none focus:ring-2 focus:ring-dvivid-primary/12 focus:border-dvivid-primary transition-colors text-sm leading-relaxed resize-y"
                placeholder="Edit document content..."
              />

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                {/* Single primary CTA per state:
                    unsaved changes → Save Changes
                    saved & unapproved → Approve (below)
                    approved → Downloads (export card) */}
                {hasUnsavedChanges || saving ? (
                  <PrimaryButton onClick={handleSaveNewVersion} disabled={saving || !editorContent.trim()}>
                    {saving ? "Saving..." : "Save Changes"}
                  </PrimaryButton>
                ) : (
                  <SecondaryButton onClick={handleSaveNewVersion} disabled={saving || !editorContent.trim()}>
                    Save as New Version
                  </SecondaryButton>
                )}
                {document?.generationStatus !== "GENERATING" && (
                  <SecondaryButton onClick={handleGenerate} disabled={generating}>
                    {generating ? "Generating..." : "Regenerate"}
                  </SecondaryButton>
                )}
                {saveSuccess && <span className="text-sm text-dvivid-success font-medium">✓ Saved</span>}
                {saveError && <span className="text-sm text-dvivid-error">{saveError}</span>}
              </div>
              {generationError && (
                <div className="mt-3 p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
                  <p className="text-sm text-dvivid-error font-medium">We couldn't generate the document.</p>
                  {generationBlockReasons.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {generationBlockReasons.map((r, i) => (
                        <li key={i} className="text-sm text-dvivid-error">{humanizeBlockReason(r)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-dvivid-error">{generationError}</p>
                  )}
                </div>
              )}

              {/* Approval section */}
              <div className="mt-6 pt-6 border-t border-dvivid-border-light">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-dvivid-text-primary">
                      Approve Version {selectedVersion?.versionNumber}
                    </p>
                    <p className="text-sm text-dvivid-text-muted mt-1">
                      {isApproved && approvedVersion?.id === selectedVersion?.id
                        ? "This version is currently approved."
                        : "Mark this version as the final approved document."}
                    </p>
                  </div>
                  {(!isApproved || approvedVersion?.id !== selectedVersion?.id) && (
                    <PrimaryButton onClick={() => setShowApproveConfirm(true)} disabled={hasUnsavedChanges}>
                      Approve Document
                    </PrimaryButton>
                  )}
                  {hasUnsavedChanges && (
                    <p className="text-xs text-dvivid-text-muted mt-1">Save your changes before approving.</p>
                  )}
                </div>
                {approveError && <p className="mt-2 text-sm text-dvivid-error">{approveError}</p>}
              </div>
            </SectionCard>
          )}

          {/* Version History */}
          {versions.length > 0 && (
            <SectionCard title={`Version History (${versions.length})`}>
              <div className="space-y-3">
                {[...versions].reverse().map(v => {
                  const vWords = countWords(v.content);
                  const isThisApproved = v.id === document?.approvedVersionId;
                  const isCurrent = v.id === document?.currentVersionId;
                  return (
                    <div
                      key={v.id}
                      className={`border rounded-input p-4 transition-colors ${
                        selectedVersion?.id === v.id
                          ? "border-dvivid-primary bg-dvivid-primary-light"
                          : "border-dvivid-border-light hover:border-dvivid-primary-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 bg-dvivid-primary-light text-dvivid-primary text-xs font-medium rounded-full">
                            v{v.versionNumber}
                          </span>
                          <span className="px-2 py-0.5 bg-gray-100 text-dvivid-text-secondary text-xs font-medium rounded-full capitalize">
                            {v.createdByType.replace(/_/g, " ").toLowerCase()}
                          </span>
                          {isThisApproved && <StatusBadge status="APPROVED" />}
                          {isCurrent && !isThisApproved && <StatusBadge status="IN_REVIEW" label="Current" />}
                          {v.model && <span className="text-xs text-dvivid-text-muted">{v.model}</span>}
                          {v.costUsd != null && <span className="text-xs text-dvivid-text-muted">${v.costUsd.toFixed(4)}</span>}
                        </div>
                        <span className="text-xs text-dvivid-text-muted">
                          {new Date(v.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-dvivid-text-muted">{vWords} words</p>
                          <p className="text-sm text-dvivid-text-primary line-clamp-2 whitespace-pre-wrap mt-1">
                            {v.content.substring(0, 150)}{v.content.length > 150 ? "..." : ""}
                          </p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleSelectVersion(v)}
                            className="px-3 py-1.5 text-xs text-dvivid-primary border border-dvivid-primary/30 rounded-button hover:bg-dvivid-primary-light transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleEditFromVersion(v)}
                            className="px-3 py-1.5 text-xs text-dvivid-primary border border-dvivid-primary/30 rounded-button hover:bg-dvivid-primary-light transition-colors"
                          >
                            Edit from here
                          </button>
                          {!isThisApproved && (
                            <button
                              onClick={() => { handleSelectVersion(v); setShowApproveConfirm(true); }}
                              className="px-3 py-1.5 text-xs text-dvivid-success border border-dvivid-success/30 rounded-button hover:bg-dvivid-success-light transition-colors"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right Sidebar: Prompt & Instructions + Export */}
        <div className="space-y-6">
          {/* Prompt & Instructions */}
          <SectionCard
            title="Prompt & Instructions"
            action={
              <button
                onClick={() => setPromptExpanded(!promptExpanded)}
                className="text-dvivid-text-muted hover:text-dvivid-text-primary text-sm"
              >
                {promptExpanded ? "▼" : "▶"}
              </button>
            }
          >
            {promptExpanded && (
              <div className="space-y-4">
                <div className="bg-dvivid-surface-alt border border-dvivid-border-light rounded-input p-4">
                  <p className="text-xs text-dvivid-text-muted mb-1">Source: {promptSourceLabel}</p>
                  <p className="text-sm text-dvivid-text-primary whitespace-pre-wrap">{document?.promptText}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-dvivid-text-muted">Word Min</p>
                    <p className="text-sm font-medium text-dvivid-text-primary mt-0.5">{document?.wordMin || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-dvivid-text-muted">Word Max</p>
                    <p className="text-sm font-medium text-dvivid-text-primary mt-0.5">{document?.wordMax || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-dvivid-text-muted">Character Limit</p>
                    <p className="text-sm font-medium text-dvivid-text-primary mt-0.5">{document?.characterLimit || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-dvivid-text-muted">Page Limit</p>
                    <p className="text-sm font-medium text-dvivid-text-primary mt-0.5">{document?.pageLimit || "—"}</p>
                  </div>
                </div>
                {document?.specialInstructions && (
                  <div>
                    <p className="text-xs font-medium text-dvivid-text-muted mb-1">Special Instructions</p>
                    <p className="text-sm text-dvivid-text-primary whitespace-pre-wrap">{document.specialInstructions}</p>
                  </div>
                )}
                {document?.facultyInstructions && (
                  <div>
                    <p className="text-xs font-medium text-dvivid-text-muted mb-1">Faculty / Research Instructions</p>
                    <p className="text-sm text-dvivid-text-primary whitespace-pre-wrap">{document.facultyInstructions}</p>
                  </div>
                )}
                {document?.formattingInstructions && (
                  <div>
                    <p className="text-xs font-medium text-dvivid-text-muted mb-1">Formatting Instructions</p>
                    <p className="text-sm text-dvivid-text-primary whitespace-pre-wrap">{document.formattingInstructions}</p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* Export */}
          {versions.length > 0 && selectedVersion && (
            <SectionCard title={`Export (v${selectedVersion.versionNumber})`}>
              <div className="space-y-4">
                {isApproved && approvedVersion && (
                  <div>
                    <p className="text-sm font-medium text-dvivid-success mb-2">
                      Download Approved Document
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleExport("PDF", "FINAL", approvedVersion.id)}
                        disabled={exporting}
                        className="w-full px-5 py-2.5 bg-dvivid-success text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50"
                      >
                        {exporting ? "Preparing PDF..." : "Download PDF"}
                      </button>
                      <button
                        onClick={() => handleExport("DOCX", "FINAL", approvedVersion.id)}
                        disabled={exporting}
                        className="w-full px-5 py-2.5 bg-dvivid-success text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50"
                      >
                        {exporting ? "Preparing DOCX..." : "Download DOCX"}
                      </button>
                    </div>
                  </div>
                )}
                {!isApproved && (
                  <div>
                    <p className="text-sm text-dvivid-text-muted mb-2">
                      Draft preview (final download requires approval):
                    </p>
                    <div className="flex flex-col gap-2">
                      <SecondaryButton onClick={() => handleExport("PDF", "PREVIEW")} disabled={exporting} className="w-full">
                        {exporting ? "Preparing PDF..." : "Draft PDF"}
                      </SecondaryButton>
                      <SecondaryButton onClick={() => handleExport("DOCX", "PREVIEW")} disabled={exporting} className="w-full">
                        {exporting ? "Preparing DOCX..." : "Draft DOCX"}
                      </SecondaryButton>
                    </div>
                  </div>
                )}
                {exportError && <p className="text-sm text-dvivid-error">{exportError}</p>}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Approval Confirmation Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => !approving && setShowApproveConfirm(false)}>
          <div className="bg-white rounded-card shadow-lg p-7 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-card-title text-dvivid-text-primary mb-2">Confirm Approval</h3>
            <p className="text-sm text-dvivid-text-secondary mb-4">
              Approve Version {selectedVersion?.versionNumber} as the final document?
              {document?.wordMax && (
                <span className="block mt-2 text-sm">
                  Current: {wordCount} words · Maximum: {document.wordMax} words
                </span>
              )}
            </p>
            {approveError && <p className="mb-3 text-sm text-dvivid-error">{approveError}</p>}
            <div className="flex gap-3 justify-end">
              <SecondaryButton onClick={() => { setShowApproveConfirm(false); setApproveError(""); }} disabled={approving}>
                Cancel
              </SecondaryButton>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-5 py-2.5 bg-dvivid-success text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {approving ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page limit note */}
      {document?.pageLimit && (
        <p className="mt-6 text-sm text-dvivid-text-muted text-center">
          Page limit ({document.pageLimit} pages) is validated during final PDF export using actual rendered page count.
        </p>
      )}
    </PageContainer>
  );
}
