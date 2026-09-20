"use client";

import { useState, useCallback, useRef } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ui";

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
export function CVUpload({ studentId, profileRevision, onApplied, studentIdentity }: CVUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [parsedCV, setParsedCV] = useState<ParsedCV | null>(null);
  const [filename, setFilename] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [parseRevision, setParseRevision] = useState<number | null>(null);
  const [staleProfile, setStaleProfile] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [identityConflict, setIdentityConflict] = useState<IdentityConflict | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError("");
    setErrorCode(null);
    setParsedCV(null);
    setShowReview(false);
    setApplied(false);
    setIdentityConflict(null);

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
      setShowReview(true);
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

  async function handleApply(identityOverride = false) {
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
          ...(identityOverride ? { identityConflictOverride: true } : {}),
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "CV_IDENTITY_CONFLICT") {
          // Wrong-person CV — never silently applied. Show the conflict
          // banner; "Apply Anyway" is a separate explicit second step.
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
      setApplied(true);
      onApplied?.();
    } catch (err: any) {
      setError(err?.message || "Failed to apply CV data.");
    } finally {
      setApplying(false);
    }
  }

  function handleReset() {
    setParsedCV(null);
    setShowReview(false);
    setApplied(false);
    setError("");
    setErrorCode(null);
    setFilename("");
    setStaleProfile(false);
    setParseRevision(null);
    setIdentityConflict(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const totalSkills = parsedCV
    ? parsedCV.skills.technical.length + parsedCV.skills.programming.length +
      parsedCV.skills.tools.length + (parsedCV.skills.software || []).length +
      parsedCV.skills.domain.length + parsedCV.skills.soft.length
    : 0;
  const certCount = parsedCV?.certifications?.length || 0;
  const achievementCount = parsedCV?.achievements?.length || 0;

  return (
    <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6">
      <h3 className="text-card-title text-dvivid-text-primary mb-1">Student Application Profile</h3>
      <p className="text-sm text-dvivid-text-secondary mb-4">
        Upload a CV to pre-fill this application. You can review and edit everything before generation.
      </p>

      {/* Upload zone */}
      {!parsedCV && !applied && (
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
                Upload CV
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
          {/* Show "Upload Different CV" on parse failures (not stale profile) */}
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

      {/* Parsed result */}
      {parsedCV && showReview && !applied && (
        <div className="mt-4 space-y-4">
          {/* Success banner */}
          <div className="flex items-center gap-2 p-3 bg-dvivid-success-light border border-dvivid-success/20 rounded-input">
            <svg className="w-5 h-5 text-dvivid-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-dvivid-success">
              CV imported: {filename}
            </span>
          </div>

          {/* Identity comparison — always visible before Apply */}
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

          {/* Identity conflict — Apply Anyway is an explicit second step */}
          {identityConflict && (
            <div className="p-4 bg-dvivid-error-light border border-dvivid-error/30 rounded-input space-y-2">
              <p className="text-sm font-semibold text-dvivid-error">
                ⚠ This CV appears to belong to a different person.
              </p>
              <p className="text-sm text-dvivid-text-secondary">{identityConflict.message}</p>
            </div>
          )}

          {/* Detected summary */}
          <div>
            <p className="text-sm font-medium text-dvivid-text-primary mb-2">Detected:</p>
            <div className="space-y-1.5">
              <DetectedItem detected={!!(parsedCV.personalData.firstName || parsedCV.personalData.email)} label="Personal information" />
              <DetectedItem detected={parsedCV.education.length > 0} label={`${parsedCV.education.length} Education record${parsedCV.education.length !== 1 ? "s" : ""}`} />
              <DetectedItem detected={parsedCV.projects.length > 0} label={`${parsedCV.projects.length} Project${parsedCV.projects.length !== 1 ? "s" : ""}`} />
              <DetectedItem detected={parsedCV.experience.length > 0} label={`${parsedCV.experience.length} Work experience${parsedCV.experience.length !== 1 ? "s" : ""}`} />
              <DetectedItem detected={totalSkills > 0} label={`${totalSkills} Skill${totalSkills !== 1 ? "s" : ""}`} />
              <DetectedItem detected={certCount > 0} label={`${certCount} Certification${certCount !== 1 ? "s" : ""}`} />
              <DetectedItem detected={achievementCount > 0} label={`${achievementCount} Achievement${achievementCount !== 1 ? "s" : ""}`} />
            </div>
          </div>

          {/* Warnings */}
          {parsedCV.parseWarnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-input">
              <p className="text-sm font-medium text-amber-800 mb-1">Parse notes:</p>
              <ul className="text-sm text-amber-700 list-disc list-inside space-y-0.5">
                {parsedCV.parseWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Review details */}
          <details className="border border-dvivid-border rounded-input p-3">
            <summary className="text-sm font-medium text-dvivid-primary cursor-pointer hover:underline">
              Review CV Import Details
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              {/* Personal */}
              <div>
                <p className="font-medium text-dvivid-text-primary mb-1">Personal Information</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-dvivid-text-secondary">
                  <dt>Name:</dt><dd>{parsedCV.personalData.firstName} {parsedCV.personalData.lastName}</dd>
                  <dt>Email:</dt><dd>{parsedCV.personalData.email || "—"}</dd>
                  <dt>Phone:</dt><dd>{parsedCV.personalData.phone || "—"}</dd>
                  <dt>Location:</dt><dd>{[parsedCV.personalData.currentCity, parsedCV.personalData.currentCountry].filter(Boolean).join(", ") || "—"}</dd>
                  <dt>Nationality:</dt><dd>{parsedCV.personalData.nationality || "—"}</dd>
                </dl>
              </div>

              {/* Education */}
              {parsedCV.education.length > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Education</p>
                  {parsedCV.education.map((e, i) => (
                    <div key={i} className="text-dvivid-text-secondary mb-1">
                      {e.degree} in {e.specialization} — {e.institution} ({e.startYear}–{e.endYear})
                      {e.cgpa && ` · CGPA: ${e.cgpa}/${e.cgpaScale}`}
                    </div>
                  ))}
                </div>
              )}

              {/* Experience */}
              {parsedCV.experience.length > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Work Experience</p>
                  {parsedCV.experience.map((e, i) => (
                    <div key={i} className="text-dvivid-text-secondary mb-1">
                      {e.role} at {e.organization} ({e.startDate}–{e.endDate || "present"})
                    </div>
                  ))}
                </div>
              )}

              {/* Projects */}
              {parsedCV.projects.length > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Projects</p>
                  {parsedCV.projects.map((p, i) => (
                    <div key={i} className="text-dvivid-text-secondary mb-1">
                      {p.name}{p.technologies && ` — ${p.technologies}`}
                    </div>
                  ))}
                </div>
              )}

              {/* Skills */}
              {totalSkills > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...parsedCV.skills.technical, ...parsedCV.skills.programming, ...parsedCV.skills.tools, ...(parsedCV.skills.software || []), ...parsedCV.skills.domain, ...parsedCV.skills.soft].map((s, i) => (
                      <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-dvivid-text-secondary">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Certifications + Achievements */}
              {certCount > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Certifications</p>
                  {parsedCV.certifications!.map((c, i) => (
                    <div key={i} className="text-dvivid-text-secondary mb-0.5">{c}</div>
                  ))}
                </div>
              )}
              {achievementCount > 0 && (
                <div>
                  <p className="font-medium text-dvivid-text-primary mb-1">Achievements & Awards</p>
                  {parsedCV.achievements!.map((a, i) => (
                    <div key={i} className="text-dvivid-text-secondary mb-0.5">{a}</div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {identityConflict ? (
              <>
                <SecondaryButton onClick={handleReset}>Upload Different CV</SecondaryButton>
                <button
                  onClick={() => handleApply(true)}
                  disabled={applying}
                  className="px-4 py-2 text-sm font-medium rounded-input border border-dvivid-error text-dvivid-error hover:bg-dvivid-error hover:text-white transition-colors disabled:opacity-50"
                >
                  {applying ? "Applying..." : "Apply Anyway (I verified the identity)"}
                </button>
              </>
            ) : (
              <>
                <PrimaryButton onClick={() => handleApply(false)} disabled={applying}>
                  {applying ? "Applying..." : "Apply to Profile"}
                </PrimaryButton>
                <SecondaryButton onClick={handleReset}>Upload Different CV</SecondaryButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* Applied confirmation */}
      {applied && (
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
