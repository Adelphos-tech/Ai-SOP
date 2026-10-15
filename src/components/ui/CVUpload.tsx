"use client";

import { useState, useCallback, useRef } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ui";

type Stage = "upload" | "review" | "complete";

interface ParsedCV {
  personalData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    currentCity?: string;
    currentCountry?: string;
    nationality?: string;
  };
  education: any[];
  experience: any[];
  projects: any[];
  skills: {
    technical: string[];
    programming: string[];
    tools: string[];
    software?: string[];
    domain: string[];
    soft: string[];
  };
  certifications?: string[];
  achievements?: string[];
  parseWarnings: string[];
}

interface CVUploadProps {
  studentId: string;
  profileRevision?: number;
  onApplied?: () => void;
  /** students row identity — shown next to parsed CV identity so the
   * consultant can catch wrong-person uploads before Apply. */
  studentIdentity?: { firstName?: string; lastName?: string; email?: string };
  /** When the current profile already contains cv-* imported items, the
   * "Replace previous CV-imported data" action becomes available. */
  hasCvDerivedData?: boolean;
}

interface IdentityConflict {
  studentIdentity: { name: string; email: string };
  cvIdentity: { name: string; email: string };
  message: string;
}

/**
 * CV Upload Component
 * - Drag & drop PDF/DOCX
 * - Parses CV using rule-based extraction
 * - Shows detected data summary
 * - Apply to Profile button
 */
export function CVUpload({ studentId, profileRevision, onApplied, studentIdentity, hasCvDerivedData }: CVUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [parsedCV, setParsedCV] = useState<ParsedCV | null>(null);
  const [parseState, setParseState] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [applying, setApplying] = useState(false);
  const [stage, setStage] = useState<Stage>("upload");
  const [parseRevision, setParseRevision] = useState<number | null>(null);
  const [staleProfile, setStaleProfile] = useState(false);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [identityConflict, setIdentityConflict] = useState<IdentityConflict | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError("");
    setErrorCode(null);
    setParsedCV(null);
    setStage("upload");
    setIdentityConflict(null);
    setOcrNotice(null);

    // Validate file type
    const ext = "." + file.name.toLowerCase().split(".").pop();
    if (![".pdf", ".docx", ".txt"].includes(ext)) {
      setError(`Unsupported file type: ${ext}. Please upload PDF, DOCX, or TXT.`);
      return;
    }

    // Validate file size (10 MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large. Maximum size: 10 MB.");
      return;
    }

    setUploading(true);
    setParsing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("studentId", studentId);

      const res = await fetch("/api/application/cv-upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Use the server-provided friendly message + code
        setErrorCode(data.code || null);
        throw new Error(data.error || "Failed to upload CV.");
      }

      const data = await res.json();
      setFilename(data.filename || file.name);
      setParsedCV(data.parsed);
      setParseState(data.parseState || null);
      setExtractedText(data.extractedText || null);
      setOcrNotice(data.ocrNotice || null);
      setStage("review");
      setParseRevision(typeof data.profileRevision === "number" ? data.profileRevision : null);
      setStaleProfile(false);
    } catch (err: any) {
      setError(err?.message || "Failed to process CV.");
    } finally {
      setUploading(false);
      setParsing(false);
    }
  }, [studentId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  async function handleApply(replaceCvDerived = false) {
    if (!parsedCV) return;
    setApplying(true);
    setError("");
    setStaleProfile(false);
    try {
      const res = await fetch("/api/application/cv-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          parsedCV,
          overwrite: false,
          profileRevision: parseRevision,
          ...(replaceCvDerived ? { replaceCvDerived: true } : {}),
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "CV_IDENTITY_CONFLICT") {
          // Wrong-person CV — blocked. No override available.
          setIdentityConflict({
            studentIdentity: data.studentIdentity || { name: "", email: "" },
            cvIdentity: data.cvIdentity || { name: "", email: "" },
            message: data.error || "This CV appears to belong to a different person.",
          });
          return;
        }
        setStaleProfile(true);
        setError(data.error || "The student profile changed after this CV was parsed. Review the latest information before importing.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to apply CV data.");
      }
      setStage("complete");
      onApplied?.();
    } catch (err: any) {
      setError(err?.message || "Failed to apply CV data.");
    } finally {
      setApplying(false);
    }
  }

  function handleReset() {
    setParsedCV(null);
    setParseState(null);
    setExtractedText(null);
    setStage("upload");
    setError("");
    setErrorCode(null);
    setFilename("");
    setStaleProfile(false);
    setParseRevision(null);
    setIdentityConflict(null);
    setConfirmReplace(false);
    setShowPreview(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const totalSkills = parsedCV
    ? parsedCV.skills.technical.length + parsedCV.skills.programming.length +
      parsedCV.skills.tools.length + (parsedCV.skills.software || []).length +
      parsedCV.skills.domain.length + parsedCV.skills.soft.length
    : 0;
  const certCount = parsedCV?.certifications?.length || 0;
  const achievementCount = parsedCV?.achievements?.length || 0;

  // Categorize extracted fields by confidence
  function getFieldStatus(value: string | undefined): "confirmed" | "needs-review" | "missing" {
    if (!value || value.trim().length === 0) return "missing";
    if (value.match(/\b(unknown|not found|not detected|could not|please enter)\b/i)) return "needs-review";
    return "confirmed";
  }

  function getEducationStatus(e: any): "confirmed" | "needs-review" {
    if (!e.institution || !e.degree) return "needs-review";
    if (e.institution.length < 3 || e.degree.length < 2) return "needs-review";
    return "confirmed";
  }

  function getExperienceStatus(e: any): "confirmed" | "needs-review" {
    if (!e.organization || !e.role) return "needs-review";
    if (e.organization.length < 3 || e.role.length < 3) return "needs-review";
    return "confirmed";
  }

  const eduConfirmed = parsedCV?.education.filter(e => getEducationStatus(e) === "confirmed").length || 0;
  const eduNeedsReview = parsedCV?.education.filter(e => getEducationStatus(e) === "needs-review").length || 0;
  const expConfirmed = parsedCV?.experience.filter(e => getExperienceStatus(e) === "confirmed").length || 0;
  const expNeedsReview = parsedCV?.experience.filter(e => getExperienceStatus(e) === "needs-review").length || 0;

  return (
    <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6">
      {/* Stage stepper */}
      <StageStepper stage={stage} />

      <h3 className="text-card-title text-dvivid-text-primary mb-1">Student Application Profile</h3>
      <p className="text-sm text-dvivid-text-secondary mb-4">
        Upload a CV to pre-fill this application. You can review and edit everything before generation.
      </p>

      {/* ============ STAGE 1: UPLOAD ============ */}
      {stage === "upload" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-input p-8 text-center cursor-pointer transition-all ${
            dragOver
              ? "border-dvivid-primary bg-dvivid-primary-light/20"
              : "border-dvivid-border hover:border-dvivid-primary-border hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
          {uploading || parsing ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-dvivid-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-dvivid-text-secondary">
                {uploading ? "Uploading..." : "Parsing CV..."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-10 h-10 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-dvivid-text-primary">
                Upload Resume
              </p>
              <p className="text-xs text-dvivid-text-muted">
                Drag & drop PDF/DOCX or click to browse
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={`mt-4 p-3 border rounded-input ${
          staleProfile
            ? "bg-amber-50 border-amber-300"
            : "bg-dvivid-error-light border-dvivid-error/20"
        }`}>
          <p className={`text-sm ${staleProfile ? "text-amber-800" : "text-dvivid-error"}`}>{error}</p>
          {staleProfile && (
            <button
              onClick={handleReset}
              className="mt-2 text-sm font-medium text-amber-900 underline hover:no-underline"
            >
              Re-upload CV after reviewing the latest profile
            </button>
          )}
          {!staleProfile && errorCode && (
            <button
              onClick={handleReset}
              className="mt-2 text-sm font-medium text-dvivid-primary underline hover:no-underline"
            >
              Upload Different CV
            </button>
          )}
        </div>
      )}

      {/* ============ STAGE 2: REVIEW ============ */}
      {stage === "review" && parsedCV && (
        <div className="mt-4 space-y-4">
          {/* Parse state banner */}
          {parseState === "EXTRACTION_ONLY" ? (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-input space-y-1">
              <p className="text-sm font-medium text-amber-800">
                We could not fully structure this format: {filename}
              </p>
              <p className="text-sm text-amber-700">
                The text was extracted but not parsed into fields. Complete the profile manually — nothing is applied automatically.
              </p>
            </div>
          ) : parseState === "PARTIAL_PARSE" || parseState === "PARSED_WITH_WARNINGS" ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-input">
              <p className="text-sm font-medium text-amber-800">
                Imported with some items needing review: {filename}
              </p>
              <p className="text-xs text-amber-700">
                Review each section below before applying.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-dvivid-success-light border border-dvivid-success/20 rounded-input">
              <svg className="w-5 h-5 text-dvivid-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium text-dvivid-success">
                Resume imported: {filename}
              </span>
            </div>
          )}

          {/* OCR notice */}
          {ocrNotice && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-input">
              <p className="text-sm text-blue-800">{ocrNotice}</p>
            </div>
          )}

          {/* Identity comparison */}
          {(parsedCV.personalData.firstName || parsedCV.personalData.email) && (
            <div className={`p-3 border rounded-input text-sm space-y-1 ${
              identityConflict
                ? "bg-dvivid-error-light border-dvivid-error/30"
                : "bg-gray-50 border-dvivid-border"
            }`}>
              {studentIdentity && (
                <p className="text-dvivid-text-secondary">
                  Selected student: <strong className="text-dvivid-text-primary">
                    {[studentIdentity.firstName, studentIdentity.lastName].filter(Boolean).join(" ") || "—"}
                  </strong>
                  {studentIdentity.email ? ` (${studentIdentity.email})` : ""}
                </p>
              )}
              <p className="text-dvivid-text-secondary">
                CV belongs to: <strong className="text-dvivid-text-primary">
                  {[parsedCV.personalData.firstName, parsedCV.personalData.lastName].filter(Boolean).join(" ") || "—"}
                </strong>
                {parsedCV.personalData.email ? ` (${parsedCV.personalData.email})` : ""}
              </p>
            </div>
          )}

          {/* Identity conflict — BLOCKED, no override */}
          {identityConflict && (
            <div className="p-4 bg-dvivid-error-light border border-dvivid-error/30 rounded-input space-y-2">
              <p className="text-sm font-semibold text-dvivid-error">
                This CV belongs to a different person and cannot be applied.
              </p>
              <p className="text-sm text-dvivid-text-secondary">{identityConflict.message}</p>
              <p className="text-xs text-dvivid-text-muted">
                Upload a different CV or verify the selected student.
              </p>
            </div>
          )}

          {/* Review summary cards */}
          <div className="space-y-3">
            {/* Personal */}
            <ReviewCard
              title="Personal Information"
              status={getFieldStatus(parsedCV.personalData.firstName) === "confirmed" && getFieldStatus(parsedCV.personalData.email) === "confirmed" ? "confirmed" : "needs-review"}
            >
              <FieldRow label="Name" value={[parsedCV.personalData.firstName, parsedCV.personalData.lastName].filter(Boolean).join(" ")} />
              <FieldRow label="Email" value={parsedCV.personalData.email} />
              <FieldRow label="Phone" value={parsedCV.personalData.phone} />
              <FieldRow label="Location" value={[parsedCV.personalData.currentCity, parsedCV.personalData.currentCountry].filter(Boolean).join(", ")} />
              <FieldRow label="Nationality" value={parsedCV.personalData.nationality} />
            </ReviewCard>

            {/* Education */}
            {parsedCV.education.length > 0 && (
              <ReviewCard
                title={`Education (${eduConfirmed} confirmed${eduNeedsReview > 0 ? `, ${eduNeedsReview} needs review` : ""})`}
                status={eduNeedsReview > 0 ? "needs-review" : "confirmed"}
              >
                {parsedCV.education.map((e, i) => (
                  <div key={i} className={`py-1.5 border-b last:border-b-0 border-dvivid-border-light ${getEducationStatus(e) === "needs-review" ? "text-amber-700" : "text-dvivid-text-secondary"}`}>
                    <span className="text-sm">{e.degree || "?"} {e.specialization ? `in ${e.specialization}` : ""} — {e.institution || "?"}</span>
                    <span className="text-xs text-dvivid-text-muted ml-2">({e.startYear || "?"}–{e.endYear || "?"})</span>
                    {getEducationStatus(e) === "needs-review" && <span className="ml-2 text-xs font-medium text-amber-600">Needs review</span>}
                  </div>
                ))}
              </ReviewCard>
            )}

            {/* Experience */}
            {parsedCV.experience.length > 0 && (
              <ReviewCard
                title={`Work Experience (${expConfirmed} confirmed${expNeedsReview > 0 ? `, ${expNeedsReview} needs review` : ""})`}
                status={expNeedsReview > 0 ? "needs-review" : "confirmed"}
              >
                {parsedCV.experience.map((e, i) => (
                  <div key={i} className={`py-1.5 border-b last:border-b-0 border-dvivid-border-light ${getExperienceStatus(e) === "needs-review" ? "text-amber-700" : "text-dvivid-text-secondary"}`}>
                    <span className="text-sm">{e.role || "?"} at {e.organization || "?"}</span>
                    <span className="text-xs text-dvivid-text-muted ml-2">({e.startDate || "?"}–{e.endDate || "present"})</span>
                    {getExperienceStatus(e) === "needs-review" && <span className="ml-2 text-xs font-medium text-amber-600">Needs review</span>}
                  </div>
                ))}
              </ReviewCard>
            )}

            {/* Projects */}
            {parsedCV.projects.length > 0 && (
              <ReviewCard title={`Projects (${parsedCV.projects.length})`} status="confirmed">
                {parsedCV.projects.map((p, i) => (
                  <div key={i} className="py-1.5 border-b last:border-b-0 border-dvivid-border-light text-dvivid-text-secondary text-sm">
                    {p.name || "?"} {p.technologies && <span className="text-xs text-dvivid-text-muted">— {p.technologies}</span>}
                  </div>
                ))}
              </ReviewCard>
            )}

            {/* Skills */}
            {totalSkills > 0 && (
              <ReviewCard title={`Skills (${totalSkills})`} status="confirmed">
                <div className="flex flex-wrap gap-1.5">
                  {[...parsedCV.skills.technical, ...parsedCV.skills.programming, ...parsedCV.skills.tools, ...(parsedCV.skills.software || []), ...parsedCV.skills.domain, ...parsedCV.skills.soft].map((s, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-dvivid-text-secondary">{s}</span>
                  ))}
                </div>
              </ReviewCard>
            )}

            {/* Certifications + Achievements */}
            {certCount > 0 && (
              <ReviewCard title={`Certifications (${certCount})`} status="confirmed">
                {parsedCV.certifications!.map((c, i) => (
                  <div key={i} className="py-0.5 text-sm text-dvivid-text-secondary">{c}</div>
                ))}
              </ReviewCard>
            )}
            {achievementCount > 0 && (
              <ReviewCard title={`Achievements (${achievementCount})`} status="confirmed">
                {parsedCV.achievements!.map((a, i) => (
                  <div key={i} className="py-0.5 text-sm text-dvivid-text-secondary">{a}</div>
                ))}
              </ReviewCard>
            )}
          </div>

          {/* Technical diagnostics (collapsed) */}
          {parsedCV.parseWarnings.length > 0 && (
            <details className="border border-gray-200 rounded-input p-3">
              <summary className="text-xs font-medium text-dvivid-text-muted cursor-pointer">
                Technical parse details ({parsedCV.parseWarnings.length})
              </summary>
              <ul className="text-xs text-dvivid-text-muted list-disc list-inside space-y-0.5 mt-2">
                {parsedCV.parseWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          {/* Extracted raw text (collapsed) */}
          {extractedText && (
            <details className="border border-gray-200 rounded-input p-3">
              <summary className="text-xs font-medium text-dvivid-text-muted cursor-pointer">
                Extracted resume text ({extractedText.length.toLocaleString()} characters)
              </summary>
              <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-dvivid-text-secondary bg-white border border-dvivid-border rounded p-2">
                {extractedText}
              </pre>
            </details>
          )}

          {/* Replace confirm */}
          {confirmReplace && !identityConflict && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-input space-y-2">
              <p className="text-sm font-semibold text-amber-900">
                Replace previous CV-imported data?
              </p>
              <p className="text-sm text-amber-800">
                This removes education, experience, project and achievement entries that were
                previously imported from a CV, then applies this CV instead.
                Manually entered information is preserved.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => handleApply(true)}
                  disabled={applying}
                  className="px-4 py-2 text-sm font-medium rounded-input bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {applying ? "Replacing..." : "Confirm replace"}
                </button>
                <SecondaryButton onClick={() => setConfirmReplace(false)}>Cancel</SecondaryButton>
              </div>
            </div>
          )}

          {/* Preview before apply */}
          {showPreview && !identityConflict && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-input space-y-3">
              <p className="text-sm font-semibold text-blue-900">
                Preview changes before applying
              </p>
              <div className="text-sm space-y-1">
                <p className="text-blue-800"><strong>Will be added or updated:</strong></p>
                <ul className="list-disc list-inside text-blue-700 text-xs">
                  {parsedCV.personalData.firstName && <li>Personal information (name, email, etc.)</li>}
                  {parsedCV.education.length > 0 && <li>{parsedCV.education.length} education record(s)</li>}
                  {parsedCV.experience.length > 0 && <li>{parsedCV.experience.length} experience record(s)</li>}
                  {parsedCV.projects.length > 0 && <li>{parsedCV.projects.length} project(s)</li>}
                  {totalSkills > 0 && <li>{totalSkills} skill(s)</li>}
                </ul>
                {hasCvDerivedData && (
                  <>
                    <p className="text-amber-800 mt-2"><strong>Will be replaced:</strong></p>
                    <p className="text-xs text-amber-700">Previous CV-imported education, experience, projects and skills will be removed.</p>
                  </>
                )}
                <p className="text-green-800 mt-2"><strong>Will be preserved:</strong></p>
                <p className="text-xs text-green-700">Manually entered data and data from other sources.</p>
              </div>
              <div className="flex gap-3 pt-1">
                <PrimaryButton onClick={() => { setShowPreview(false); handleApply(false); }} disabled={applying}>
                  {applying ? "Applying..." : "Confirm and Apply"}
                </PrimaryButton>
                <SecondaryButton onClick={() => setShowPreview(false)}>Cancel</SecondaryButton>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {parseState === "EXTRACTION_ONLY" ? (
              <SecondaryButton onClick={handleReset}>Upload Different CV</SecondaryButton>
            ) : identityConflict ? (
              <SecondaryButton onClick={handleReset}>Upload Different CV</SecondaryButton>
            ) : !confirmReplace && !showPreview ? (
              <>
                <PrimaryButton onClick={() => setShowPreview(true)} disabled={applying}>
                  Review and Apply
                </PrimaryButton>
                {hasCvDerivedData && (
                  <SecondaryButton onClick={() => setConfirmReplace(true)}>
                    Replace previous CV-imported data
                  </SecondaryButton>
                )}
                <SecondaryButton onClick={handleReset}>Upload Different CV</SecondaryButton>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ============ STAGE 3: COMPLETE ============ */}
      {stage === "complete" && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 p-3 bg-dvivid-success-light border border-dvivid-success/20 rounded-input">
            <svg className="w-5 h-5 text-dvivid-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-dvivid-success">
              CV data applied to profile. Review and edit in the intake sections below.
            </span>
          </div>
          <SecondaryButton onClick={handleReset}>Upload Another CV</SecondaryButton>
        </div>
      )}
    </div>
  );
}

function StageStepper({ stage }: { stage: Stage }) {
  const steps = [
    { id: "upload", label: "Upload Resume" },
    { id: "review", label: "Review Extracted Details" },
    { id: "complete", label: "Complete Application" },
  ];
  const activeIndex = steps.findIndex(s => s.id === stage);

  return (
    <div className="flex items-center gap-2 mb-4">
      {steps.map((s, i) => (
        <>
          <div key={s.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            i <= activeIndex
              ? "bg-dvivid-primary-light text-dvivid-primary"
              : "bg-gray-100 text-dvivid-text-muted"
          }`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
              i <= activeIndex ? "bg-dvivid-primary text-white" : "bg-gray-200 text-dvivid-text-muted"
            }`}>
              {i < activeIndex ? "✓" : i + 1}
            </span>
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px ${i < activeIndex ? "bg-dvivid-primary" : "bg-gray-200"}`} />
          )}
        </>
      ))}
    </div>
  );
}

function ReviewCard({ title, status, children }: { title: string; status: "confirmed" | "needs-review"; children: React.ReactNode }) {
  return (
    <div className="border border-dvivid-border rounded-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-dvivid-text-primary">{title}</p>
        {status === "confirmed" ? (
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Confirmed</span>
        ) : (
          <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Needs review</span>
        )}
      </div>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  const status = !value || value.trim().length === 0 ? "missing" : "confirmed";
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-dvivid-text-muted">{label}</span>
      <span className={`${status === "missing" ? "text-amber-600 italic" : "text-dvivid-text-secondary"}`}>
        {status === "missing" ? "Not found" : value}
      </span>
    </div>
  );
}

function DetectedItem({ detected, label }: { detected: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {detected ? (
        <svg className="w-4 h-4 text-dvivid-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-dvivid-border flex items-center justify-center text-xs text-dvivid-text-muted">—</span>
      )}
      <span className={`text-sm ${detected ? "text-dvivid-text-primary" : "text-dvivid-text-muted"}`}>
        {label}
      </span>
    </div>
  );
}
