"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PROMPT_SOURCE_LABELS } from "@/lib/application/application-types";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
  SectionCard, StatusBadge, PromptSourceBadge,
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

const generationStageLabels = [
  "Preparing your document",
  "Drafting",
  "Reviewing quality",
  "Adjusting language",
  "Finalizing",
  "Verifying facts",
];

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
  const [generationStage, setGenerationStage] = useState(0);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [generationError, setGenerationError] = useState("");

  const [editorContent, setEditorContent] = useState("");
  const [editorBaseVersionId, setEditorBaseVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

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

  async function handleGenerate() {
    setGenerating(true);
    setGenerationError("");
    setGenerationResult(null);
    setGenerationStage(0);

    const stageInterval = setInterval(() => {
      setGenerationStage(s => Math.min(s + 1, generationStageLabels.length - 1));
    }, 5000);

    try {
      const res = await fetch("/api/application/document/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId }),
      });
      const data = await res.json();
      clearInterval(stageInterval);
      setGenerationStage(generationStageLabels.length - 1);
      if (!res.ok) {
        setGenerationError(data.message || data.error || "Generation failed");
        return;
      }
      setGenerationResult(data);
      await loadDocument();
    } catch (err: any) {
      clearInterval(stageInterval);
      setGenerationError(err?.message || "Generation failed");
    } finally {
      setGenerating(false);
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

  async function handleExport(format: "PDF" | "DOCX", mode: "PREVIEW" | "FINAL") {
    if (!selectedVersion) return;
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
          versionId: selectedVersion.id,
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
            <PromptSourceBadge source={document?.promptSource || ""} />
            <StatusBadge status={document?.generationStatus || "NOT_GENERATED"} />
            <StatusBadge status={document?.reviewStatus || "DRAFT"} />
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

      {/* Generation Progress */}
      {generating && (
        <SectionCard className="mb-8">
          <div className="bg-dvivid-primary-light border border-dvivid-primary-border rounded-input p-5">
            <p className="text-sm font-medium text-dvivid-primary mb-3">Generating your document...</p>
            <div className="space-y-2">
              {generationStageLabels.map((label, i) => (
                <div key={i} className={`flex items-center gap-2.5 text-sm ${i <= generationStage ? "text-dvivid-text-primary" : "text-dvivid-text-muted"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    i < generationStage ? "bg-dvivid-primary text-white" :
                    i === generationStage ? "border-2 border-dvivid-primary text-dvivid-primary" :
                    "border-2 border-dvivid-border"
                  }`}>
                    {i < generationStage ? "✓" : i === generationStage ? "●" : ""}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Generation Section (only if no versions yet) */}
      {versions.length === 0 && !generating && (
        <SectionCard title="Generate Document" description="Generate a first draft using the AI pipeline." className="mb-8">
          <PrimaryButton onClick={handleGenerate} disabled={!canGenerate} className="w-full">
            Generate Document
          </PrimaryButton>
          {generationError && (
            <div className="mt-4 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
              <p className="text-sm text-dvivid-error">{generationError}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* Generation Result */}
      {generationResult && (
        <SectionCard title={`Generation Result — Version ${generationResult.version.versionNumber}`} className="mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Words</p>
              <p className="text-sm font-medium text-dvivid-text-primary mt-1">{generationResult.version.wordCount}</p>
            </div>
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
          {generationResult.version.factReview && (
            <div className="pt-4 border-t border-dvivid-border-light">
              <p className="text-xs text-dvivid-text-muted uppercase tracking-wide mb-1">Fact Review</p>
              <p className="text-sm text-dvivid-text-primary">
                Invented: {generationResult.version.factReview.totalInventedFacts || 0} · Altered: {generationResult.version.factReview.totalAlteredFacts || 0} · Pass: {generationResult.version.factReview.overallPass ? "YES" : "NO"}
              </p>
            </div>
          )}
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
                <PrimaryButton onClick={handleSaveNewVersion} disabled={saving || !editorContent.trim()}>
                  {saving ? "Saving..." : "Save New Version"}
                </PrimaryButton>
                {saveSuccess && <span className="text-sm text-dvivid-success font-medium">✓ Version saved</span>}
                {saveError && <span className="text-sm text-dvivid-error">{saveError}</span>}
              </div>

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
                    <PrimaryButton onClick={() => setShowApproveConfirm(true)}>
                      Approve This Version
                    </PrimaryButton>
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
                <div>
                  <p className="text-sm font-medium text-dvivid-text-secondary mb-2">Draft Preview</p>
                  <div className="flex flex-col gap-2">
                    <SecondaryButton onClick={() => handleExport("PDF", "PREVIEW")} disabled={exporting} className="w-full">
                      Download Draft PDF
                    </SecondaryButton>
                    <SecondaryButton onClick={() => handleExport("DOCX", "PREVIEW")} disabled={exporting} className="w-full">
                      Download Draft DOCX
                    </SecondaryButton>
                  </div>
                </div>

                {isApproved && approvedVersion && (
                  <div className="pt-4 border-t border-dvivid-border-light">
                    <p className="text-sm font-medium text-dvivid-success mb-2">
                      Final Export (Approved v{approvedVersion.versionNumber})
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => { setSelectedVersion(approvedVersion); handleExport("PDF", "FINAL"); }}
                        disabled={exporting}
                        className="w-full px-5 py-2.5 bg-dvivid-success text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50"
                      >
                        Download Final PDF
                      </button>
                      <button
                        onClick={() => { setSelectedVersion(approvedVersion); handleExport("DOCX", "FINAL"); }}
                        disabled={exporting}
                        className="w-full px-5 py-2.5 bg-dvivid-success text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50"
                      >
                        Download Final DOCX
                      </button>
                    </div>
                  </div>
                )}
                {!isApproved && (
                  <div className="pt-4 border-t border-dvivid-border-light">
                    <p className="text-sm text-dvivid-text-muted">
                      Final export requires an approved version.
                    </p>
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
