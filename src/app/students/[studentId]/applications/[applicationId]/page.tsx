"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  DOCUMENT_TYPE_OPTIONS,
  PROMPT_SOURCE_OPTIONS,
  DocumentType,
  PromptSource,
} from "@/lib/application/application-types";
import { getDocumentPromptUi } from "@/lib/application/document-prompt-ui";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
  SectionCard, EmptyState, StatusBadge, PromptSourceBadge,
} from "@/components/ui";
import { FormField, inputClass } from "@/components/ui/FormField";
import {
  INTAKE_SECTIONS,
  calculateIntakeCompletion,
  getProfileReadiness,
} from "@/lib/application/intake-completion";
import { CVUpload } from "@/components/ui/CVUpload";

interface Application {
  id: string;
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  department?: string;
  country: string;
  intake: string;
  intakeYear: string;
  status: string;
}

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
  generationStatus: string;
  reviewStatus?: string;
  writingRequirementId?: string;
  createdAt: string;
}

interface WritingRequirement {
  id: string;
  documentType: string;
  officialTitle: string;
  promptText: string;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  required: boolean;
}

interface RequirementLookupResult {
  result: string;
  requirementSet?: { id: string; verificationStatus: string; aiPolicyStatus: string | null };
  writingRequirements?: WritingRequirement[];
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function docStatus(d: Document): string {
  if (d.reviewStatus === "APPROVED") return "APPROVED";
  if (d.reviewStatus === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (d.reviewStatus === "IN_REVIEW") return "IN_REVIEW";
  if (d.generationStatus === "GENERATING") return "GENERATING";
  if (d.generationStatus === "GENERATED") return "GENERATED";
  if (d.generationStatus === "FAILED") return "FAILED";
  return "NOT_STARTED";
}

function docAction(d: Document): { label: string; color: string } {
  if (d.reviewStatus === "APPROVED") return { label: "Export →", color: "text-dvivid-success font-medium" };
  if (d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW") return { label: "Review →", color: "text-dvivid-primary font-medium" };
  if (d.generationStatus === "GENERATING") return { label: "Generating...", color: "text-dvivid-warning" };
  if (d.generationStatus === "FAILED") return { label: "Retry →", color: "text-dvivid-error font-medium" };
  if (d.generationStatus === "GENERATED") return { label: "Review →", color: "text-dvivid-primary font-medium" };
  return { label: "Generate →", color: "text-dvivid-primary font-medium" };
}

function hasNeedsReview(documents: Document[]): boolean {
  return documents.some(d => d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW");
}

function hasGenerating(documents: Document[]): boolean {
  return documents.some(d => d.generationStatus === "GENERATING");
}

function hasFailed(documents: Document[]): boolean {
  return documents.some(d => d.generationStatus === "FAILED");
}

function getPrimaryDoc(documents: Document[]): Document | null {
  if (documents.length === 0) return null;
  const ranked = [...documents].sort((a, b) => {
    const rankA = a.reviewStatus === "APPROVED" ? 4 : a.generationStatus === "GENERATED" ? 3 : a.generationStatus === "GENERATING" || a.generationStatus === "FAILED" ? 2 : 1;
    const rankB = b.reviewStatus === "APPROVED" ? 4 : b.generationStatus === "GENERATED" ? 3 : b.generationStatus === "GENERATING" || b.generationStatus === "FAILED" ? 2 : 1;
    return rankB - rankA;
  });
  return ranked[0];
}

export default function ApplicationWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;

  const [application, setApplication] = useState<Application | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [reqLookup, setReqLookup] = useState<RequirementLookupResult | null>(null);
  const [selectedWritingReqId, setSelectedWritingReqId] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<DocumentType>("STATEMENT_OF_PURPOSE");
  const promptUi = getDocumentPromptUi(documentType);
  const [documentTitle, setDocumentTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptSource, setPromptSource] = useState<PromptSource>("CONSULTANT_PROVIDED");
  const [wordMin, setWordMin] = useState("");
  const [wordMax, setWordMax] = useState("");
  const [characterLimit, setCharacterLimit] = useState("");
  const [pageLimit, setPageLimit] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [mandatoryTopics, setMandatoryTopics] = useState("");
  const [additionalQuestions, setAdditionalQuestions] = useState("");
  const [formattingInstructions, setFormattingInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionPath, setResolutionPath] = useState<string | null>(null);
  const [resolutionLabel, setResolutionLabel] = useState<string | null>(null);
  const [showCVUpload, setShowCVUpload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [docToDelete, setDocToDelete] = useState<Document | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const loadTokenRef = useRef(0);

  useEffect(() => {
    loadTokenRef.current++;
    setApplication(null);
    setStudent(null);
    setProfile(null);
    setDocuments([]);
    setReqLookup(null);
    setError("");
    setShowAddForm(false);
    loadApplication();
  }, [applicationId, studentId]);

  async function loadApplication() {
    const token = ++loadTokenRef.current;
    const stale = () => token !== loadTokenRef.current;
    setLoading(true);
    setError("");
    try {
      const [res, studentRes, profileRes] = await Promise.all([
        fetch(`/api/application/list?applicationId=${applicationId}&studentId=${studentId}`, { cache: "no-store" }),
        fetch(`/api/application/student?id=${studentId}`, { cache: "no-store" }),
        fetch(`/api/application/profile?studentId=${studentId}&applicationId=${applicationId}`, { cache: "no-store" }),
      ]);
      if (stale()) return;

      if (!res.ok) {
        const data = await res.json();
        if (stale()) return;
        setError(data.error || "Application not found");
        return;
      }
      const data = await res.json();
      if (stale()) return;
      setApplication(data.application);
      setDocuments(data.documents || []);

      if (studentRes.ok) {
        const studentData = await studentRes.json();
        if (stale()) return;
        setStudent(studentData.student);
      }

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        if (stale()) return;
        setProfile(profileData.profile);
      }

      if (data.application) {
        try {
          const app = data.application;
          if (app.universityName && app.programName && app.degree && app.intake && app.intakeYear) {
            const reqRes = await fetch(
              `/api/requirements/lookup?university=${encodeURIComponent(app.universityName)}&program=${encodeURIComponent(app.programName)}&degree=${encodeURIComponent(app.degree)}&intake=${encodeURIComponent(app.intake)}&intakeYear=${encodeURIComponent(app.intakeYear)}`,
            );
            if (reqRes.ok) {
              const reqData = await reqRes.json();
              if (!stale()) setReqLookup(reqData);
            }
          }
        } catch {
          // Requirements lookup is optional
        }
      }
    } catch {
      if (!stale()) setError("Failed to load application");
    } finally {
      if (!stale()) setLoading(false);
    }
  }

  async function handleAddDocument() {
    if (!promptText && promptUi.required) {
      setError(`A prompt is required for this document type — enter text under "${promptUi.label}"${promptUi.primaryLookupLabel ? ` or use '${promptUi.primaryLookupLabel}'` : ""}.`);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/application/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          documentType,
          documentTitle: documentTitle || DOCUMENT_TYPE_OPTIONS.find(d => d.value === documentType)?.label || documentType,
          promptText,
          promptSource,
          wordMin: wordMin ? parseInt(wordMin) : undefined,
          wordMax: wordMax ? parseInt(wordMax) : undefined,
          characterLimit: characterLimit ? parseInt(characterLimit) : undefined,
          pageLimit: pageLimit ? parseInt(pageLimit) : undefined,
          specialInstructions,
          formattingInstructions,
          mandatoryTopics,
          additionalQuestions,
          writingRequirementId: selectedWritingReqId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add document");
      }

      const docData = await res.json();
      const newDocId = docData.document?.id;

      setShowAddForm(false);
      setDocumentType("STATEMENT_OF_PURPOSE");
      setDocumentTitle("");
      setPromptText("");
      setPromptSource("CONSULTANT_PROVIDED");
      setWordMin("");
      setWordMax("");
      setCharacterLimit("");
      setPageLimit("");
      setSpecialInstructions("");
      setMandatoryTopics("");
      setAdditionalQuestions("");
      setFormattingInstructions("");
      setSelectedWritingReqId(null);
      setResolutionPath(null);
      setResolutionLabel(null);

      if (newDocId) {
        router.push(`/students/${studentId}/applications/${applicationId}/documents/${newDocId}`);
      } else {
        await loadApplication();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to add document");
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoResolve() {
    if (!application) return;
    setResolving(true);
    setError("");
    setResolutionPath(null);
    setResolutionLabel(null);

    try {
      const res = await fetch("/api/requirements/resolve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          university: application.universityName,
          program: application.programName,
          degree: application.degree,
          intake: application.intake,
          intakeYear: application.intakeYear,
          country: application.country,
          documentType,
          attemptDiscovery: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to resolve prompt");
      }

      const data = await res.json();
      const resolved = data.resolved;

      setPromptText(resolved.promptText);
      setPromptSource(resolved.source);
      setDocumentTitle(resolved.documentTitle || "");
      setWordMin(resolved.wordMin?.toString() || "");
      setWordMax(resolved.wordMax?.toString() || "");
      setCharacterLimit(resolved.characterLimit?.toString() || "");
      setPageLimit(resolved.pageLimit?.toString() || "");
      setSpecialInstructions(resolved.specialInstructions || "");

      if (resolved.writingRequirementId) {
        setSelectedWritingReqId(resolved.writingRequirementId);
      }

      const pathLabels: Record<string, string> = {
        MANUAL: "Manual Prompt",
        DB_REUSED: "Reused from D-Vivid Requirements DB",
        DISCOVERY_SAVED: "Discovered & Saved from Official Source",
        DEFAULT_TEMPLATE: "D-Vivid Default Template",
      };
      setResolutionPath(resolved.resolutionPath);
      setResolutionLabel(pathLabels[resolved.resolutionPath] || resolved.resolutionPath);
    } catch (err: any) {
      setError(err?.message || "Failed to resolve prompt");
    } finally {
      setResolving(false);
    }
  }

  async function handleTriggerDiscovery() {
    if (!application) return;
    setResolving(true);
    setError("");
    setResolutionPath(null);
    setResolutionLabel(null);

    try {
      const res = await fetch("/api/requirements/resolve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          university: application.universityName,
          program: application.programName,
          degree: application.degree,
          intake: application.intake,
          intakeYear: application.intakeYear,
          country: application.country,
          documentType,
          attemptDiscovery: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to resolve prompt");
      }

      const data = await res.json();
      const resolved = data.resolved;

      setPromptText(resolved.promptText);
      setPromptSource(resolved.source);
      setDocumentTitle(resolved.documentTitle || "");
      setWordMin(resolved.wordMin?.toString() || "");
      setWordMax(resolved.wordMax?.toString() || "");
      setCharacterLimit(resolved.characterLimit?.toString() || "");
      setPageLimit(resolved.pageLimit?.toString() || "");
      setSpecialInstructions(resolved.specialInstructions || "");

      if (resolved.writingRequirementId) {
        setSelectedWritingReqId(resolved.writingRequirementId);
      }

      const pathLabels: Record<string, string> = {
        MANUAL: "Manual Prompt",
        DB_REUSED: "Reused from D-Vivid Requirements DB",
        DISCOVERY_SAVED: "Discovered & Saved from Official Source",
        DEFAULT_TEMPLATE: "D-Vivid Default Template (no official info found)",
      };
      setResolutionPath(resolved.resolutionPath);
      setResolutionLabel(pathLabels[resolved.resolutionPath] || resolved.resolutionPath);

      await loadApplication();
    } catch (err: any) {
      setError(err?.message || "Failed to resolve prompt");
    } finally {
      setResolving(false);
    }
  }

  async function handleDeleteDocument() {
    if (!docToDelete) return;
    setDeletingDoc(true);
    setError("");
    try {
      const res = await fetch("/api/application/document/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: docToDelete.id,
          applicationId,
          studentId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete document.");
      }
      setDocToDelete(null);
      await loadApplication();
    } catch (err: any) {
      setError(err?.message || "Failed to delete document.");
    } finally {
      setDeletingDoc(false);
    }
  }

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading application...</div></PageContainer>;
  }

  if (error && !application) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error}</p>
          <Link href={`/students/${studentId}`} className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">← Back to student</Link>
        </div>
      </PageContainer>
    );
  }

  // Compute intake readiness
  const readiness = profile !== null && application ? getProfileReadiness(profile, application) : null;
  const firstMissingSlug = readiness?.sections.find(s => s.status === "missing")?.slug;
  const intakeComplete = readiness?.canGenerate ?? false;

  const primaryDoc = getPrimaryDoc(documents);
  const docWorkspaceHref = primaryDoc ? `/students/${studentId}/applications/${applicationId}/documents/${primaryDoc.id}` : null;

  const intakeHref = firstMissingSlug
    ? `/students/${studentId}/applications/${applicationId}/intake/missing`
    : `/students/${studentId}/applications/${applicationId}/intake/student-details`;

  // State-aware primary CTA priority
  let primaryCta: { label: string; href: string; onClick?: () => void } | null = null;
  if (!intakeComplete) {
    const missingSections = readiness?.sections.filter(s => !s.optional && s.status !== "missing") || [];
    const missingCount = missingSections.length;
    primaryCta = { label: `Complete ${missingCount} Missing Answer${missingCount !== 1 ? "s" : ""} →`, href: intakeHref };
  } else if (documents.length === 0) {
    primaryCta = { label: "+ Add Document →", href: "", onClick: () => setShowAddForm(true) };
  } else if (hasNeedsReview(documents)) {
    const needsReviewDoc = documents.find(d => d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW");
    primaryCta = { label: "Review Document →", href: needsReviewDoc ? `/students/${studentId}/applications/${applicationId}/documents/${needsReviewDoc.id}` : docWorkspaceHref! };
  } else if (hasGenerating(documents)) {
    const genDoc = documents.find(d => d.generationStatus === "GENERATING");
    primaryCta = { label: "View Generation →", href: genDoc ? `/students/${studentId}/applications/${applicationId}/documents/${genDoc.id}` : docWorkspaceHref! };
  } else if (hasFailed(documents)) {
    const failedDoc = documents.find(d => d.generationStatus === "FAILED");
    primaryCta = { label: "Review / Retry →", href: failedDoc ? `/students/${studentId}/applications/${applicationId}/documents/${failedDoc.id}` : docWorkspaceHref! };
  } else {
    primaryCta = { label: "+ Add Document →", href: "", onClick: () => setShowAddForm(true) };
  }

  // Compute metrics
  const generatedCount = documents.filter(d => ["GENERATED", "APPROVED", "NEEDS_REVIEW", "IN_REVIEW"].includes(docStatus(d))).length;
  const approvedCount = documents.filter(d => docStatus(d) === "APPROVED").length;
  const needsReviewCount = documents.filter(d => d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW").length;

  return (
    <PageContainer>
      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: student ? `${student.firstName} ${student.lastName}` : "Student", href: `/students/${studentId}` },
        { label: application ? application.universityName : "Application" },
      ]} />

      {/* Application Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="min-w-0">
            <p className="text-xs text-dvivid-text-muted uppercase tracking-wide">Application Workspace</p>
            <h1 className="text-page-title text-dvivid-text-primary mt-1 truncate">
              {student ? `${student.firstName} ${student.lastName}` : "Applicant"}
            </h1>
            <p className="text-base text-dvivid-text-secondary mt-1.5 truncate">
              {application?.universityName} · {application?.programName} · {application?.degree}
              {application?.intake ? ` · ${application.intake} ${application.intakeYear}` : ""}
            </p>
            {application?.country && (
              <p className="text-sm text-dvivid-text-secondary mt-0.5">{application.country}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={application?.status || "DRAFT"} />
            {!confirmDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-dvivid-error/70 hover:text-dvivid-error hover:underline"
              >
                Delete application
              </button>
            )}
          </div>
        </div>

        {/* Delete application confirmation */}
        {confirmDelete && (
          <div className="mt-4 p-4 bg-dvivid-error-light border border-dvivid-error/30 rounded-input">
            <p className="text-sm font-semibold text-dvivid-error mb-1">Delete application?</p>
            <p className="text-sm text-dvivid-text-secondary mb-3">
              This will permanently delete this application and its associated documents
              and generation history. The student's reusable profile will NOT be deleted.
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await fetch("/api/application/delete", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ applicationId, studentId }),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      setError(data.error || "Failed to delete application.");
                      setConfirmDelete(false);
                      return;
                    }
                    router.push(`/students/${studentId}`);
                  } catch {
                    setError("Failed to delete application.");
                    setConfirmDelete(false);
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-input bg-dvivid-error text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, delete this application"}
              </button>
              <SecondaryButton onClick={() => setConfirmDelete(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        )}

        {/* Compact Metrics Strip */}
        <div className="mt-4 bg-white border border-dvivid-border rounded-card divide-x divide-dvivid-border-light grid grid-cols-4">
          <div className="px-4 py-3 border-r border-dvivid-border-light last:border-0">
            <p className="text-xl font-semibold text-dvivid-text-primary tabular-nums">{documents.length}</p>
            <p className="text-xs text-dvivid-text-muted mt-0.5">Documents</p>
          </div>
          <div className="px-4 py-3 border-r border-dvivid-border-light last:border-0">
            <p className="text-xl font-semibold text-dvivid-text-primary tabular-nums">{generatedCount}</p>
            <p className="text-xs text-dvivid-text-muted mt-0.5">Generated</p>
          </div>
          <div className="px-4 py-3 border-r border-dvivid-border-light last:border-0">
            <p className="text-xl font-semibold text-dvivid-text-primary tabular-nums">{approvedCount}</p>
            <p className="text-xs text-dvivid-text-muted mt-0.5">Approved</p>
          </div>
          <div className="px-4 py-3">
            <p className={`text-xl font-semibold tabular-nums ${needsReviewCount > 0 ? "text-dvivid-warning" : "text-dvivid-text-primary"}`}>{needsReviewCount}</p>
            <p className="text-xs text-dvivid-text-muted mt-0.5">Needs Review</p>
          </div>
        </div>
      </div>

      {/* Readiness / Missing Information */}
      {readiness && !intakeComplete && (
        <div className="mb-6 p-4 bg-dvivid-warning-light border border-dvivid-warning/30 rounded-card">
          <p className="text-xs font-medium text-dvivid-text-muted uppercase tracking-wide mb-2">Application Information</p>
          <div>
            {(() => {
              const missingSections = readiness.sections.filter(s => !s.optional && s.status !== "complete");
              const missingCount = missingSections.length;
              return (
                <div>
                  <p className="text-sm font-medium text-dvivid-text-primary mb-2">
                    {missingCount} section{missingCount !== 1 ? "s" : ""} need attention
                  </p>
                  <ul className="mb-3 space-y-1">
                    {missingSections.map(s => (
                      <li key={s.slug} className="text-sm text-dvivid-text-secondary">
                        · {s.label}
                        {s.missingFields?.length > 0 && (
                          <span className="text-dvivid-warning"> — {s.missingFields.join(", ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Link href={`/students/${studentId}/applications/${applicationId}/intake/missing`} prefetch={false}>
                    <PrimaryButton>Complete {missingCount} Missing Answer{missingCount !== 1 ? "s" : ""} →</PrimaryButton>
                  </Link>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* State-Aware Primary CTA — suppress when readiness panel already has CTA */}
      {primaryCta && !(readiness && !intakeComplete) && (
        <div className="mb-6">
          {primaryCta.onClick ? (
            <PrimaryButton onClick={primaryCta.onClick}>{primaryCta.label}</PrimaryButton>
          ) : (
            <Link href={primaryCta.href}>
              <PrimaryButton>{primaryCta.label}</PrimaryButton>
            </Link>
          )}
        </div>
      )}

      {/* Documents Section (Primary Focus) */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-section-title text-dvivid-text-primary">Documents</h2>
        {!showAddForm && (
          <SecondaryButton onClick={() => setShowAddForm(true)}>+ Add Document</SecondaryButton>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="No Documents Yet"
          description="Add an SOP, essay, personal statement or other writing task."
          action={
            <PrimaryButton onClick={() => setShowAddForm(true)}>Add First Document</PrimaryButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const docHref = `/students/${studentId}/applications/${applicationId}/documents/${doc.id}`;
            const action = docAction(doc);
            const wordRange = doc.wordMax ? `${doc.wordMin || 0}–${doc.wordMax} words` : "";
            const pageInfo = doc.pageLimit ? `${doc.pageLimit} page(s)` : "";
            return (
              <div
                key={doc.id}
                className="bg-white border border-dvivid-border rounded-card p-5 hover:bg-dvivid-surface-alt/50 transition-colors"
              >
                <Link href={`/students/${studentId}/applications/${applicationId}/documents/${doc.id}`} className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-card-title text-dvivid-text-primary truncate">{doc.documentTitle}</h3>
                      <p className="text-sm text-dvivid-text-secondary mt-1 line-clamp-2">{doc.promptText.substring(0, 140)}{doc.promptText.length > 140 ? "..." : ""}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <PromptSourceBadge source={doc.promptSource} />
                        <span className="px-2 py-1 bg-dvivid-surface-alt text-dvivid-text-secondary text-xs font-medium rounded-full">
                          {doc.documentType.replace(/_/g, " ").toLowerCase()}
                        </span>
                        {doc.wordMax && (
                          <span className="px-2 py-1 bg-dvivid-surface-alt text-dvivid-text-muted text-xs font-medium rounded-full">
                            {doc.wordMin || 0}–{doc.wordMax} words
                          </span>
                        )}
                        {doc.pageLimit && (
                          <span className="px-2 py-1 bg-dvivid-surface-alt text-dvivid-text-muted text-xs font-medium rounded-full">
                            {doc.pageLimit} page(s)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0 sm:flex-row sm:items-center sm:gap-3">
                      <StatusBadge status={docStatus(doc)} />
                      <span className={`text-sm font-medium ${action.color}`}>{action.label}</span>
                    </div>
</div>
            </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Application Info */}
      <details className="mt-8 group">
        <summary className="text-sm font-medium text-dvivid-text-secondary cursor-pointer list-none flex items-center gap-2">
          <span className="text-dvivid-text-muted group-open:rotate-90 transition-transform inline-block">▸</span>
          Application Info
        </summary>
        <div className="mt-4 pt-4 border-t border-dvivid-border-light grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-dvivid-text-muted">University</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.universityName}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Program</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.programName}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Degree</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.degree}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Department</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.department || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Country</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.country || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Intake</p>
            <p className="text-sm text-dvivid-text-primary font-medium">{application?.intake || "—"} {application?.intakeYear || ""}</p>
          </div>
          <div>
            <p className="text-xs text-dvivid-text-muted">Status</p>
            <p className="text-sm text-dvivid-text-primary font-medium"><StatusBadge status={application?.status || "DRAFT"} /></p>
          </div>
        </div>
      </details>

      {/* Requirements (collapsed) */}
      {reqLookup && (
        <details className="mt-6 group">
          <summary className="text-sm font-medium text-dvivid-text-secondary cursor-pointer list-none flex items-center justify-between">
            <span>Requirements status
              <span className="ml-2 text-xs text-dvivid-text-muted font-normal">
                {reqLookup.result === "EXACT_FRESH_MATCH" ? "verified" : reqLookup.result.replace(/_/g, " ").toLowerCase()}
              </span>
            </span>
            <span className="text-dvivid-text-muted group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="mt-3 pt-3 border-t border-dvivid-border-light">
            {reqLookup.result === "EXACT_FRESH_MATCH" && (
              <p className="text-sm text-dvivid-success">✓ Requirements available — {reqLookup.writingRequirements?.length || 0} writing requirements verified</p>
            )}
            {reqLookup.result === "STALE_MATCH" && (
              <p className="text-sm text-dvivid-warning">⚠ Requirements need verification — last checked is stale</p>
            )}
            {reqLookup.result === "PARTIAL_MATCH" && (
              <p className="text-sm text-dvivid-warning">⚠ Partial match found — some requirements may not apply</p>
            )}
            {reqLookup.result === "NOT_FOUND" && (
              <p className="text-sm text-dvivid-text-secondary">No saved requirements for this program/intake — the D-Vivid template will be used.</p>
            )}
          </div>
        </details>
      )}

      {/* Add Document Form */}
      {showAddForm && (
        <SectionCard title="Add Document" description="Create a new writing task for this application." className="mt-8">
          {/* Available writing requirements */}
          {reqLookup?.writingRequirements && reqLookup.writingRequirements.length > 0 && (
            <div className="mb-6 pb-6 border-b border-dvivid-border-light">
              <p className="text-sm font-medium text-dvivid-text-secondary mb-3">Available Official Requirements</p>
              <div className="space-y-2">
                {reqLookup.writingRequirements.map((wr) => (
                  <label
                    key={wr.id}
                    className={`flex items-start gap-3 p-4 border rounded-input cursor-pointer transition-colors ${
                      selectedWritingReqId === wr.id
                        ? "border-dvivid-primary bg-dvivid-primary-light"
                        : "border-dvivid-border hover:border-dvivid-primary-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="writingReq"
                      checked={selectedWritingReqId === wr.id}
                      onChange={() => {
                        setSelectedWritingReqId(wr.id);
                        setDocumentType(wr.documentType as DocumentType);
                        setDocumentTitle(wr.officialTitle);
                        setPromptText(wr.promptText);
                        setPromptSource("OFFICIAL_VERIFIED");
                        setWordMin(wr.wordMin?.toString() || "");
                        setWordMax(wr.wordMax?.toString() || "");
                        setCharacterLimit(wr.characterLimit?.toString() || "");
                        setPageLimit(wr.pageLimit?.toString() || "");
                        setSpecialInstructions(wr.specialInstructions || "");
                      }}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-dvivid-text-primary">{wr.officialTitle}</p>
                      <p className="text-sm text-dvivid-text-secondary mt-0.5">
                        {wr.documentType.replace(/_/g, " ").toLowerCase()}
                        {wr.wordMax ? ` · ${wr.wordMin || 0}–${wr.wordMax} words` : ""}
                        {wr.required ? " · required" : ""}
                      </p>
                    </div>
                  </label>
                ))}
                <label
                  className={`flex items-start gap-3 p-4 border rounded-input cursor-pointer transition-colors ${
                    selectedWritingReqId === null
                      ? "border-dvivid-primary bg-dvivid-primary-light"
                      : "border-dvivid-border hover:border-dvivid-primary-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="writingReq"
                    checked={selectedWritingReqId === null}
                    onChange={() => {
                      setSelectedWritingReqId(null);
                      setDocumentType("STATEMENT_OF_PURPOSE");
                      setDocumentTitle("");
                      setPromptText("");
                      setPromptSource("CONSULTANT_PROVIDED");
                      setWordMin("");
                      setWordMax("");
                      setCharacterLimit("");
                      setPageLimit("");
                      setSpecialInstructions("");
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-dvivid-text-primary">+ Add document manually</p>
                    <p className="text-sm text-dvivid-text-secondary mt-0.5">Enter your own prompt and instructions</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="mb-5">
            <FormField label="Document Type" required>
              <select className={inputClass} value={documentType} onChange={e => setDocumentType(e.target.value as DocumentType)}>
                {DOCUMENT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-dvivid-text-primary">
                {promptUi.label} {promptUi.required && <span className="text-dvivid-error">*</span>}
              </label>
              {(promptUi.primaryLookupLabel || promptUi.secondaryLookupLabel) && (
                <div className="flex gap-2">
                  {promptUi.primaryLookupLabel && (
                    <button
                      type="button"
                      onClick={handleAutoResolve}
                      disabled={resolving}
                      className="px-3 py-1.5 text-xs font-medium text-dvivid-primary border border-dvivid-primary/30 rounded-button hover:bg-dvivid-primary-light transition-colors disabled:opacity-50"
                    >
                      {resolving ? "Finding requirements..." : promptUi.primaryLookupLabel}
                    </button>
                  )}
                  {promptUi.secondaryLookupLabel && (
                    <button
                      type="button"
                      onClick={handleTriggerDiscovery}
                      disabled={resolving}
                      className="px-3 py-1.5 text-xs font-medium text-dvivid-text-secondary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt transition-colors disabled:opacity-50"
                    >
                      {resolving ? "Searching..." : promptUi.secondaryLookupLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
            <textarea
              className={`${inputClass} min-h-[120px] resize-y`}
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              placeholder={promptUi.placeholder}
            />
            {resolutionLabel && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-dvivid-text-muted">Prompt found via:</span>
                <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                  resolutionPath === "DB_REUSED" ? "bg-dvivid-success-light text-dvivid-success" :
                  resolutionPath === "DISCOVERY_SAVED" ? "bg-dvivid-primary-light text-dvivid-primary" :
                  resolutionPath === "DEFAULT_TEMPLATE" ? "bg-dvivid-warning-light text-dvivid-warning" :
                  "bg-gray-100 text-dvivid-text-secondary"
                }`}>
                  {resolutionLabel}
                </span>
              </div>
            )}
          </div>

          <FormField label="Consultant Instruction (optional)" helper="Your own guidance for the writing — kept separate from the university prompt." className="mb-5">
            <textarea className={`${inputClass} min-h-[80px] resize-y`} value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} placeholder="e.g. Emphasize the student's research internship over coursework..." />
          </FormField>

          <details className="mb-6 group">
            <summary className="text-sm font-medium text-dvivid-text-secondary cursor-pointer list-none flex items-center gap-2">
              <span className="text-dvivid-text-muted group-open:rotate-90 transition-transform inline-block">▸</span>
              Advanced options (title, prompt source, length limits, topics, questions, formatting)
            </summary>
            <div className="pt-4 mt-3 border-t border-dvivid-border-light space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField label="Document Title">
                  <input className={inputClass} value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} placeholder="Statement of Objectives" />
                </FormField>
                <FormField label="Prompt Source">
                  <select className={inputClass} value={promptSource} onChange={e => setPromptSource(e.target.value as PromptSource)}>
                    {PROMPT_SOURCE_OPTIONS.filter(o => o.value !== "OFFICIAL_VERIFIED" && o.value !== "DVIVID_DEFAULT_TEMPLATE").map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {([
                  ["Word Min", "wordMin", wordMin, setWordMin],
                  ["Word Max", "wordMax", wordMax, setWordMax],
                  ["Character Limit", "characterLimit", characterLimit, setCharacterLimit],
                  ["Page Limit", "pageLimit", pageLimit, setPageLimit],
                ] as const).map(([label, key, val, setter]) => {
                  return (
                    <FormField key={key} label={label}>
                      <input className={inputClass} type="number" value={val} onChange={e => setter(e.target.value)} placeholder="—" />
                    </FormField>
                  );
                })}
              </div>
              <FormField label="Mandatory Topics (one per line)">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={mandatoryTopics}
                  onChange={e => setMandatoryTopics(e.target.value)}
                  placeholder={"Research methodology\nData ethics\nLeadership experience"}
                />
              </FormField>
              <FormField label="Additional / Specific Questions (one per line)">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={additionalQuestions}
                  onChange={e => setAdditionalQuestions(e.target.value)}
                  placeholder={"Describe a challenge you overcame.\nWhy this specific program?"}
                />
              </FormField>
              <FormField label="Formatting Rules">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={formattingInstructions}
                  onChange={e => setFormattingInstructions(e.target.value)}
                  placeholder="12pt font, 1.5 line spacing, margins 1 inch"
                />
              </FormField>
            </div>
          </details>

          <div className="flex gap-3 justify-end">
            <SecondaryButton onClick={() => setShowAddForm(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleAddDocument} disabled={saving}>
              {saving ? "Saving..." : "Create Document"}
            </PrimaryButton>
          </div>
        </SectionCard>
      )}
      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}
    </PageContainer>
  );
}