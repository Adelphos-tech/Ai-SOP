"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  useForm,
  useFieldArray,
  Controller,
  FormProvider,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageContainer, Breadcrumb, PrimaryButton, SecondaryButton, SectionCard, StatusBadge } from "@/components/ui";
import { FormField, inputClass, TextAreaField } from "@/components/ui/FormField";
import {
  DOCUMENT_TYPE_OPTIONS,
  DocumentType,
  PromptSource,
  USER_SETTABLE_PROMPT_SOURCES,
  PROMPT_SOURCE_LABELS,
  CreateDocumentInput,
  isValidDocumentType,
  isValidPromptSource,
} from "@/lib/application/application-types";
import { getDocumentPromptUi } from "@/lib/application/document-prompt-ui";
import {
  calculateIntakeCompletion,
  getProfileReadiness,
} from "@/lib/application/intake-completion";
import { CVUpload } from "@/components/ui/CVUpload";
import {
  INTAKE_SECTIONS,
} from "@/lib/application/intake-completion";
import { DocumentPromptUiConfig } from "@/lib/application/document-prompt-ui";

// ============================================================
// FORM SCHEMA (React Hook Form + Zod)
// ============================================================

const optionalNum = z.coerce.number().int().positive().optional().or(z.literal(""));
const optionalStr = z.string().optional();

const AddDocumentSchema = z.object({
  documentType: z.enum([
    "STATEMENT_OF_PURPOSE",
    "ESSAY",
    "SUPPLEMENTAL_QUESTION",
    "MOA",
    "PERSONAL_STATEMENT",
    "STATEMENT_OF_ACADEMIC_PURPOSE",
    "LETTER_OF_MOTIVATION",
    "VISA_SOP",
    "COVER_LETTER",
    "LETTER_OF_RECOMMENDATION",
    "CUSTOM",
  ]),
  documentTitle: z.string().optional(),
  promptText: z.string().optional(),
  promptSource: z.enum(["USER_PROVIDED_PORTAL_PROMPT", "CONSULTANT_PROVIDED", "CUSTOM", "OFFICIAL_VERIFIED"]),
  wordMin: z.coerce.number().int().positive().optional().or(z.literal("")),
  wordMax: z.coerce.number().int().positive().optional().or(z.literal("")),
  characterLimit: z.coerce.number().int().positive().optional().or(z.literal("")),
  pageLimit: z.coerce.number().int().positive().optional().or(z.literal("")),
  specialInstructions: z.string().optional(),
  facultyInstructions: z.string().optional(),
  formattingInstructions: z.string().optional(),
  mandatoryTopics: z.string().optional(),
  additionalQuestions: z.string().optional(),
}).refine((data) => {
  if (data.wordMin && data.wordMax && data.wordMin > data.wordMax) {
    return false;
  }
  return true;
}, {
  message: "Maximum words must be greater than or equal to minimum words",
  path: ["wordMax"],
});

type AddDocumentForm = z.infer<typeof AddDocumentSchema>;

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
  writingRequirements?: Array<{
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
  }>;
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
}

function getPromptUiConfig(documentType: DocumentType): DocumentPromptUiConfig {
  return getDocumentPromptUi(documentType);
}

function getDocumentTypeLabel(type: DocumentType): string {
  const found = DOCUMENT_TYPE_OPTIONS.find(o => o.value === type);
  return found?.label || type;
}

function getDocumentTypeCategory(type: DocumentType): "admissions" | "visa-professional" | "other" {
  const admissions = [
    "STATEMENT_OF_PURPOSE",
    "ESSAY",
    "SUPPLEMENTAL_QUESTION",
    "PERSONAL_STATEMENT",
    "STATEMENT_OF_ACADEMIC_PURPOSE",
    "LETTER_OF_MOTIVATION",
  ];
  const visaProfessional = [
    "VISA_SOP",
    "COVER_LETTER",
    "LETTER_OF_RECOMMENDATION",
    "MOA",
  ];
  if (admissions.includes(type)) return "admissions";
  if (visaProfessional.includes(type)) return "visa-professional";
  return "other";
}

const DOCUMENT_TYPE_GROUPS = {
  admissions: [
    { value: "STATEMENT_OF_PURPOSE", label: "Statement of Purpose" },
    { value: "ESSAY", label: "Essay" },
    { value: "SUPPLEMENTAL_QUESTION", label: "Supplemental Question" },
    { value: "PERSONAL_STATEMENT", label: "Personal Statement" },
    { value: "STATEMENT_OF_ACADEMIC_PURPOSE", label: "Statement of Academic Purpose" },
    { value: "LETTER_OF_MOTIVATION", label: "Letter of Motivation" },
  ],
  "visa-professional": [
    { value: "VISA_SOP", label: "Visa SOP" },
    { value: "COVER_LETTER", label: "Cover Letter" },
    { value: "LETTER_OF_RECOMMENDATION", label: "Letter of Recommendation" },
    { value: "MOA", label: "MOA" },
  ],
  other: [
    { value: "CUSTOM", label: "Custom Document" },
  ],
};

export default function NewDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;

  const [application, setApplication] = useState<Application | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionPath, setResolutionPath] = useState<string | null>(null);
  const [resolutionLabel, setResolutionLabel] = useState<string | null>(null);
  const [reqLookup, setReqLookup] = useState<RequirementLookupResult | null>(null);
  const [selectedWritingReqId, setSelectedWritingReqId] = useState<string | null>(null);
  const [showCVUpload, setShowCVUpload] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const methods = useForm<AddDocumentForm>({
    resolver: zodResolver(AddDocumentSchema),
    defaultValues: {
      documentType: "STATEMENT_OF_PURPOSE",
      promptSource: "CONSULTANT_PROVIDED",
      mandatoryTopics: "",
      additionalQuestions: "",
    },
    mode: "onBlur",
  });

  const {
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isDirty: formIsDirty },
  } = methods;

  const documentType = watch("documentType") as DocumentType;
  const promptText = watch("promptText");
  const promptUi = getPromptUiConfig(documentType);

  // Track dirty state
  useEffect(() => {
    setIsDirty(formIsDirty);
  }, [formIsDirty]);

  // Load application data
  useEffect(() => {
    loadApplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, studentId]);

  async function loadApplication() {
    setLoading(true);
    setError("");
    try {
      const [res, studentRes, profileRes] = await Promise.all([
        fetch(`/api/application/list?applicationId=${applicationId}&studentId=${studentId}`, { cache: "no-store" }),
        fetch(`/api/application/student?id=${studentId}`, { cache: "no-store" }),
        fetch(`/api/application/profile?studentId=${studentId}&applicationId=${applicationId}`, { cache: "no-store" }),
      ]);

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Application not found");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setApplication(data.application);
      if (studentRes.ok) {
        const studentData = await studentRes.json();
        setStudent(studentData.student);
      }
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setProfile(profileData.profile);
      }

      if (data.application) {
        const app = data.application;
        if (app.universityName && app.programName && app.degree && app.intake && app.intakeYear) {
          try {
            const reqRes = await fetch(
              `/api/requirements/lookup?university=${encodeURIComponent(app.universityName)}&program=${encodeURIComponent(app.programName)}&degree=${encodeURIComponent(app.degree)}&intake=${encodeURIComponent(app.intake)}&intakeYear=${encodeURIComponent(app.intakeYear)}`,
            );
            if (reqRes.ok) {
              const reqData = await reqRes.json();
              setReqLookup(reqData);
            }
          } catch {
            // Requirements lookup is optional
          }
        }
      }
    } catch {
      setError("Failed to load application");
    } finally {
      setLoading(false);
    }
  }

  // Handle document type change
  const onDocumentTypeChange = (type: DocumentType) => {
    const promptUi = getDocumentPromptUi(type);
    setValue("documentType", type);
    setValue("documentTitle", "");
    // Reset prompt-related fields
    setValue("promptText", "");
    setValue("promptSource", "CONSULTANT_PROVIDED");
    setSelectedWritingReqId(null);
    setResolutionPath(null);
    setResolutionLabel(null);
    // Reset advanced fields
    setValue("wordMin", "");
    setValue("wordMax", "");
    setValue("characterLimit", "");
    setValue("pageLimit", "");
    setValue("specialInstructions", "");
    setValue("facultyInstructions", "");
    setValue("formattingInstructions", "");
    setValue("mandatoryTopics", "");
    setValue("additionalQuestions", "");
  };

  // Handle writing requirement selection
  const onWritingReqSelect = (wr: any) => {
    setSelectedWritingReqId(wr.id);
    methods.setValue("documentType", wr.documentType);
    methods.setValue("documentTitle", wr.officialTitle);
    methods.setValue("promptText", wr.promptText);
    methods.setValue("promptSource", "OFFICIAL_VERIFIED");
    methods.setValue("wordMin", wr.wordMin?.toString() || "");
    methods.setValue("wordMax", wr.wordMax?.toString() || "");
    methods.setValue("characterLimit", wr.characterLimit?.toString() || "");
    methods.setValue("pageLimit", wr.pageLimit?.toString() || "");
    methods.setValue("specialInstructions", wr.specialInstructions || "");
    methods.setValue("formattingInstructions", wr.formattingInstructions || "");
  };

  // Clear writing requirement selection (manual entry)
  const onManualEntry = () => {
    setSelectedWritingReqId(null);
    reset({
      documentType: "STATEMENT_OF_PURPOSE",
      promptSource: "CONSULTANT_PROVIDED",
      mandatoryTopics: "",
      additionalQuestions: "",
    });
    methods.setValue("documentTitle", "");
    methods.setValue("promptText", "");
    methods.setValue("promptSource", "CONSULTANT_PROVIDED");
    methods.setValue("wordMin", "");
    methods.setValue("wordMax", "");
    methods.setValue("characterLimit", "");
    methods.setValue("pageLimit", "");
    methods.setValue("specialInstructions", "");
    methods.setValue("facultyInstructions", "");
    methods.setValue("formattingInstructions", "");
    methods.setValue("mandatoryTopics", "");
    methods.setValue("additionalQuestions", "");
  };

  // Auto-resolve prompt
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

      methods.setValue("promptText", resolved.promptText);
      methods.setValue("promptSource", resolved.source);
      methods.setValue("documentTitle", resolved.documentTitle || "");
      methods.setValue("wordMin", resolved.wordMin?.toString() || "");
      methods.setValue("wordMax", resolved.wordMax?.toString() || "");
      methods.setValue("characterLimit", resolved.characterLimit?.toString() || "");
      methods.setValue("pageLimit", resolved.pageLimit?.toString() || "");
      methods.setValue("specialInstructions", resolved.specialInstructions || "");
      methods.setValue("formattingInstructions", resolved.formattingInstructions || "");

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

  // Trigger discovery
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

      methods.setValue("promptText", resolved.promptText);
      methods.setValue("promptSource", resolved.source);
      methods.setValue("documentTitle", resolved.documentTitle || "");
      methods.setValue("wordMin", resolved.wordMin?.toString() || "");
      methods.setValue("wordMax", resolved.wordMax?.toString() || "");
      methods.setValue("characterLimit", resolved.characterLimit?.toString() || "");
      methods.setValue("pageLimit", resolved.pageLimit?.toString() || "");
      methods.setValue("specialInstructions", resolved.specialInstructions || "");
      methods.setValue("formattingInstructions", resolved.formattingInstructions || "");

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

  // Submit handler
  async function onSubmit(data: AddDocumentForm) {
    if (!application) return;
    setSaving(true);
    setError("");

    try {
      // Validate prompt requirement
      if (!data.promptText && promptUi.required) {
        setError(`A prompt is required for this document type — enter text under "${promptUi.label}"${promptUi.primaryLookupLabel ? ` or use '${promptUi.primaryLookupLabel}'` : ""}.`);
        setSaving(false);
        return;
      }

      const res = await fetch("/api/application/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          documentType: data.documentType,
          documentTitle: data.documentTitle || getDocumentTypeLabel(data.documentType),
          promptText: data.promptText,
          promptSource: data.promptSource,
          wordMin: data.wordMin ? parseInt(data.wordMin as any) : undefined,
          wordMax: data.wordMax ? parseInt(data.wordMax as any) : undefined,
          characterLimit: data.characterLimit ? parseInt(data.characterLimit as any) : undefined,
          pageLimit: data.pageLimit ? parseInt(data.pageLimit as any) : undefined,
          specialInstructions: data.specialInstructions,
          facultyInstructions: data.facultyInstructions,
          formattingInstructions: data.formattingInstructions,
          mandatoryTopics: data.mandatoryTopics,
          additionalQuestions: data.additionalQuestions,
          writingRequirementId: selectedWritingReqId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add document");
      }

      const docData = await res.json();
      const newDocId = docData.document?.id;

      if (newDocId) {
        router.push(`/students/${studentId}/applications/${applicationId}/documents/${newDocId}`);
      } else {
        await loadApplication();
        router.push(`/students/${studentId}/applications/${applicationId}`);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to add document");
    } finally {
      setSaving(false);
    }
  }

  // Handle cancel with dirty check
  function handleCancel() {
    if (isDirty || methods.formState.isDirty) {
      if (window.confirm("Discard this document?\n\nYour unsaved changes will be lost.")) {
        router.back();
      }
    } else {
      router.back();
    }
  }

  // CV Upload handler
  const onCVApplied = async () => {
    if (methods.formState.isDirty) {
      try {
        await onSubmit(methods.getValues());
      } catch {
        return;
      }
    }
    loadApplication();
  };

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading...</div></PageContainer>;
  }

  if (!application) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error || "Application not found"}</p>
          <Link href={`/students/${studentId}`} className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">
            ← Back to student
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Compute intake readiness for display
  const readiness = profile !== null && application ? getProfileReadiness(profile, application) : null;
  const firstMissingSlug = readiness?.sections.find(s => s.status === "missing")?.slug;
  const intakeComplete = readiness?.canGenerate ?? false;

  return (
    <FormProvider {...methods}>
      <PageContainer>
        {/* Breadcrumb */}
        <Breadcrumb items={[
          { label: "Students", href: "/students" },
          { label: student ? `${student.firstName} ${student.lastName}` : "Student", href: `/students/${studentId}` },
          { label: application?.universityName || "Application", href: `/students/${studentId}/applications/${applicationId}` },
          { label: "Add Document" },
        ]} />

        {/* Compact Application Context */}
        <div className="mb-6 p-4 bg-dvivid-primary-light border border-dvivid-primary-border rounded-card">
          <p className="text-xs font-medium text-dvivid-primary uppercase tracking-wide mb-1">Application Context</p>
          <p className="text-sm text-dvivid-text-primary font-medium">{application?.universityName}</p>
          <p className="text-sm text-dvivid-text-secondary">{application?.programName} · {application?.degree}</p>
          <p className="text-xs text-dvivid-text-muted mt-1">{application?.country} · {application?.intake} {application?.intakeYear}</p>
        </div>

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-page-title text-dvivid-text-primary">Add Document</h1>
          <p className="text-base text-dvivid-text-secondary mt-1.5">Create a writing task for this application.</p>
        </div>

        {/* Readiness Warning */}
        {readiness && !intakeComplete && (
          <div className="mb-6 p-4 bg-dvivid-warning-light border border-dvivid-warning/30 rounded-card">
            <p className="text-xs font-medium text-dvivid-text-muted uppercase tracking-wide mb-2">Application Information</p>
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
        )}

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Document Basics — Always Open */}
          <SectionCard title="Document Basics" className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Document Type *">
                <select
                  {...methods.register("documentType")}
                  onChange={e => onDocumentTypeChange(e.target.value as DocumentType)}
                  className={inputClass}
                >
                  {DOCUMENT_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {errors.documentType && (
                  <p className="mt-1 text-sm text-dvivid-error">{errors.documentType.message}</p>
                )}
              </FormField>

              <FormField label="Document Title">
                <input
                  className={inputClass}
                  {...methods.register("documentTitle")}
                  placeholder={getDocumentTypeLabel(methods.watch("documentType"))}
                  value={methods.watch("documentTitle") || ""}
                  onChange={e => methods.setValue("documentTitle", e.target.value)}
                />
              </FormField>
            </div>
          </SectionCard>

          {/* Writing Prompt — Always Open */}
          <SectionCard title="Writing Prompt" className="mb-6">
            <FormField
              label={promptUi.required ? promptUi.label + "*" : promptUi.label}
              helper={promptUi.required ? undefined : "Optional — will use D-Vivid default template if left blank"}
            >
              <div className="flex items-center justify-between mb-1.5">
                {(promptUi.primaryLookupLabel || promptUi.secondaryLookupLabel) && (
                  <div className="flex gap-2">
                    {promptUi.primaryLookupLabel && (
                      <button
                        type="button"
                        onClick={handleAutoResolve}
                        disabled={resolving || !application}
                        className="px-3 py-1.5 text-xs font-medium text-dvivid-primary border border-dvivid-primary/30 rounded-button hover:bg-dvivid-primary-light transition-colors disabled:opacity-50"
                      >
                        {resolving ? "Finding requirements..." : promptUi.primaryLookupLabel}
                      </button>
                    )}
                    {promptUi.secondaryLookupLabel && (
                      <button
                        type="button"
                        onClick={handleTriggerDiscovery}
                        disabled={resolving || !application}
                        className="px-3 py-1.5 text-xs font-medium text-dvivid-text-secondary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt transition-colors disabled:opacity-50"
                      >
                        {resolving ? "Searching..." : promptUi.secondaryLookupLabel}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <textarea
                className={`${inputClass} min-h-[160px] resize-y`}
                {...methods.register("promptText")}
                placeholder={promptUi.placeholder}
                rows={8}
              />
              {errors.promptText && (
                <p className="mt-1 text-sm text-dvivid-error">{errors.promptText.message}</p>
              )}
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
            </FormField>
          </SectionCard>

          {/* Prompt Source / Provenance — Always Open (critical) */}
          <SectionCard title="Prompt Source" className="mb-6">
            <FormField
              label="Prompt Source"
              helper="System-controlled sources (Official Verified, D-Vivid Default Template) are set automatically by the platform."
            >
              <select
                className={inputClass}
                {...methods.register("promptSource")}
              >
                {USER_SETTABLE_PROMPT_SOURCES.map(src => (
                  <option key={src} value={src}>{PROMPT_SOURCE_LABELS[src]}</option>
                ))}
              </select>
              {errors.promptSource && (
                <p className="mt-1 text-sm text-dvivid-error">{errors.promptSource.message}</p>
              )}
            </FormField>

            {/* Resolution result card */}
            {resolutionLabel && (
              <div className="mt-3 p-3 bg-dvivid-primary-light border border-dvivid-primary-border rounded-input">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-dvivid-primary uppercase tracking-wide">Prompt Resolved</p>
                    <p className="text-sm text-dvivid-text-primary mt-0.5">{resolutionLabel}</p>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Official Requirements Resolution */}
          {reqLookup?.writingRequirements && reqLookup.writingRequirements.length > 0 && (
            <SectionCard title="Official Requirements Found" className="mb-6">
              <p className="text-sm text-dvivid-text-secondary mb-3">
                Select an official requirement to auto-fill the prompt and all settings.
              </p>
              <div className="space-y-2">
                {reqLookup.writingRequirements.map(wr => (
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
                      onChange={() => onWritingReqSelect(wr)}
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
                <label className={`flex items-start gap-3 p-4 border rounded-input cursor-pointer transition-colors ${
                  selectedWritingReqId === null
                    ? "border-dvivid-primary bg-dvivid-primary-light"
                    : "border-dvivid-border hover:border-dvivid-primary-border"
                }`}>
                  <input
                    type="radio"
                    name="writingReq"
                    checked={selectedWritingReqId === null}
                    onChange={onManualEntry}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-dvivid-text-primary">+ Enter prompt manually</p>
                    <p className="text-sm text-dvivid-text-secondary mt-0.5">Provide your own prompt and configure all settings</p>
                  </div>
                </label>
              </div>
            </SectionCard>
          )}

          {/* Requirements Not Found */}
          {reqLookup && reqLookup.result === "NOT_FOUND" && (
            <SectionCard title="No Verified Requirements Found" className="mb-6">
              <p className="text-sm text-dvivid-text-secondary mb-3">
                No verified university prompt was found for this program and intake.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={onManualEntry}
                  className="w-full px-4 py-2.5 text-dvivid-primary border border-dvivid-primary/30 rounded-button font-medium text-sm hover:bg-dvivid-primary-light transition-colors"
                >
                  Enter Prompt Manually
                </button>
                <button
                  type="button"
                  onClick={handleTriggerDiscovery}
                  disabled={resolving}
                  className="w-full px-4 py-2.5 text-dvivid-text-secondary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt transition-colors disabled:opacity-50"
                >
                  {resolving ? "Searching official pages..." : "Search Official Pages"}
                </button>
              </div>
              <p className="mt-3 text-xs text-dvivid-text-muted">
                If no official information is found, the D-Vivid default template will be used as a starting point.
              </p>
            </SectionCard>
          )}

          {/* Consultant Instruction — Always Open */}
          <SectionCard title="Consultant Instruction" className="mb-6">
            <FormField
              label="Consultant Instruction (optional)"
              helper="Internal guidance for how this document should be written. This is separate from the university's prompt."
            >
              <textarea
                className={`${inputClass} min-h-[80px] resize-y`}
                {...methods.register("specialInstructions")}
                placeholder="e.g. Emphasize the student's research internship over coursework..."
              />
            </FormField>
          </SectionCard>

          {/* Advanced Sections — Collapsed by Default */}
          <details className="group mb-6">
            <summary className="text-sm font-medium text-dvivid-text-secondary cursor-pointer list-none flex items-center gap-2">
              <span className="text-dvivid-text-muted group-open:rotate-90 transition-transform inline-block">▸</span>
              Advanced Options (length, required content, formatting, provenance)
            </summary>
            <div className="pt-4 mt-3 border-t border-dvivid-border-light space-y-6">
              {/* Length Requirements */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {([
                  ["Minimum Words", "wordMin"],
                  ["Maximum Words", "wordMax"],
                  ["Character Limit", "characterLimit"],
                  ["Page Limit", "pageLimit"],
                ] as const).map(([label, key]) => (
                  <FormField key={key} label={label}>
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      {...methods.register(key, {
                        valueAsNumber: undefined,
                        onChange: e => methods.setValue(key, e.target.value === "" ? undefined : Number(e.target.value)),
                        onBlur: e => methods.setValue(key, e.target.value),
                      })}
                      placeholder="—"
                      value={methods.watch(key) || ""}
                      />
                    {errors[key] && (
                      <p className="mt-1 text-sm text-dvivid-error">{errors[key]?.message}</p>
                    )}
                  </FormField>
                ))}
              </div>

              {/* Required Content */}
              <div className="space-y-4">
                <FormField label="Mandatory Topics (one per line)">
                  <textarea
                    className={inputClass}
                    rows={3}
                    {...methods.register("mandatoryTopics")}
                    placeholder="Research methodology\nData ethics\nLeadership experience"
                  />
                </FormField>
                <FormField label="Additional / Specific Questions (one per line)">
                  <textarea
                    className={inputClass}
                    rows={3}
                    {...methods.register("additionalQuestions")}
                    placeholder="Describe a challenge you overcame.\nWhy this specific program?"
                  />
                </FormField>
              </div>

              {/* Formatting */}
              <FormField label="Formatting Rules">
                <textarea
                  className={inputClass}
                  rows={2}
                  {...methods.register("formattingInstructions")}
                  placeholder="12pt font, 1.5 line spacing, 1-inch margins"
                />
              </FormField>

              {/* Prompt Source */}
              <div>
                <FormField
                  label="Prompt Source"
                  helper="System-controlled sources (Official Verified, D-Vivid Default Template) are set automatically by the platform."
                >
                  <select
                    className={inputClass}
                    {...methods.register("promptSource")}
                  >
                    {USER_SETTABLE_PROMPT_SOURCES.map(src => (
                      <option key={src} value={src}>{PROMPT_SOURCE_LABELS[src]}</option>
                    ))}
                  </select>
                  {errors.promptSource && (
                    <p className="mt-1 text-sm text-dvivid-error">{errors.promptSource.message}</p>
                  )}
                </FormField>

                {/* Resolution result card */}
                {resolutionLabel && (
                  <div className="mt-3 p-3 bg-dvivid-primary-light border border-dvivid-primary-border rounded-input">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-dvivid-primary uppercase tracking-wide">Prompt Resolved</p>
                        <p className="text-sm text-dvivid-text-primary mt-0.5">{resolutionLabel}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Faculty Instructions */}
              <FormField label="Faculty / Research Instructions (optional)" className="mb-6">
                <textarea
                  className={inputClass}
                  rows={2}
                  {...methods.register("facultyInstructions")}
                  placeholder="Specific instructions from faculty or research advisor..."
                />
              </FormField>

              {/* Formatting Instructions */}
              <FormField label="Formatting Rules (optional)" className="mb-6">
                <textarea
                  className={inputClass}
                  rows={2}
                  {...methods.register("formattingInstructions")}
                  placeholder="12pt font, 1.5 line spacing, 1-inch margins"
                />
              </FormField>
            </div>
          </details>

          {/* Resolved Official Requirement Card */}
          {selectedWritingReqId && (
            <SectionCard title="Selected Official Requirement" className="mb-6">
              <div className="p-4 bg-dvivid-primary-light border border-dvivid-primary-border rounded-input">
                <p className="text-xs font-medium text-dvivid-primary uppercase tracking-wide mb-1">Official Requirement Selected</p>
                <p className="text-sm font-medium text-dvivid-text-primary">
                  {reqLookup?.writingRequirements?.find(wr => wr.id === selectedWritingReqId)?.officialTitle}
                </p>
                <p className="text-xs text-dvivid-primary mt-1">Source: Verified university requirement</p>
                <button
                  type="button"
                  onClick={onManualEntry}
                  className="mt-3 text-sm text-dvivid-primary hover:underline font-medium"
                >
                  Remove official requirement → enter manually
                </button>
              </div>
            </SectionCard>
          )}

          {/* CV Upload */}
          <CVUpload
            key={studentId}
            studentId={studentId}
            profileRevision={0}
            hasCvDerivedData={false}
            onApplied={onCVApplied}
          />

          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
              <p className="text-sm text-dvivid-error">{error}</p>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex gap-3 justify-end mt-8 pt-6 border-t border-dvivid-border-light">
            <SecondaryButton onClick={handleCancel} disabled={saving}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? "Saving..." : "Create Document"}
            </PrimaryButton>
          </div>
        </form>
      </PageContainer>
  </FormProvider>
  );
}