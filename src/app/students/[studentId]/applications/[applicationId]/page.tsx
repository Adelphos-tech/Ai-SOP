"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  DOCUMENT_TYPE_OPTIONS,
  PROMPT_SOURCE_OPTIONS,
  DocumentType,
  PromptSource,
} from "@/lib/application/application-types";
import {
  PageContainer, Breadcrumb, PageHeader, PrimaryButton, SecondaryButton,
  SectionCard, EmptyState, StatusBadge, PromptSourceBadge,
} from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { FormField, inputClass } from "@/components/ui/FormField";

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

export default function ApplicationWorkspacePage() {
  const params = useParams();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;

  const [application, setApplication] = useState<Application | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [reqLookup, setReqLookup] = useState<RequirementLookupResult | null>(null);
  const [selectedWritingReqId, setSelectedWritingReqId] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<DocumentType>("STATEMENT_OF_PURPOSE");
  const [documentTitle, setDocumentTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptSource, setPromptSource] = useState<PromptSource>("CONSULTANT_PROVIDED");
  const [wordMin, setWordMin] = useState("");
  const [wordMax, setWordMax] = useState("");
  const [characterLimit, setCharacterLimit] = useState("");
  const [pageLimit, setPageLimit] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionPath, setResolutionPath] = useState<string | null>(null);
  const [resolutionLabel, setResolutionLabel] = useState<string | null>(null);

  useEffect(() => {
    loadApplication();
  }, [applicationId]);

  async function loadApplication() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/application/list?applicationId=${applicationId}&studentId=${studentId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Application not found");
        return;
      }
      const data = await res.json();
      setApplication(data.application);
      setDocuments(data.documents || []);

      if (data.application) {
        try {
          const reqRes = await fetch(
            `/api/requirements/lookup?university=${encodeURIComponent(data.application.universityName)}&program=${encodeURIComponent(data.application.programName)}&degree=${encodeURIComponent(data.application.degree)}&intake=${encodeURIComponent(data.application.intake)}&intakeYear=${encodeURIComponent(data.application.intakeYear)}`,
          );
          if (reqRes.ok) {
            const reqData = await reqRes.json();
            setReqLookup(reqData);
          }
        } catch {
          // Requirements lookup is optional
        }
      }
    } catch {
      setError("Failed to load application");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddDocument() {
    if (!promptText) {
      setError("Prompt / Instructions is required. Click 'Auto-Resolve' to find a prompt automatically.");
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
          writingRequirementId: selectedWritingReqId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add document");
      }

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
      setSelectedWritingReqId(null);
      setResolutionPath(null);
      setResolutionLabel(null);
      await loadApplication();
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

  return (
    <PageContainer>
      <WorkflowStepper />
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: "Student", href: `/students/${studentId}` },
        { label: "Application" },
      ]} />

      {/* Application Summary */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-7 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-page-title text-dvivid-text-primary">{application?.universityName}</h1>
            <p className="text-base text-dvivid-text-secondary mt-1.5">
              {application?.programName} · {application?.degree}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-dvivid-text-muted">
              {application?.intake && <span>{application.intake} {application.intakeYear}</span>}
              {application?.country && <span>{application.country}</span>}
              {application?.department && <span>{application.department}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={application?.status || "DRAFT"} />
            <Link href={`/students/${studentId}/applications/${applicationId}/intake/student-details`}>
              <SecondaryButton>9-Section Intake</SecondaryButton>
            </Link>
            <PrimaryButton onClick={() => setShowAddForm(!showAddForm)}>Add Document</PrimaryButton>
          </div>
        </div>
      </div>

      {/* Requirements Status */}
      {reqLookup && (
        <div className="bg-white border border-dvivid-border rounded-card shadow-card p-5 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-dvivid-text-secondary mb-1">Requirements Status</p>
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
                <p className="text-sm text-dvivid-text-secondary">No saved requirements for this program/intake</p>
              )}
            </div>
            {reqLookup.requirementSet && (
              <StatusBadge status="IN_REVIEW" label={reqLookup.requirementSet.verificationStatus.replace(/_/g, " ").toLowerCase()} />
            )}
          </div>
        </div>
      )}

      {/* Add Document Form */}
      {showAddForm && (
        <SectionCard title="Add Document" description="Create a new writing task for this application." className="mb-8">
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
                        {wr.wordMax ? ` · ${wr.wordMin || 0}-${wr.wordMax} words` : ""}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <FormField label="Document Type" required>
              <select className={inputClass} value={documentType} onChange={e => setDocumentType(e.target.value as DocumentType)}>
                {DOCUMENT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Document Title">
              <input className={inputClass} value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} placeholder="Statement of Objectives" />
            </FormField>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <FormField label="Prompt / Instructions" required>
              <></>
              </FormField>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAutoResolve}
                  disabled={resolving}
                  className="px-3 py-1.5 text-xs font-medium text-dvivid-primary border border-dvivid-primary/30 rounded-button hover:bg-dvivid-primary-light transition-colors disabled:opacity-50"
                >
                  {resolving ? "Resolving..." : "Auto-Resolve"}
                </button>
                <button
                  type="button"
                  onClick={handleTriggerDiscovery}
                  disabled={resolving}
                  className="px-3 py-1.5 text-xs font-medium text-dvivid-text-secondary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt transition-colors disabled:opacity-50"
                >
                  {resolving ? "Crawling..." : "Crawl Official Pages"}
                </button>
              </div>
            </div>
            <textarea
              className={`${inputClass} min-h-[120px] resize-y`}
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              placeholder="Paste the university or application portal question here, or click Auto-Resolve to find one automatically..."
            />
            {resolutionLabel && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-dvivid-text-muted">Resolved via:</span>
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

          <div className="mb-5">
            <FormField label="Prompt Source">
              <></>
            </FormField>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PROMPT_SOURCE_OPTIONS.map(opt => {
                const isDisabled = opt.value === "OFFICIAL_VERIFIED" || opt.value === "DVIVID_DEFAULT_TEMPLATE";
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 border rounded-input cursor-pointer transition-colors ${
                      promptSource === opt.value
                        ? "border-dvivid-primary bg-dvivid-primary-light"
                        : "border-dvivid-border hover:border-dvivid-primary-border"
                    } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="radio"
                      name="promptSource"
                      value={opt.value}
                      checked={promptSource === opt.value}
                      disabled={isDisabled}
                      onChange={e => setPromptSource(e.target.value as PromptSource)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-dvivid-text-primary">{opt.label}</p>
                      <p className="text-xs text-dvivid-text-secondary mt-0.5">{opt.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <FormField label="Word Min">
              <input className={inputClass} type="number" value={wordMin} onChange={e => setWordMin(e.target.value)} placeholder="—" />
            </FormField>
            <FormField label="Word Max">
              <input className={inputClass} type="number" value={wordMax} onChange={e => setWordMax(e.target.value)} placeholder="—" />
            </FormField>
            <FormField label="Character Limit">
              <input className={inputClass} type="number" value={characterLimit} onChange={e => setCharacterLimit(e.target.value)} placeholder="—" />
            </FormField>
            <FormField label="Page Limit">
              <input className={inputClass} type="number" value={pageLimit} onChange={e => setPageLimit(e.target.value)} placeholder="—" />
            </FormField>
          </div>

          <FormField label="Special Instructions" className="mb-6">
            <textarea className={`${inputClass} min-h-[80px] resize-y`} value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} placeholder="Any special instructions..." />
          </FormField>

          <div className="flex gap-3 justify-end">
            <SecondaryButton onClick={() => setShowAddForm(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleAddDocument} disabled={saving}>
              {saving ? "Saving..." : "Save Document"}
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

      {/* Documents */}
      <div className="mb-4">
        <h2 className="text-section-title text-dvivid-text-primary">Documents</h2>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="No Documents Yet"
          description="Add an SOP, essay, personal statement or other writing task."
          action={<PrimaryButton onClick={() => setShowAddForm(true)}>Add First Document</PrimaryButton>}
        />
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <Link
              key={doc.id}
              href={`/students/${studentId}/applications/${applicationId}/documents/${doc.id}`}
              className="block bg-white border border-dvivid-border rounded-card shadow-card p-6 hover:shadow-card-hover hover:border-dvivid-primary-border transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-card-title text-dvivid-text-primary">{doc.documentTitle}</h3>
                  <p className="text-sm text-dvivid-text-secondary mt-1 line-clamp-2">
                    {doc.promptText.substring(0, 120)}{doc.promptText.length > 120 ? "..." : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <PromptSourceBadge source={doc.promptSource} />
                    <span className="px-2.5 py-1 bg-gray-100 text-dvivid-text-secondary text-xs font-medium rounded-full">
                      {doc.documentType.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {doc.wordMax && (
                      <span className="px-2.5 py-1 bg-gray-100 text-dvivid-text-muted text-xs font-medium rounded-full">
                        {doc.wordMin || 0}-{doc.wordMax} words
                      </span>
                    )}
                    {doc.pageLimit && (
                      <span className="px-2.5 py-1 bg-gray-100 text-dvivid-text-muted text-xs font-medium rounded-full">
                        {doc.pageLimit} page(s)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <StatusBadge status={doc.generationStatus} />
                  {doc.generationStatus !== "NOT_STARTED" && doc.reviewStatus && (
                    <StatusBadge status={doc.reviewStatus} />
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
