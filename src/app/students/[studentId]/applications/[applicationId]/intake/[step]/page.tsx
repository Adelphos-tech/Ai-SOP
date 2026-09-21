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
import { CVUpload } from "@/components/ui/CVUpload";
import {
  INTAKE_SECTIONS,
  calculateIntakeCompletion,
  getProfileReadiness,
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
  // Stale-request token — a response is only applied if it is still the
  // latest load for the current student/application identity.
  const loadTokenRef = useRef(0);

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
    setActiveWizardSection(null);
    setStudentIdentity(null);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, applicationId]);

  async function loadAll() {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError("");
    try {
      const [profileRes, appRes] = await Promise.all([
        fetch(`/api/application/profile?studentId=${studentId}`, { cache: "no-store" }),
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
      if (wizardMode) {
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

  // Save profile — throws on error so callers can block navigation
  const saveProfile = useCallback(async (values: IntakeProfileForm) => {
    setSaving(true);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/application/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Conditional write — never clobber a newer profile (e.g. a CV
        // apply that landed after this page loaded).
        body: JSON.stringify({ studentId, profileData: values, expectedRevision: profileRevision }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.revision === "number") setProfileRevision(data.revision);
        setSaveStatus("saved");
        // reset() the saved values — isDirty returns to false.
        reset(values);
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else if (res.status === 409) {
        // Profile changed since load — reload fresh state, keep the
        // user's unsaved field on top would lose data; safest is reload
        // + visible message so the user re-saves intentionally.
        await loadAll();
        const msg = "Profile was updated elsewhere (e.g. CV import). Latest data loaded — please re-apply your change and save again.";
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
      setSaving(false);
    }
  }, [studentId, profileRevision, reset]);

  // Save & Continue — validates, saves, blocks navigation on failure.
  // Wizard mode stays on /intake/missing and reloads so the next
  // missing required section becomes the current one.
  const handleSaveAndContinue = handleSubmit(async (values) => {
    try {
      await saveProfile(values);
    } catch (err: any) {
      setError(err?.message || "Failed to save. Please try again.");
      return;
    }
    if (wizardMode) {
      await loadAll();
      return;
    }
    // Navigate to next section
    const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);
    if (nextSection) {
      router.push(`/students/${studentId}/applications/${applicationId}/intake/${nextSection.slug}`);
    } else {
      // Last section — go to application workspace
      router.push(`/students/${studentId}/applications/${applicationId}`);
    }
  });

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
        <div className="mb-4 p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input text-sm text-dvivid-error">
          {error}
        </div>
      )}

      <FormProvider {...methods}>
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
      </FormProvider>

      {/* Navigation */}
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
          {wizardMode ? (
            <Link
              href={`/students/${studentId}/applications/${applicationId}/intake/student-details`}
              className="text-sm text-dvivid-text-secondary hover:text-dvivid-primary"
            >
              Review all information
            </Link>
          ) : (
            <Link
              href={`/students/${studentId}/applications/${applicationId}`}
              className="text-sm text-dvivid-text-secondary hover:text-dvivid-primary"
            >
              Exit to application
            </Link>
          )}
          {!wizardMode && currentSection!.optional && (
            <SecondaryButton onClick={handleSkip}>Skip for now</SecondaryButton>
          )}
          <PrimaryButton onClick={() => handleSaveAndContinue()} disabled={saving}>
            {saving ? "Saving..." : wizardMode
              ? (missingRequired.length > 1 ? "Save & Next Missing Answer →" : "Save & Finish →")
              : nextSection ? "Save & Continue →" : "Save & Finish →"}
          </PrimaryButton>
        </div>
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
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No education records yet. Click "Add Education" to start.</p>
        ) : (
          <div className="space-y-4">
            {edu.fields.map((f, i) => (
              <div key={f._key} className="border border-dvivid-border rounded-input p-4 relative">
                <input type="hidden" {...register(`education.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Education #{i + 1}</span>
                  <button type="button" onClick={() => edu.remove(i)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Degree Level">
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
                  <FormField label="Institution / University">
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
    <div className="space-y-4">
      <FormField label="Why did you choose this field of study?" helper="This is optional but helps the AI understand your motivation.">
        <Area name="fieldMotivation" rows={8} placeholder="I first became interested in computer science when..." />
      </FormField>
      <div className="bg-dvivid-primary-light/30 rounded-input p-4 space-y-2">
        <p className="text-sm font-medium text-dvivid-text-primary">Helper prompts (optional):</p>
        <ul className="text-sm text-dvivid-text-secondary space-y-1 list-disc list-inside">
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
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No projects yet.</p>
        ) : (
          <div className="space-y-4">
            {projects.fields.map((f, i) => (
              <div key={f._key} className="border border-dvivid-border rounded-input p-4">
                <input type="hidden" {...register(`projects.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Project #{i + 1}</span>
                  <button type="button" onClick={() => projects.remove(i)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Project Name"><input className={inputClass} {...register(`projects.${i}.name` as any)} /></FormField>
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
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No subjects yet.</p>
        ) : (
          <div className="space-y-3">
            {subjects.fields.map((f, i) => (
              <div key={f._key} className="border border-dvivid-border rounded-input p-3">
                <input type="hidden" {...register(`subjects.${i}.id` as any)} />
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Subject #{i + 1}</span>
                  <button type="button" onClick={() => subjects.remove(i)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Subject Name"><input className={inputClass} {...register(`subjects.${i}.name` as any)} /></FormField>
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
        <div className="py-4 px-4 bg-gray-50 rounded-input space-y-3">
          <p className="text-sm text-dvivid-text-muted text-center">No experience records yet.</p>
          <label className="flex items-center justify-center gap-2 cursor-pointer">
            <input type="checkbox" {...register("noWorkExperience")} />
            <span className="text-sm text-dvivid-text-secondary">
              This applicant has no work experience (e.g., fresher applying directly after bachelor's)
            </span>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {exp.fields.map((f, i) => (
            <div key={f._key} className="border border-dvivid-border rounded-input p-4">
              <input type="hidden" {...register(`experience.${i}.id` as any)} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-dvivid-text-secondary">Experience #{i + 1}</span>
                <button type="button" onClick={() => exp.remove(i)} className="text-sm text-dvivid-error hover:underline">Remove</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Type">
                  <select className={inputClass} {...register(`experience.${i}.type` as any)}>
                    <option value="">Select type</option>
                    <option value="Internship">Internship</option>
                    <option value="Full-time Job">Full-time Job</option>
                    <option value="Part-time Job">Part-time Job</option>
                    <option value="Research Role">Research Role</option>
                    <option value="Other">Other Experience</option>
                  </select>
                </FormField>
                <FormField label="Organization"><input className={inputClass} {...register(`experience.${i}.organization` as any)} /></FormField>
                <FormField label="Role"><input className={inputClass} {...register(`experience.${i}.role` as any)} /></FormField>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Academic motivation"><Area name="mastersMotivation.academicMotivation" rows={3} /></FormField>
        <FormField label="Professional motivation"><Area name="mastersMotivation.professionalMotivation" rows={3} /></FormField>
        <FormField label="Expected learning"><Area name="mastersMotivation.expectedLearning" rows={3} /></FormField>
        <FormField label="How master's supports career plans"><Area name="mastersMotivation.careerSupport" rows={3} /></FormField>
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
        <div className="space-y-4">
          <p className="text-sm text-dvivid-text-secondary">
            Questions for <span className="font-medium">{questionnaire.countryName}</span>:
          </p>
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
        <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No notes added.</p>
      ) : (
        <div className="space-y-3">
          {notes.fields.map((f, i) => (
            <div key={f._key} className="border border-dvivid-border rounded-input p-3">
              <input type="hidden" {...register(`subjectRequirements.notes.${i}.id` as any)} />
              <input type="hidden" {...register(`subjectRequirements.notes.${i}.type` as any)} />
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-dvivid-primary-light text-dvivid-primary">Consultant Added</span>
                <button type="button" onClick={() => notes.remove(i)} className="text-sm text-dvivid-error hover:underline">Remove</button>
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
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Short-Term Goal</h3>
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
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Long-Term Goal</h3>
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
