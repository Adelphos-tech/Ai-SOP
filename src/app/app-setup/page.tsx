"use client";

import { useState, useEffect } from "react";
import {
  DOCUMENT_TYPE_OPTIONS,
  PROMPT_SOURCE_OPTIONS,
  USER_SETTABLE_PROMPT_SOURCES,
  DocumentType,
  PromptSource,
} from "@/lib/application/application-types";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";

interface SavedData {
  studentId: string;
  applicationId: string;
  documentId: string;
}

interface SavedDocument {
  id: string;
  documentType: DocumentType;
  documentTitle: string;
  promptText: string;
  promptSource: PromptSource;
  wordMin?: number;
  wordMax?: number;
  pageLimit?: number;
}

export default function AppSetupPage() {
  // Student state
  const [studentId, setStudentId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");

  // Application state
  const [applicationId, setApplicationId] = useState("");
  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [degree, setDegree] = useState("");
  const [department, setDepartment] = useState("");
  const [appCountry, setAppCountry] = useState("");
  const [intake, setIntake] = useState("");
  const [intakeYear, setIntakeYear] = useState("");

  // Document state
  const [documentType, setDocumentType] = useState<DocumentType>("STATEMENT_OF_PURPOSE");
  const [documentTitle, setDocumentTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptSource, setPromptSource] = useState<PromptSource>("CONSULTANT_PROVIDED");
  const [wordMin, setWordMin] = useState("");
  const [wordMax, setWordMax] = useState("");
  const [characterLimit, setCharacterLimit] = useState("");
  const [pageLimit, setPageLimit] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [facultyInstructions, setFacultyInstructions] = useState("");
  const [formattingInstructions, setFormattingInstructions] = useState("");

  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [savedData, setSavedData] = useState<SavedData | null>(null);
  const [existingDocuments, setExistingDocuments] = useState<SavedDocument[]>([]);

  // Load existing student from localStorage (transitional behavior)
  useEffect(() => {
    const stored = localStorage.getItem("dvivid-profile");
    if (stored) {
      try {
        const profile = JSON.parse(stored);
        if (profile.personalData) {
          setFirstName(profile.personalData.firstName || "");
          setLastName(profile.personalData.lastName || "");
          setEmail(profile.personalData.email || "");
          setPhone(profile.personalData.phone || "");
          setCountry(profile.personalData.country || "");
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // Load existing documents when applicationId changes
  useEffect(() => {
    if (!applicationId) return;
    loadDocuments(applicationId);
  }, [applicationId]);

  async function loadDocuments(appId: string) {
    try {
      const res = await fetch(`/api/application/list?applicationId=${appId}`);
      if (res.ok) {
        const data = await res.json();
        setExistingDocuments(data.documents || []);
      }
    } catch {
      // ignore
    }
  }

  function resetDocumentForm() {
    setDocumentType("STATEMENT_OF_PURPOSE");
    setDocumentTitle("");
    setPromptText("");
    setPromptSource("CONSULTANT_PROVIDED");
    setWordMin("");
    setWordMax("");
    setCharacterLimit("");
    setPageLimit("");
    setSpecialInstructions("");
    setFacultyInstructions("");
    setFormattingInstructions("");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      // Validate
      if (!firstName || !lastName || !email) {
        throw new Error("Student first name, last name, and email are required");
      }
      if (!universityName || !programName || !degree) {
        throw new Error("University, program, and degree are required");
      }
      if (!promptText) {
        throw new Error("Prompt / Instructions is required");
      }

      const body: Record<string, unknown> = {
        student: studentId ? { id: studentId } : {
          firstName,
          lastName,
          email,
          phone,
          country,
        },
        application: {
          universityName,
          programName,
          degree,
          department,
          country: appCountry,
          intake,
          intakeYear,
        },
        document: {
          documentType,
          documentTitle: documentTitle || DOCUMENT_TYPE_OPTIONS.find(d => d.value === documentType)?.label || documentType,
          promptText,
          promptSource,
          wordMin: wordMin ? parseInt(wordMin) : undefined,
          wordMax: wordMax ? parseInt(wordMax) : undefined,
          characterLimit: characterLimit ? parseInt(characterLimit) : undefined,
          pageLimit: pageLimit ? parseInt(pageLimit) : undefined,
          specialInstructions,
          facultyInstructions,
          formattingInstructions,
        },
      };

      const res = await fetch("/api/application/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }

      const data = await res.json();
      setStudentId(data.studentId);
      setApplicationId(data.applicationId);
      setSavedData({
        studentId: data.studentId,
        applicationId: data.applicationId,
        documentId: data.documentId,
      });
      setSaved(true);
      resetDocumentForm();
      await loadDocuments(data.applicationId);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDocument() {
    if (!applicationId) {
      setError("Save the application first");
      return;
    }
    if (!promptText) {
      setError("Prompt / Instructions is required");
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
          facultyInstructions,
          formattingInstructions,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Add document failed");
      }

      setSaved(true);
      resetDocumentForm();
      await loadDocuments(applicationId);
    } catch (err: any) {
      setError(err?.message || "Add document failed");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full px-4 py-2.5 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-tertiary focus:outline-none focus:ring-2 focus:ring-dvivid-blue/20 focus:border-dvivid-blue transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-dvivid-text-primary mb-1.5";
  const helperClass = "text-xs text-dvivid-text-secondary mt-1";

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
      <WorkflowStepper />
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-dvivid-text-primary">Application Setup</h1>
        <p className="text-sm text-dvivid-text-secondary mt-1">
          Create a student application and add writing documents with their specific prompts and instructions.
        </p>
      </div>

      {/* Saved Status */}
      {saved && savedData && (
        <div className="mb-6 p-4 bg-dvivid-success-light border border-dvivid-success/20 rounded-card flex items-center gap-3">
          <span className="text-dvivid-success text-lg">✓</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-dvivid-success">Saved successfully</p>
            <p className="text-xs text-dvivid-text-secondary mt-0.5">
              Student: {savedData.studentId.slice(0, 8)}... · Application: {savedData.applicationId.slice(0, 8)}... · Document: {savedData.documentId.slice(0, 8)}...
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-card">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}

      {/* Application Details Card */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-full bg-dvivid-blue text-white flex items-center justify-center text-sm font-semibold">1</div>
          <h2 className="text-lg font-semibold text-dvivid-text-primary">Application Details</h2>
        </div>

        {/* Student fields (only if no student yet) */}
        {!studentId && (
          <div className="mb-5 pb-5 border-b border-dvivid-border-light">
            <p className="text-xs font-medium text-dvivid-text-secondary uppercase tracking-wide mb-3">Student</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>First Name <span className="text-dvivid-error">*</span></label>
                <input className={inputClass} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Rahul" />
              </div>
              <div>
                <label className={labelClass}>Last Name <span className="text-dvivid-error">*</span></label>
                <input className={inputClass} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Sharma" />
              </div>
              <div>
                <label className={labelClass}>Email <span className="text-dvivid-error">*</span></label>
                <input className={inputClass} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="rahul@example.com" />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
              </div>
            </div>
          </div>
        )}

        {studentId && (
          <div className="mb-5 pb-5 border-b border-dvivid-border-light">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-dvivid-text-secondary uppercase tracking-wide">Student</p>
              <span className="text-xs text-dvivid-success">✓ {firstName} {lastName}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>University <span className="text-dvivid-error">*</span></label>
            <input className={inputClass} value={universityName} onChange={e => setUniversityName(e.target.value)} placeholder="Massachusetts Institute of Technology" />
          </div>
          <div>
            <label className={labelClass}>Program <span className="text-dvivid-error">*</span></label>
            <input className={inputClass} value={programName} onChange={e => setProgramName(e.target.value)} placeholder="Civil & Environmental Engineering" />
          </div>
          <div>
            <label className={labelClass}>Degree <span className="text-dvivid-error">*</span></label>
            <select className={inputClass} value={degree} onChange={e => setDegree(e.target.value)}>
              <option value="">Select degree</option>
              <option value="Master of Engineering">Master of Engineering (MEng)</option>
              <option value="Master of Science">Master of Science (MS)</option>
              <option value="Master of Arts">Master of Arts (MA)</option>
              <option value="Master of Business Administration">Master of Business Administration (MBA)</option>
              <option value="Doctor of Philosophy">Doctor of Philosophy (PhD)</option>
              <option value="Bachelor">Bachelor</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Department</label>
            <input className={inputClass} value={department} onChange={e => setDepartment(e.target.value)} placeholder="CEE" />
          </div>
          <div>
            <label className={labelClass}>Country</label>
            <input className={inputClass} value={appCountry} onChange={e => setAppCountry(e.target.value)} placeholder="USA" />
          </div>
          <div>
            <label className={labelClass}>Intake</label>
            <select className={inputClass} value={intake} onChange={e => setIntake(e.target.value)}>
              <option value="">Select intake</option>
              <option value="Fall">Fall</option>
              <option value="Spring">Spring</option>
              <option value="Summer">Summer</option>
              <option value="Winter">Winter</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Intake Year</label>
            <input className={inputClass} value={intakeYear} onChange={e => setIntakeYear(e.target.value)} placeholder="2027" />
          </div>
        </div>
      </div>

      {/* Document Details Card */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-full bg-dvivid-blue text-white flex items-center justify-center text-sm font-semibold">2</div>
          <h2 className="text-lg font-semibold text-dvivid-text-primary">Document Details</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelClass}>Document Type <span className="text-dvivid-error">*</span></label>
            <select className={inputClass} value={documentType} onChange={e => setDocumentType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Document Title</label>
            <input className={inputClass} value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} placeholder="Statement of Objectives" />
          </div>
        </div>

        {/* Prompt / Instructions */}
        <div className="mb-4">
          <label className={labelClass}>Prompt / Instructions <span className="text-dvivid-error">*</span></label>
          <textarea
            className={`${inputClass} min-h-[120px] resize-y`}
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder="Paste the university or application portal question here, or enter the instructions you want the AI to follow."
          />
          <p className={helperClass}>Paste the university or application portal question here, or enter the instructions you want the AI to follow.</p>
        </div>

        {/* Prompt Source */}
        <div className="mb-5">
          <label className={labelClass}>Prompt Source</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PROMPT_SOURCE_OPTIONS.map(opt => {
              const isDisabled = opt.value === "OFFICIAL_VERIFIED";
              const isSelected = promptSource === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 border rounded-input cursor-pointer transition-colors ${
                    isSelected
                      ? "border-dvivid-blue bg-dvivid-blue-lighter"
                      : "border-dvivid-border hover:border-dvivid-blue-light"
                  } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="radio"
                    name="promptSource"
                    value={opt.value}
                    checked={isSelected}
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
          <p className={helperClass}>
            <span className="text-dvivid-text-tertiary">Official Verified is server-controlled and cannot be manually selected.</span>
          </p>
        </div>

        {/* Limits */}
        <div className="border-t border-dvivid-border-light pt-4">
          <p className="text-xs font-medium text-dvivid-text-secondary uppercase tracking-wide mb-3">Constraints & Limits</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>Word Min</label>
              <input className={inputClass} type="number" value={wordMin} onChange={e => setWordMin(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className={labelClass}>Word Max</label>
              <input className={inputClass} type="number" value={wordMax} onChange={e => setWordMax(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className={labelClass}>Character Limit</label>
              <input className={inputClass} type="number" value={characterLimit} onChange={e => setCharacterLimit(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className={labelClass}>Page Limit</label>
              <input className={inputClass} type="number" value={pageLimit} onChange={e => setPageLimit(e.target.value)} placeholder="—" />
            </div>
          </div>
        </div>

        {/* Special Instructions */}
        <div className="mt-4 space-y-4">
          <div>
            <label className={labelClass}>Special Instructions</label>
            <textarea className={`${inputClass} min-h-[60px] resize-y`} value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} placeholder="Any special instructions for this document..." />
          </div>
          <div>
            <label className={labelClass}>Faculty / Research Instructions</label>
            <textarea className={`${inputClass} min-h-[60px] resize-y`} value={facultyInstructions} onChange={e => setFacultyInstructions(e.target.value)} placeholder="Faculty or research-specific instructions..." />
          </div>
          <div>
            <label className={labelClass}>Formatting Instructions</label>
            <textarea className={`${inputClass} min-h-[60px] resize-y`} value={formattingInstructions} onChange={e => setFormattingInstructions(e.target.value)} placeholder="Formatting requirements (font, spacing, etc.)..." />
          </div>
        </div>
      </div>

      {/* Existing Documents (if any) */}
      {existingDocuments.length > 0 && (
        <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6 mb-6">
          <h2 className="text-lg font-semibold text-dvivid-text-primary mb-4">
            Documents in this Application ({existingDocuments.length})
          </h2>
          <div className="space-y-3">
            {existingDocuments.map((doc, i) => (
              <div key={doc.id} className="flex items-center justify-between p-3 border border-dvivid-border-light rounded-input">
                <div>
                  <p className="text-sm font-medium text-dvivid-text-primary">
                    {i + 1}. {doc.documentTitle}
                  </p>
                  <p className="text-xs text-dvivid-text-secondary mt-0.5">
                    {doc.documentType} · {doc.promptSource}
                    {doc.wordMax ? ` · ${doc.wordMin || 0}-${doc.wordMax} words` : ""}
                    {doc.pageLimit ? ` · ${doc.pageLimit} page(s)` : ""}
                  </p>
                </div>
                <span className="text-xs text-dvivid-text-tertiary">{doc.id.slice(0, 8)}...</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end">
        {applicationId && (
          <button
            onClick={handleAddDocument}
            disabled={saving}
            className="px-6 py-2.5 border border-dvivid-blue text-dvivid-blue rounded-input font-medium text-sm hover:bg-dvivid-blue-lighter transition-colors disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Another Document"}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-dvivid-blue text-white rounded-input font-medium text-sm shadow-cta hover:bg-dvivid-blue-light transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : applicationId ? "Save New Document" : "Save Application & Document"}
        </button>
      </div>
    </div>
  );
}
