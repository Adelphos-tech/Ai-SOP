"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  useForm, FormProvider, useFormContext, useFieldArray, Controller,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
} from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { FormField, inputClass, TextAreaField } from "@/components/ui/FormField";
import { IntakeTracker } from "@/components/ui/IntakeTracker";
import { IntakeSidebar, IntakeMobileNav } from "@/components/ui/IntakeSidebar";
import { CVUpload } from "@/components/ui/CVUpload";
import {
  INTAKE_SECTIONS,
  calculateIntakeCompletion,
  getProfileReadiness,
  buildReadinessFromServerResponse,
} from "@/lib/application/intake-completion";
import {
  getCountryQuestionnaire,
  getAvailableCountries,
} from "@/lib/application/country-questionnaire";
import {
  IntakeProfileSchema,
  IntakeProfileForm,
} from "@/lib/forms/intake-profile.schema";

// ============================================================
// 9-SECTION INTAKE PAGE — React Hook Form + Zod
// ============================================================
// RHF owns ALL unsaved editing state. The server-loaded canonical
// profile becomes form values via reset() — no parallel editable
// useState profile exists.
//
// Separations preserved (Phase-1 reliability fixes):
//   - request-token guard: stale fetch may NOT reset() the form
//   - identity reset: studentId/applicationId change clears everything
//   - wizard hold: isDirty keeps the edited section mounted —
//     FIELD CHANGE != NAVIGATION
//   - completion (calculateIntakeCompletion) stays live for progress UI
//     but never controls the rendered section while editing
//   - revision-conditional PUT (409 → reload + message)
//   - CVUpload keyed by studentId; on Applied → reset(server profile)
// ============================================================

interface Application {
  id: string;
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  country: string;
  intake: string;
  intakeYear: string;
  status: string;
}

// ============================================================
// HELPER: Determine next missing section after save
// ============================================================
function getNextMissingSection(
  currentSection: { id: number; slug: string } | null,
  missingSections: Array<{ id: number; slug: string }>
): { slug: string; reason: "next" | "wrap" | "last" | "none" } | null {
  if (!currentSection || missingSections.length === 0) return null;

  // Find missing sections strictly AFTER current section
  const laterMissing = missingSections.filter(s => s.id > currentSection.id);
  if (laterMissing.length > 0) {
    return { slug: laterMissing[0].slug, reason: "next" };
  }

  // No later missing — wrap to first remaining missing
  return { slug: missingSections[0].slug, reason: "wrap" };
}

function sectionCompletionToNav(section: { sectionId: number; slug: string }): { id: number; slug: string } {
  return { id: section.sectionId, slug: section.slug };
}

function getMissingFieldsDisplay(missingFields: string[]): string {
  // Map internal field names to user-friendly labels
  const fieldLabels: Record<string, string> = {
    "first name": "First name",
    "last name": "Last name",
    "nationality": "Nationality",
    "current country": "Current country",
    "education history": "Education history",
    "whyField": "Why this field?",
    "whyNow": "Why now?",
    "academicMotivation": "Academic motivation",
    "skillGaps": "Skill gaps",
    "professionalMotivation": "Professional motivation",
    "expectedLearning": "Expected learning",
    "careerSupport": "Career support",
  };
  if (missingFields.length === 0) return "";
  const labels = missingFields.map(f => fieldLabels[f] || f);
  return labels.join(", ");
}

export default function IntakePage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;
  const stepSlug = params.step as string;

  // "missing" is a wizard mode: shows only the next missing required
  // section, one at a time, until all required information is answered.
  const wizardMode = stepSlug === "missing";
  const routeSection = INTAKE_SECTIONS.find(s => s.slug === stepSlug);
  const currentStep = routeSection?.id || 1;

  const [profileRevision, setProfileRevision] = useState<number>(0);
  const [application, setApplication] = useState<Application | null>(null);
  // students row identity (first_name/last_name/email) — shown in the
  // CV review so the consultant can spot wrong-person uploads.
  const [studentIdentity, setStudentIdentity] = useState<{ firstName?: string; lastName?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Wizard navigation is EXPLICIT STATE — not derived per render from
  // readiness. Set only on identity load / explicit Save & Continue.
  // A field becoming complete while typing MUST NOT move the user.
  const [activeWizardSection, setActiveWizardSection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  // Stale-request token — a response is only applied if it is still the
  // latest load for the current student/application identity.
  const loadTokenRef = useRef(0);
  // Prevent duplicate submissions while a save is in flight.
  const saveInProgressRef = useRef(false);

  const methods = useForm<IntakeProfileForm>({
    resolver: zodResolver(IntakeProfileSchema),
    defaultValues: {},
    mode: "onBlur",
  });
  const { reset, getValues, handleSubmit, watch, formState } = methods;
  const isDirty = formState.isDirty;

  // Load profile + application. Identity change resets ALL id-scoped
  // state — no student-A state may remain observable under student B.
  useEffect(() => {
    loadTokenRef.current++; // invalidate any in-flight load
    reset({});
    setProfileRevision(0);
    setApplication(null);
    setSaveStatus("idle");
    setError("");
    setShowReview(false);
    setActiveWizardSection(null);
    setStudentIdentity(null);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, applicationId]);

  // Warn before closing the browser tab if there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty || saveInProgressRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  async function loadAll() {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError("");
    try {
      const [profileRes, appRes] = await Promise.all([
        fetch(`/api/application/profile?studentId=${studentId}&applicationId=${applicationId}`, { cache: "no-store" }),
        fetch(`/api/application/list?studentId=${studentId}`, { cache: "no-store" }),
      ]);

      if (token !== loadTokenRef.current) return; // superseded by a newer load

      let loadedProfile: any = null;
      let loadedApp: Application | null = null;

      if (profileRes.ok) {
        const data = await profileRes.json();
        if (token !== loadTokenRef.current) return;
        // RHF owns editing state from here — full canonical profile,
        // including fields with no registered input, survives intact.
        loadedProfile = data.profile || {};
        reset(loadedProfile);
        setProfileRevision(typeof data.revision === "number" ? data.revision : 0);
        if (data.student) {
          setStudentIdentity({
            firstName: data.student.firstName,
            lastName: data.student.lastName,
            email: data.student.email,
          });
        }
      }

      if (appRes.ok) {
        const data = await appRes.json();
        if (token !== loadTokenRef.current) return;
        const apps = data.applications || [];
        loadedApp = apps.find((a: Application) => a.id === applicationId) || null;
        setApplication(loadedApp);
      }

      // Wizard: pick the first missing REQUIRED section ONCE per load.
      // This is the only place (besides identity reset) that writes
      // activeWizardSection — field changes can never re-derive it.
      // Only set if not already set (to avoid overwriting explicit navigation).
      if (wizardMode && activeWizardSection === null) {
        const readiness = getProfileReadiness(loadedProfile || getValues(), loadedApp);
        const missing = readiness.sections.filter(s => !s.optional && s.status !== "complete");
        setActiveWizardSection(missing[0]?.slug ?? null);
      }
    } catch {
      if (token !== loadTokenRef.current) return;
      setError("Failed to load data");
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }

  // Save profile — returns readiness data from server response.
  // Duplicate-submission guard: saveInProgressRef blocks concurrent calls.
  const saveProfile = useCallback(async (values: IntakeProfileForm): Promise<{
    revision: number;
    readiness?: { complete: boolean; missingSections: string[]; missingCount: number };
  }> => {
    if (saveInProgressRef.current) {
      throw new Error("Save already in progress.");
    }
    saveInProgressRef.current = true;
    setSaving(true);
    setSaveStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/application/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, profileData: values, expectedRevision: profileRevision }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const revision = data && typeof data.revision === "number" ? data.revision : profileRevision + 1;
        setProfileRevision(revision);
        setSaveStatus("saved");
        reset(values);
        setTimeout(() => setSaveStatus("idle"), 3000);
        return {
          revision,
          readiness: data?.readiness,
        };
      } else if (res.status === 409) {
        // CRITICAL: Do NOT call loadAll() here — it would reset() the form
        // and silently discard the user's unsaved edits. Preserve their work
        // so they can decide to retry or reload.
        const msg = "Profile was updated elsewhere (e.g. CV import). Your current edits are preserved — click Save again to overwrite, or Reload to fetch the latest data.";
        setSaveStatus("error");
        setError(msg);
        throw new Error(msg);
      } else {
        let msg = "Save failed. Please try again.";
        try {
          const data = await res.json();
          msg = data.error || data.message || msg;
        } catch {
          await res.text().catch(() => undefined);
        }
        setSaveStatus("error");
        throw new Error(msg);
      }
    } catch (e: any) {
      setSaveStatus("error");
      throw e;
    } finally {
      saveInProgressRef.current = false;
      setSaving(false);
    }
  }, [studentId, applicationId, profileRevision, reset]);

  // Save & Continue — validates, saves, then deterministically computes next section.
  // Uses server response readiness for navigation — no stale loadAll() race.
  const handleSaveAndContinue = async (values: IntakeProfileForm) => {
    let saveResult;
    try {
      saveResult = await saveProfile(values);
    } catch (err: any) {
      setError(err?.message || "Failed to save. Please try again.");
      return;
    }

    // Determine next section using server-provided readiness (or liveProfile fallback)
    let readiness;
    if (saveResult?.readiness) {
      // Build readiness from server response using helper
      readiness = buildReadinessFromServerResponse(saveResult.readiness.missingSections);
    } else {
      readiness = getProfileReadiness(liveProfile, application);
    }

    const missingRequired = readiness.sections.filter(s => !s.optional && s.status !== "complete");
    const current = currentSection ? { id: currentSection.id, slug: currentSection.slug } : null;

    if (wizardMode) {
      // Determine next missing section
      const missingRequiredNav = missingRequired.map(s => ({ id: s.sectionId, slug: s.slug }));
      const nextResult = getNextMissingSection(current, missingRequiredNav);
      
      if (nextResult) {
        // Advance to next missing section
        setActiveWizardSection(nextResult.slug);
        // NOTE: Do NOT call loadAll() here — it would overwrite activeWizardSection
        // with the first missing section. The server response readiness already
        // confirmed the next section. We only need to refresh form values for the
        // new section, which happens naturally when the section component re-renders
        // with the updated activeWizardSection.
      } else if (missingRequired.length === 0) {
        // All complete — exit wizard to Application Workspace
        router.push(`/students/${studentId}/applications/${applicationId}`);
      } else if (current && missingRequired.length === 1 && missingRequired[0].sectionId === current.id) {
        // Only current section remains incomplete — save succeeded but section not complete
        const missingFields = missingRequired[0].missingFields || [];
        const guidance = missingFields.length > 0
          ? `Your answers were saved, but this section still needs: ${getMissingFieldsDisplay(missingFields)}.`
          : "Your answers were saved, but this section still needs more information.";
        setError(guidance);
      }
      return;
    }

    // Non-wizard mode: navigate to next section or workspace
    const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);
    if (nextSection) {
      router.push(`/students/${studentId}/applications/${applicationId}/intake/${nextSection.slug}`);
    } else {
      router.push(`/students/${studentId}/applications/${applicationId}`);
    }
  };

  // Skip optional section — also save current progress before navigating.
  // Skip intentionally saves without blocking validation (draft semantics).
  async function handleSkip() {
    try {
      await saveProfile(getValues());
    } catch {
      // If save fails on skip, still allow navigation but show warning
      setError("Warning: progress may not have been saved.");
    }
    const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);
    if (nextSection) {
      router.push(`/students/${studentId}/applications/${applicationId}/intake/${nextSection.slug}`);
    } else {
      router.push(`/students/${studentId}/applications/${applicationId}`);
    }
  }

  // Save & Finish — saves current edits and exits to Application Workspace.
  // Does NOT require intake to be complete. Preserves incomplete-state warnings in workspace.
  const handleSaveAndFinish = async () => {
    const values = getValues();
    let saveResult;
    try {
      saveResult = await saveProfile(values);
    } catch (err: any) {
      setError(err?.message || "Failed to save. Please try again.");
      return;
    }
    // Save succeeded — exit to Application Workspace regardless of completeness
    router.push(`/students/${studentId}/applications/${applicationId}`);
  };

  // Save Draft — persists without navigating. Stays on current section.
  const handleSaveDraft = async () => {
    const values = getValues();
    try {
      await saveProfile(values);
    } catch (err: any) {
      setError(err?.message || "Failed to save draft. Please try again.");
    }
  };

  // Internal navigation guard: when there are unsaved edits, confirm before leaving.
  const handleNavigate = useCallback((href: string): boolean => {
    if (!isDirty) return true;
    const ok = window.confirm(
      "You have unsaved changes. Save before leaving?\n\nClick OK to save and continue.\nClick Cancel to discard changes and leave."
    );
    if (ok) {
      // Fire-and-forget save then navigate; user expects this to work
      handleSaveDraft().then(() => {
        router.push(href);
      });
      return false; // Block immediate navigation; router.push after save
    }
    return true; // User chose to discard — allow navigation
  }, [isDirty, router]);

  // Live values for completion/progress — completion stays LIVE but
  // never controls the rendered section while the user is editing.
  const liveProfile = watch();

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading...</div></PageContainer>;
  }

  if (!wizardMode && !routeSection) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error mb-4">Invalid intake section.</p>
          <Link href={`/students/${studentId}/applications/${applicationId}`} className="text-sm text-dvivid-primary hover:underline">
            ← Back to application
          </Link>
        </div>
      </PageContainer>
    );
  }

  const completions = calculateIntakeCompletion(liveProfile, application);
  const readiness = getProfileReadiness(liveProfile, application);
  const firstMissingSlug = readiness.sections.find(s => s.status === "missing")?.slug;
  const intakeComplete = readiness.canGenerate;
  const prevSection = INTAKE_SECTIONS.find(s => s.id === currentStep - 1);
  const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);

  // Wizard mode: the rendered section is EXPLICIT navigation state.
  // activeWizardSection is written ONLY by loadAll (identity load and
  // post-save reload) and the identity-reset effect — never by field
  // edits. missingRequired below is used for display text only.
  const missingRequired = readiness.sections.filter(s => !s.optional && s.status !== "complete");
  const wizardSection = wizardMode
    ? (activeWizardSection ? INTAKE_SECTIONS.find(s => s.slug === activeWizardSection) || null : null)
    : routeSection;
  const currentSection = wizardMode ? wizardSection : routeSection;
  const displayStep = currentSection?.id || currentStep;

  // Wizard completion state — all required answers SAVED (not just typed).
  if (wizardMode && !wizardSection) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <p className="text-lg font-medium text-dvivid-success mb-2">✓ All required information complete</p>
          <p className="text-sm text-dvivid-text-secondary mb-6">The applicant is ready for document generation.</p>
          <Link href={`/students/${studentId}/applications/${applicationId}`}>
            <PrimaryButton>Back to Application →</PrimaryButton>
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <WorkflowStepper
        intakeComplete={intakeComplete}
        firstIncompleteIntakeSlug={firstMissingSlug}
      />
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: application?.universityName || "Application", href: `/students/${studentId}/applications/${applicationId}` },
        { label: wizardMode ? "Missing Information" : currentSection!.label },
      ]} />

      {/* Mobile section nav (visible only below lg breakpoint) */}
      {!wizardMode && (
        <IntakeMobileNav
          studentId={studentId}
          applicationId={applicationId}
          completions={completions}
          readiness={{
            requiredComplete: readiness.requiredComplete,
            requiredTotal: readiness.requiredTotal,
            canGenerate: readiness.canGenerate,
          }}
          onNavigate={handleNavigate}
        />
      )}

      <div className="flex gap-6 items-start">
        {/* Desktop sidebar (visible only at lg+) */}
        {!wizardMode && (
          <IntakeSidebar
            studentId={studentId}
            applicationId={applicationId}
            completions={completions}
            readiness={readiness}
            application={application}
            studentName={studentIdentity ? `${studentIdentity.firstName || ""} ${studentIdentity.lastName || ""}`.trim() : undefined}
            onNavigate={handleNavigate}
          />
        )}

        {/* Main content area */}
        <main className="flex-1 min-w-0">
          {/* Keep existing tracker for visual continuity */}
          {!wizardMode && (
            <IntakeTracker
              studentId={studentId}
              applicationId={applicationId}
              currentStep={currentStep}
              completions={completions}
            />
          )}

          {/* Save status indicator */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-page-title text-dvivid-text-primary">
                {wizardMode ? "Complete missing information" : currentSection!.label}
              </h1>
              {currentSection!.optional && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-dvivid-text-muted">Optional</span>
              )}
            </div>
            <SaveStatusIndicator status={saveStatus} saving={saving} dirty={isDirty} />
          </div>

          {wizardMode ? (
            <p className="text-sm text-dvivid-text-secondary mb-6">
              <span className="font-medium text-dvivid-text-primary">{currentSection!.label}</span> — {missingRequired.length} required answer{missingRequired.length !== 1 ? "s" : ""} remaining. {currentSection!.description}
              {(() => {
                const fields = missingRequired.find(s => s.slug === currentSection!.slug)?.missingFields || [];
                return fields.length > 0 ? (
                  <span className="block mt-1 text-dvivid-warning font-medium">
                    Missing: {fields.join(", ")}
                  </span>
                ) : null;
              })()}
            </p>
          ) : (
            <p className="text-sm text-dvivid-text-secondary mb-6">{currentSection!.description}</p>
          )}

          {error && (
            <div className="mb-4 p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input text-sm text-dvivid-error flex items-start justify-between gap-3">
              <span className="flex-1">{error}</span>
              {error.includes("Reload") && (
                <button
                  type="button"
                  onClick={() => { setError(""); loadAll(); }}
                  className="text-xs font-medium underline hover:opacity-80 flex-shrink-0"
                >
                  Reload latest data
                </button>
              )}
            </div>
          )}

          <FormProvider {...methods}>
            <form onSubmit={e => { e.preventDefault(); handleSubmit(handleSaveAndContinue)(e); }}>
            {/* CV Upload — only on Section 1 */}
            {displayStep === 1 && (
              <div className="mb-6">
                <CVUpload
                  key={studentId}
                  studentId={studentId}
                  profileRevision={profileRevision}
                  studentIdentity={studentIdentity || undefined}
                  hasCvDerivedData={["education", "experience", "projects", "achievements"].some(
                    k => Array.isArray((liveProfile as any)?.[k]) &&
                      (liveProfile as any)[k].some((it: any) => String(it?.id ?? "").startsWith("cv-")),
                  )}
                  onApplied={async () => {
                    // Preserve typed-but-unsaved edits before reloading —
                    // a bare loadAll() would silently wipe them.
                    if (isDirty) {
                      try {
                        await saveProfile(getValues());
                      } catch {
                        // Save failed — don't wipe the user's input; let them retry.
                        return;
                      }
                    }
                    loadAll();
                  }}
                />
              </div>
            )}

            {/* Section content */}
            <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6 mb-6">
              {renderSection(displayStep, application)}
            </div>

            {/* Navigation / Action Bar */}
            <div className="flex flex-col gap-3">
              {/* Primary actions row */}
              <div className="flex justify-between items-center flex-wrap gap-3">
                {wizardMode ? (
                  <Link href={`/students/${studentId}/applications/${applicationId}`}>
                    <SecondaryButton>← Back to application</SecondaryButton>
                  </Link>
                ) : prevSection ? (
                  <Link href={`/students/${studentId}/applications/${applicationId}/intake/${prevSection.slug}`}>
                    <SecondaryButton>← Back</SecondaryButton>
                  </Link>
                ) : (
                  <Link href={`/students/${studentId}/applications/${applicationId}`}>
                    <SecondaryButton>← Back</SecondaryButton>
                  </Link>
                )}

                <div className="flex gap-3 items-center flex-wrap">
                  {!wizardMode && (
                    <SecondaryButton
                      type="button"
                      disabled={saving || !isDirty}
                      onClick={handleSaveDraft}
                    >
                      {saving && saveStatus === "saving" ? "Saving..." : "Save Draft"}
                    </SecondaryButton>
                  )}
                  {!wizardMode && currentSection!.optional && (
                    <SecondaryButton onClick={handleSkip}>Skip for now</SecondaryButton>
                  )}
                  {wizardMode && missingRequired.length > 1 && (
                    <PrimaryButton type="submit" disabled={saving}>
                      Save & Next Missing Answer →
                    </PrimaryButton>
                  )}
                  {wizardMode && (
                    <PrimaryButton
                      type="button"
                      disabled={saving}
                      onClick={handleSaveAndFinish}
                    >
                      Save & Finish →
                    </PrimaryButton>
                  )}
                  {!wizardMode && (
                    <PrimaryButton type="submit" disabled={saving}>
                      {saving ? "Saving..." : nextSection ? "Save & Continue →" : "Save & Finish →"}
                    </PrimaryButton>
                  )}
                </div>
              </div>

              {/* Secondary actions row */}
              <div className="flex justify-between items-center flex-wrap gap-3 pt-1">
                {wizardMode ? (
                  <Link
                    href={`/students/${studentId}/applications/${applicationId}/intake/student-details`}
                    className="text-sm text-dvivid-text-secondary hover:text-dvivid-primary"
                  >
                    Review all information
                  </Link>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowReview(true)}
                      className="text-sm text-dvivid-text-secondary hover:text-dvivid-primary flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                      Review Application
                    </button>
                    <Link
                      href={`/students/${studentId}/applications/${applicationId}`}
                      className="text-sm text-dvivid-text-secondary hover:text-dvivid-primary"
                    >
                      Exit to application
                    </Link>
                  </div>
                )}
                <span />
              </div>
            </div>
            </form>
          </FormProvider>

          {/* Review Application Panel */}
          {showReview && (
            <ReviewApplicationPanel
              studentId={studentId}
              applicationId={applicationId}
              readiness={readiness}
              completions={completions}
              application={application}
              onClose={() => setShowReview(false)}
            />
          )}
        </main>
      </div>
    </PageContainer>
  );
}

// ============================================================
// SAVE STATUS INDICATOR
// ============================================================
function SaveStatusIndicator({ status, saving, dirty }: { status: string; saving: boolean; dirty: boolean }) {
  if (saving || status === "saving") {
    return <span className="text-sm text-dvivid-text-muted">Saving...</span>;
  }
  if (status === "saved") {
    return <span className="text-sm text-dvivid-success">✓ Saved</span>;
  }
  if (status === "error") {
    return <span className="text-sm text-dvivid-error">Save failed</span>;
  }
  // idle: only show "Unsaved changes" when the profile was actually edited
  if (dirty) {
    return <span className="text-sm text-dvivid-text-muted">Unsaved changes</span>;
  }
  return null;
}

// ============================================================
// RHF FIELD HELPERS
// ============================================================
function FieldError({ name }: { name: string }) {
  const { formState: { errors } } = useFormContext<IntakeProfileForm>();
  const err = name.split(".").reduce<any>((acc, k) => acc?.[k], errors);
  const message = err?.message;
  return message ? <p className="text-xs text-dvivid-error mt-1">{String(message)}</p> : null;
}

function Area({ name, rows, placeholder }: { name: string; rows?: number; placeholder?: string }) {
  const { control } = useFormContext<IntakeProfileForm>();
  return (
    <Controller
      control={control}
      name={name as any}
      render={({ field }) => (
        <TextAreaField value={(field.value ?? "") as string} onChange={field.onChange} rows={rows} placeholder={placeholder} />
      )}
    />
  );
}

function SkillListInput({ name, placeholder }: { name: string; placeholder?: string }) {
  const { control } = useFormContext<IntakeProfileForm>();
  return (
    <Controller
      control={control}
      name={name as any}
      render={({ field }) => (
        <input
          className={inputClass}
          value={Array.isArray(field.value) ? field.value.join(", ") : String(field.value ?? "")}
          onChange={e => field.onChange(e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
          placeholder={placeholder}
        />
      )}
    />
  );
}

// ============================================================
// SECTION RENDERERS
// ============================================================
function renderSection(step: number, application: any): React.ReactNode {
  switch (step) {
    case 1: return <StudentDetailsSection />;
    case 2: return <FieldMotivationSection />;
    case 3: return <AcademicsProjectsSection />;
    case 4: return <WorkExperienceSection />;
    case 5: return <MastersMotivationSection />;
    case 6: return <CountryQuestionsSection application={application} />;
    case 7: return <SubjectRequirementsSection />;
    case 8: return <UniversityRequirementsSection application={application} />;
    case 9: return <CareerGoalsSection />;
    default: return null;
  }
}

// ============================================================
// SECTION 1: STUDENT DETAILS
// ============================================================
function StudentDetailsSection() {
  const { register, control } = useFormContext<IntakeProfileForm>();
  const edu = useFieldArray({ control: control as any, name: "education", keyName: "_key" });

  return (
    <div className="space-y-6">
      {/* Personal */}
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Personal Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="First Name" required>
            <input className={inputClass} placeholder="John" {...register("personalData.firstName")} autoComplete="given-name" />
          </FormField>
          <FormField label="Last Name" required>
            <input className={inputClass} placeholder="Doe" {...register("personalData.lastName")} autoComplete="family-name" />
          </FormField>
          <FormField label="Email">
            <input className={inputClass} type="email" placeholder="john@example.com" {...register("personalData.email")} autoComplete="email" />
            <FieldError name="personalData.email" />
          </FormField>
          <FormField label="Phone">
            <input className={inputClass} type="tel" placeholder="+91 98765 43210" {...register("personalData.phone")} autoComplete="tel" />
          </FormField>
          <FormField label="Date of Birth">
            <input type="date" className={inputClass} {...register("personalData.dateOfBirth")} autoComplete="bday" />
          </FormField>
          <FormField label="Nationality" required>
            <input className={inputClass} placeholder="Indian" {...register("personalData.nationality")} autoComplete="off" />
          </FormField>
          <FormField label="Current City" required>
            <input className={inputClass} placeholder="Mumbai" {...register("personalData.currentCity")} autoComplete="address-level2" />
          </FormField>
          <FormField label="Current Country" required>
            <input className={inputClass} placeholder="India" {...register("personalData.currentCountry")} autoComplete="country-name" />
          </FormField>
        </div>
      </div>

      {/* Education */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-dvivid-text-primary">Education</h3>
          <button type="button" onClick={() => edu.append({
            id: crypto.randomUUID(),
            level: "", institution: "", degree: "", specialization: "",
            startYear: "", endYear: "", cgpa: "", cgpaScale: "10",
            percentage: "", backlogs: "", status: "",
          } as any)} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Education</button>
        </div>
        {edu.fields.length === 0 ? (
          <div className="py-8 px-4 bg-dvivid-surface-alt rounded-card border border-dvivid-border border-dashed flex flex-col items-center gap-3 text-center">
            <svg className="w-8 h-8 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            </svg>
            <p className="text-sm text-dvivid-text-muted">No education records yet.</p>
            <p className="text-xs text-dvivid-text-secondary">Click <span className="font-medium text-dvivid-primary">Add Education</span> to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {edu.fields.map((f, i) => (
              <div key={f._key} className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
                <input type="hidden" {...register(`education.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-dvivid-border-light">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">{i + 1}</span>
                    <span className="text-sm font-semibold text-dvivid-text-primary">Education</span>
                  </div>
                  <button type="button" onClick={() => edu.remove(i)} className="text-sm text-dvivid-error hover:underline font-medium">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Degree Level" required>
                    <select className={inputClass} {...register(`education.${i}.level` as any)}>
                      <option value="">Select level</option>
                      <option value="10th">10th Grade</option>
                      <option value="12th">12th Grade</option>
                      <option value="Diploma">Diploma</option>
                      <option value="Bachelor's">Bachelor's</option>
                      <option value="Master's">Master's</option>
                      <option value="PhD">PhD</option>
                    </select>
                  </FormField>
                  <FormField label="Institution / University" required>
                    <input className={inputClass} placeholder="IIT Bombay" {...register(`education.${i}.institution` as any)} />
                  </FormField>
                  <FormField label="Field / Major">
                    <input className={inputClass} placeholder="Computer Science" {...register(`education.${i}.specialization` as any)} />
                  </FormField>
                  <FormField label="CGPA / GPA">
                    <input className={inputClass} placeholder="8.5" {...register(`education.${i}.cgpa` as any)} />
                  </FormField>
                  <FormField label="Maximum GPA Scale">
                    <input className={inputClass} placeholder="10" {...register(`education.${i}.cgpaScale` as any)} />
                  </FormField>
                  <FormField label="Start Year">
                    <input className={inputClass} placeholder="2020" {...register(`education.${i}.startYear` as any)} />
                  </FormField>
                  <FormField label="Graduation Year">
                    <input className={inputClass} placeholder="2024" {...register(`education.${i}.endYear` as any)} />
                  </FormField>
                  <FormField label="Backlogs (if any)">
                    <input className={inputClass} placeholder="0" {...register(`education.${i}.backlogs` as any)} />
                  </FormField>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SECTION 2: FIELD MOTIVATION
// ============================================================
function FieldMotivationSection() {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
        <FormField label="Why did you choose this field of study?" helper="Optional — helps the AI understand your motivation.">
          <Area name="fieldMotivation" rows={8} placeholder="I first became interested in computer science when..." />
        </FormField>
      </div>

      <div className="bg-dvivid-surface-alt border border-dvivid-border rounded-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-dvivid-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-sm font-semibold text-dvivid-text-primary">Helper prompts</p>
        </div>
        <ul className="text-sm text-dvivid-text-secondary space-y-2 list-disc list-inside">
          <li>What first interested you in this field?</li>
          <li>Was there a course, project, person or experience that influenced you?</li>
          <li>Why do you enjoy studying this subject?</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 3: ACADEMICS & PROJECTS
// ============================================================
function AcademicsProjectsSection() {
  const { register, control } = useFormContext<IntakeProfileForm>();
  const projects = useFieldArray({ control: control as any, name: "projects", keyName: "_key" });
  const subjects = useFieldArray({ control: control as any, name: "subjects", keyName: "_key" });

  return (
    <div className="space-y-8">
      {/* Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-dvivid-text-primary">Projects</h3>
          <button type="button" onClick={() => projects.append({
            id: crypto.randomUUID(),
            name: "", type: "", description: "", role: "",
            objective: "", technologies: "", methods: "",
            outcome: "", challenges: "", whatLearned: "", whyChosen: "",
          } as any)} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Project</button>
        </div>
        {projects.fields.length === 0 ? (
          <div className="py-8 px-4 bg-dvivid-surface-alt rounded-card border border-dvivid-border border-dashed flex flex-col items-center gap-3 text-center">
            <svg className="w-8 h-8 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            <p className="text-sm text-dvivid-text-muted">No projects yet.</p>
            <p className="text-xs text-dvivid-text-secondary">Click <span className="font-medium text-dvivid-primary">Add Project</span> to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.fields.map((f, i) => (
              <div key={f._key} className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
                <input type="hidden" {...register(`projects.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-dvivid-border-light">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">{i + 1}</span>
                    <span className="text-sm font-semibold text-dvivid-text-primary">Project</span>
                  </div>
                  <button type="button" onClick={() => projects.remove(i)} className="text-sm text-dvivid-error hover:underline font-medium">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Project Name" required><input className={inputClass} {...register(`projects.${i}.name` as any)} /></FormField>
                  <FormField label="Project Type"><input className={inputClass} placeholder="Academic / Personal / Research" {...register(`projects.${i}.type` as any)} /></FormField>
                  <FormField label="Your Role"><input className={inputClass} {...register(`projects.${i}.role` as any)} /></FormField>
                  <FormField label="Tools / Technologies"><input className={inputClass} {...register(`projects.${i}.technologies` as any)} /></FormField>
                  <FormField label="Objective / Problem" className="md:col-span-2"><input className={inputClass} {...register(`projects.${i}.objective` as any)} /></FormField>
                  <FormField label="Description" className="md:col-span-2"><Area name={`projects.${i}.description`} rows={3} /></FormField>
                  <FormField label="Methods Used"><input className={inputClass} {...register(`projects.${i}.methods` as any)} /></FormField>
                  <FormField label="Outcome"><input className={inputClass} {...register(`projects.${i}.outcome` as any)} /></FormField>
                  <FormField label="Challenges"><input className={inputClass} {...register(`projects.${i}.challenges` as any)} /></FormField>
                  <FormField label="What You Learned"><input className={inputClass} {...register(`projects.${i}.whatLearned` as any)} /></FormField>
                  <FormField label="Why You Chose This Project" className="md:col-span-2"><input className={inputClass} {...register(`projects.${i}.whyChosen` as any)} /></FormField>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subjects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-dvivid-text-primary">Subjects Learned</h3>
          <button type="button" onClick={() => subjects.append({ id: crypto.randomUUID(), name: "", topics: "", relevance: "" } as any)} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Subject</button>
        </div>
        {subjects.fields.length === 0 ? (
          <div className="py-8 px-4 bg-dvivid-surface-alt rounded-card border border-dvivid-border border-dashed flex flex-col items-center gap-3 text-center">
            <svg className="w-8 h-8 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-sm text-dvivid-text-muted">No subjects yet.</p>
            <p className="text-xs text-dvivid-text-secondary">Click <span className="font-medium text-dvivid-primary">Add Subject</span> to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {subjects.fields.map((f, i) => (
              <div key={f._key} className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
                <input type="hidden" {...register(`subjects.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-dvivid-border-light">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">{i + 1}</span>
                    <span className="text-sm font-semibold text-dvivid-text-primary">Subject</span>
                  </div>
                  <button type="button" onClick={() => subjects.remove(i)} className="text-sm text-dvivid-error hover:underline font-medium">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Subject Name" required><input className={inputClass} {...register(`subjects.${i}.name` as any)} /></FormField>
                  <FormField label="Important Topics"><input className={inputClass} {...register(`subjects.${i}.topics` as any)} /></FormField>
                  <FormField label="Relevance to Future Study"><input className={inputClass} {...register(`subjects.${i}.relevance` as any)} /></FormField>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skills */}
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Skills</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Technical Skills" helper="Comma-separated"><SkillListInput name="skills.technical" placeholder="Machine Learning, Data Analysis" /></FormField>
          <FormField label="Tools" helper="Comma-separated"><SkillListInput name="skills.tools" placeholder="Git, JIRA, Tableau" /></FormField>
          <FormField label="Software" helper="Comma-separated"><SkillListInput name="skills.software" placeholder="MATLAB, AutoCAD" /></FormField>
          <FormField label="Programming Languages" helper="Comma-separated"><SkillListInput name="skills.programming" placeholder="Python, Java, C++" /></FormField>
          <FormField label="Domain Skills" helper="Comma-separated"><SkillListInput name="skills.domain" placeholder="Financial Modeling, Circuit Design" /></FormField>
          <FormField label="Soft Skills" helper="Comma-separated"><SkillListInput name="skills.soft" placeholder="Leadership, Communication" /></FormField>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 4: WORK EXPERIENCE
// ============================================================
function WorkExperienceSection() {
  const { register, control } = useFormContext<IntakeProfileForm>();
  const exp = useFieldArray({ control: control as any, name: "experience", keyName: "_key" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-dvivid-text-primary">Work Experience</h3>
        <button type="button" onClick={() => exp.append({
          id: crypto.randomUUID(),
          type: "", organization: "", role: "", location: "",
          startDate: "", endDate: "", currentlyWorking: false,
          responsibilities: "", achievements: "", skillsUsed: "",
          keyLearning: "", relevanceToMasters: "",
        } as any)} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Experience</button>
      </div>
      {exp.fields.length === 0 ? (
        <div className="py-8 px-4 bg-dvivid-surface-alt rounded-card border border-dvivid-border border-dashed flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 6.612 23.931 23.931 0 013 13.255m0 0A23.93 23.93 0 0012 21c3.866 0 7.356-2.212 9-5.545m0-5.255A23.93 23.93 0 0012 3c-3.866 0-7.356 2.212-9 5.545" />
          </svg>
          <p className="text-sm text-dvivid-text-muted">No experience records yet.</p>
          <label className="flex items-center justify-center gap-2 cursor-pointer mt-1">
            <input type="checkbox" {...register("noWorkExperience")} />
            <span className="text-sm text-dvivid-text-secondary">
              This applicant has no work experience (e.g., fresher)
            </span>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {exp.fields.map((f, i) => (
            <div key={f._key} className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
              <input type="hidden" {...register(`experience.${i}.id` as any)} />
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-dvivid-border-light">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">{i + 1}</span>
                  <span className="text-sm font-semibold text-dvivid-text-primary">Experience</span>
                </div>
                <button type="button" onClick={() => exp.remove(i)} className="text-sm text-dvivid-error hover:underline font-medium">Remove</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Type" required>
                  <select className={inputClass} {...register(`experience.${i}.type` as any)}>
                    <option value="">Select type</option>
                    <option value="Internship">Internship</option>
                    <option value="Full-time Job">Full-time Job</option>
                    <option value="Part-time Job">Part-time Job</option>
                    <option value="Research Role">Research Role</option>
                    <option value="Other">Other Experience</option>
                  </select>
                </FormField>
                <FormField label="Organization" required><input className={inputClass} {...register(`experience.${i}.organization` as any)} /></FormField>
                <FormField label="Role" required><input className={inputClass} {...register(`experience.${i}.role` as any)} /></FormField>
                <FormField label="Location"><input className={inputClass} {...register(`experience.${i}.location` as any)} /></FormField>
                <FormField label="Start Date"><input type="month" className={inputClass} {...register(`experience.${i}.startDate` as any)} /></FormField>
                <Controller
                  control={control}
                  name={`experience.${i}.currentlyWorking` as any}
                  render={({ field }) => (
                    <FormField label="End Date">
                      <input type="month" className={inputClass} disabled={field.value === true} {...register(`experience.${i}.endDate` as any)} />
                    </FormField>
                  )}
                />
                <FormField label="Currently Working" className="md:col-span-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" {...register(`experience.${i}.currentlyWorking` as any)} />
                    <span className="text-sm text-dvivid-text-secondary">I currently work here</span>
                  </label>
                </FormField>
                <FormField label="Responsibilities" className="md:col-span-2"><Area name={`experience.${i}.responsibilities`} rows={3} /></FormField>
                <FormField label="Achievements" className="md:col-span-2"><Area name={`experience.${i}.achievements`} rows={2} /></FormField>
                <FormField label="Skills Used"><input className={inputClass} {...register(`experience.${i}.skillsUsed` as any)} /></FormField>
                <FormField label="Key Learning"><input className={inputClass} {...register(`experience.${i}.keyLearning` as any)} /></FormField>
                <FormField label="Relevance to Master's" className="md:col-span-2"><input className={inputClass} {...register(`experience.${i}.relevanceToMasters` as any)} /></FormField>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SECTION 5: MASTER'S MOTIVATION
// ============================================================
function MastersMotivationSection() {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">1</span>
          Core Motivation
        </h3>
        <div className="space-y-4">
          <FormField label="Why do you want to pursue a master's degree in this specific field?" required>
            <Area name="mastersMotivation.whyField" rows={4} placeholder="I want to pursue a master's in this field because..." />
          </FormField>
          <FormField label="Why master's now?">
            <Area name="mastersMotivation.whyNow" rows={3} placeholder="Now is the right time because..." />
          </FormField>
          <FormField label="Knowledge/skill gaps you want to address">
            <Area name="mastersMotivation.skillGaps" rows={3} placeholder="I want to address gaps in..." />
          </FormField>
        </div>
      </div>

      <div className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">2</span>
          Supporting Motivation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Academic motivation"><Area name="mastersMotivation.academicMotivation" rows={3} /></FormField>
          <FormField label="Professional motivation"><Area name="mastersMotivation.professionalMotivation" rows={3} /></FormField>
          <FormField label="Expected learning"><Area name="mastersMotivation.expectedLearning" rows={3} /></FormField>
          <FormField label="How master's supports career plans"><Area name="mastersMotivation.careerSupport" rows={3} /></FormField>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 6: COUNTRY QUESTIONS
// ============================================================
function CountryQuestionsSection({ application }: { application: any }) {
  const { register, control, watch, setValue } = useFormContext<IntakeProfileForm>();
  const countryCode = watch("countryQuestionnaire.countryCode") || application?.country || "";
  const questionnaire = getCountryQuestionnaire(countryCode);
  const countries = getAvailableCountries();

  return (
    <div className="space-y-4">
      <FormField label="Select Destination Country" required>
        <Controller
          control={control}
          name="countryQuestionnaire.countryCode"
          render={({ field }) => (
            <select
              className={inputClass}
              value={field.value ?? countryCode}
              onChange={e => {
                field.onChange(e.target.value);
                // Changing destination clears the previous country's answers
                setValue("countryQuestionnaire.answers" as any, {});
              }}
            >
              <option value="">Select country</option>
              {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              <option value="OTHER">Other</option>
            </select>
          )}
        />
      </FormField>

      {countryCode && (
        <div className="bg-dvivid-surface-alt/50 border border-dvivid-border rounded-card p-5 space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-dvivid-border-light">
            <svg className="w-5 h-5 text-dvivid-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-dvivid-text-primary">
              Questions for <span className="text-dvivid-primary">{questionnaire.countryName}</span>
            </p>
          </div>
          {questionnaire.questions.map(q => (
            <FormField key={q.id} label={q.label} required={q.required} helper={q.helper}>
              <Area name={`countryQuestionnaire.answers["${q.id}"]`} rows={4} placeholder={q.placeholder} />
            </FormField>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SECTION 7: SUBJECT REQUIREMENTS
// ============================================================
function SubjectRequirementsSection() {
  const { register, control } = useFormContext<IntakeProfileForm>();
  const notes = useFieldArray({ control: control as any, name: "subjectRequirements.notes", keyName: "_key" });

  return (
    <div className="space-y-4">
      <p className="text-sm text-dvivid-text-secondary">
        Capture subject/program-specific requirements such as required academic topics, prerequisite subjects,
        portfolio expectations, technical competencies, or special questions from the program.
      </p>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-dvivid-text-primary">Consultant-Added Notes</h3>
        <button type="button" onClick={() => notes.append({ id: crypto.randomUUID(), type: "consultant", content: "" } as any)} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Note</button>
      </div>

      {notes.fields.length === 0 ? (
        <div className="py-8 px-4 bg-dvivid-surface-alt rounded-card border border-dvivid-border border-dashed flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-dvivid-text-muted">No notes added.</p>
          <p className="text-xs text-dvivid-text-secondary">Click <span className="font-medium text-dvivid-primary">Add Note</span> to record a requirement.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.fields.map((f, i) => (
            <div key={f._key} className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
              <input type="hidden" {...register(`subjectRequirements.notes.${i}.id` as any)} />
              <input type="hidden" {...register(`subjectRequirements.notes.${i}.type` as any)} />
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-dvivid-border-light">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">{i + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-dvivid-primary-light text-dvivid-primary font-medium">Consultant Added</span>
                </div>
                <button type="button" onClick={() => notes.remove(i)} className="text-sm text-dvivid-error hover:underline font-medium">Remove</button>
              </div>
              <Area name={`subjectRequirements.notes.${i}.content`} rows={3} placeholder="Enter requirement note..." />
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-input p-3">
        <p className="text-sm text-amber-800">
          <strong>Note:</strong> Consultant-added notes are clearly distinguished from official university requirements.
          They supplement but do not replace verified official source text.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 8: PROGRAM / UNIVERSITY INFORMATION
// ============================================================
// Document-writing requirements (prompt, word limits, topics, questions,
// formatting) have been MOVED to document creation. This section now only
// collects reusable application-level context: official source URL for
// program/university information. Each document owns its own writing
// requirements independently.
// ============================================================
function UniversityRequirementsSection({ application }: { application: any }) {
  const { register, watch } = useFormContext<IntakeProfileForm>();
  const officialSourceUrl = watch("universityRequirements.officialSourceUrl");

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-input p-4">
        <p className="text-sm text-blue-900">
          <strong>Document writing requirements are now collected per document.</strong>
          {" "}When you create a document (SOP, Visa SOP, Essay, LOR, etc.), you enter
          its specific prompt, word limits, topics, questions, and formatting there.
          This section only stores reusable program/university context.
        </p>
      </div>

      <FormField label="Official Source URL" className="md:col-span-2">
        <input
          className={inputClass}
          {...register("universityRequirements.officialSourceUrl")}
          placeholder="https://university.edu/program/admissions"
        />
      </FormField>

      {officialSourceUrl && (
        <div className="bg-blue-50 border border-blue-200 rounded-input p-3">
          <p className="text-sm text-blue-800">
            <strong>Official source:</strong> This URL is used for program/university
            context. Document-specific requirements are resolved per document.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SECTION 9: CAREER GOALS
// ============================================================
function CareerGoalsSection() {
  const { register } = useFormContext<IntakeProfileForm>();
  return (
    <div className="space-y-6">
      {/* Short-term */}
      <div className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">1</span>
          Short-Term Goal
        </h3>
        <div className="space-y-4">
          <FormField label="What role do you want after graduation?" required>
            <Area name="careerGoals.shortTerm.role" rows={2} placeholder="I want to work as a..." />
          </FormField>
          <FormField label="Which industry?"><input className={inputClass} {...register("careerGoals.shortTerm.industry")} placeholder="Technology / Finance / Healthcare" /></FormField>
          <FormField label="Preferred responsibilities?"><Area name="careerGoals.shortTerm.responsibilities" rows={2} /></FormField>
          <FormField label="Preferred country/location (if relevant)"><input className={inputClass} {...register("careerGoals.shortTerm.location")} /></FormField>
        </div>
      </div>

      {/* Long-term */}
      <div className="bg-white border border-dvivid-border rounded-card p-5 relative overflow-hidden border-l-4 border-l-dvivid-primary">
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-dvivid-primary-light flex items-center justify-center text-xs font-bold text-dvivid-primary">2</span>
          Long-Term Goal
        </h3>
        <div className="space-y-4">
          <FormField label="Where do you see yourself in 5–10 years?" required>
            <Area name="careerGoals.longTerm.vision" rows={3} placeholder="In 5-10 years, I see myself..." />
          </FormField>
          <FormField label="Leadership/technical/business goals?"><Area name="careerGoals.longTerm.goals" rows={2} /></FormField>
          <FormField label="Impact you want to create?"><Area name="careerGoals.longTerm.impact" rows={2} /></FormField>
          <FormField label="Plans for home country (if applicable)"><Area name="careerGoals.longTerm.homeCountryPlans" rows={2} /></FormField>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REVIEW APPLICATION PANEL
// ============================================================
function ReviewApplicationPanel({
  studentId,
  applicationId,
  readiness,
  completions,
  application,
  onClose,
}: {
  studentId: string;
  applicationId: string;
  readiness: {
    requiredComplete: number;
    requiredTotal: number;
    optionalComplete: number;
    optionalTotal: number;
    canGenerate: boolean;
    weakAreas: string[];
  };
  completions: import("@/lib/application/intake-completion").SectionCompletion[];
  application: Application | null;
  onClose: () => void;
}) {
  const basePath = `/students/${studentId}/applications/${applicationId}/intake`;

  return (
    <div className="mt-6 bg-white border border-dvivid-border rounded-card shadow-card p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-card-title text-dvivid-text-primary">Review Application</h2>
          <p className="text-sm text-dvivid-text-secondary mt-1">
            {application?.universityName} · {application?.programName}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-button hover:bg-dvivid-surface-alt text-dvivid-text-secondary"
          title="Close review"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Overall status */}
      <div className={`rounded-card p-4 mb-5 ${
        readiness.canGenerate
          ? "bg-dvivid-success-light border border-dvivid-success/20"
          : "bg-dvivid-warning-light border border-dvivid-warning/20"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          {readiness.canGenerate ? (
            <>
              <svg className="w-5 h-5 text-dvivid-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-semibold text-dvivid-success">Ready for document generation</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-dvivid-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-semibold text-dvivid-warning">{readiness.weakAreas.length} required section{readiness.weakAreas.length !== 1 ? "s" : ""} incomplete</span>
            </>
          )}
        </div>
        <p className="text-sm text-dvivid-text-secondary">
          {readiness.requiredComplete}/{readiness.requiredTotal} required complete
          {readiness.optionalTotal > 0 && ` · ${readiness.optionalComplete}/${readiness.optionalTotal} optional complete`}
        </p>
      </div>

      {/* Section list */}
      <div className="space-y-2">
        {completions.map((section) => {
          const isComplete = section.status === "complete";
          const isMissing = section.status === "missing";
          const hasMissingFields = section.missingFields && section.missingFields.length > 0;

          return (
            <div
              key={section.slug}
              className={`flex items-start gap-3 p-3 rounded-lg ${
                isMissing ? "bg-dvivid-warning-light/50" : "bg-dvivid-surface-alt"
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {isComplete ? (
                  <div className="w-5 h-5 rounded-full bg-dvivid-primary flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-dvivid-warning flex items-center justify-center">
                    <span className="text-[10px] font-bold text-dvivid-warning">{section.sectionId}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <Link
                    href={`${basePath}/${section.slug}`}
                    onClick={onClose}
                    className="text-sm font-medium text-dvivid-text-primary hover:text-dvivid-primary"
                  >
                    {section.label}
                    {section.optional && <span className="text-dvivid-text-muted font-normal"> (optional)</span>}
                  </Link>
                  <span className={`text-xs font-medium ${
                    isComplete ? "text-dvivid-success" : isMissing ? "text-dvivid-warning" : "text-dvivid-text-muted"
                  }`}>
                    {isComplete ? "Complete" : isMissing ? "Incomplete" : "Optional"}
                  </span>
                </div>
                {hasMissingFields && (
                  <p className="text-xs text-dvivid-warning mt-1">
                    Missing: {section.missingFields.join(", ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
