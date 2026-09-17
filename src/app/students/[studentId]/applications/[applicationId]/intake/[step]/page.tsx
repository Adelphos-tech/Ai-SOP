"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
  SectionCard, StatusBadge,
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
import { randomUUID } from "crypto";

// ============================================================
// 9-SECTION INTAKE PAGE
// ============================================================
// This page handles all 9 intake sections via a [step] dynamic route.
// Each section loads/saves profile data via the /api/application/profile API.
// All sections remain editable after completion.
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

  const currentSection = INTAKE_SECTIONS.find(s => s.slug === stepSlug);
  const currentStep = currentSection?.id || 1;

  const [profile, setProfile] = useState<any>(null);
  const [profileRevision, setProfileRevision] = useState<number>(0);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // Load profile + application
  useEffect(() => {
    loadAll();
  }, [studentId, applicationId]);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [profileRes, appRes] = await Promise.all([
        fetch(`/api/application/profile?studentId=${studentId}`, { cache: "no-store" }),
        fetch(`/api/application/list?studentId=${studentId}`, { cache: "no-store" }),
      ]);

      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfile(data.profile || {});
        setProfileRevision(typeof data.revision === "number" ? data.revision : 0);
      }

      if (appRes.ok) {
        const data = await appRes.json();
        const apps = data.applications || [];
        const app = apps.find((a: Application) => a.id === applicationId);
        setApplication(app || null);
      }
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  // Save profile — throws on error so callers can block navigation
  const saveProfile = useCallback(async (newProfile: any) => {
    setSaving(true);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/application/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, profileData: newProfile }),
      });
      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        const errText = await res.text().catch(() => "Save failed");
        setSaveStatus("error");
        throw new Error(errText);
      }
    } catch (e: any) {
      setSaveStatus("error");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [studentId]);

  // Update profile helper
  const updateProfile = useCallback((updater: (prev: any) => any) => {
    setProfile((prev: any) => {
      const next = updater(prev || {});
      return next;
    });
  }, []);

  // Save & Continue — blocks navigation if save fails
  async function handleSaveAndContinue() {
    if (!profile) return;
    try {
      await saveProfile(profile);
    } catch (err: any) {
      setError(err?.message || "Failed to save. Please try again.");
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
  }

  // Skip optional section — also save current progress before navigating
  async function handleSkip() {
    if (profile) {
      try {
        await saveProfile(profile);
      } catch {
        // If save fails on skip, still allow navigation but show warning
        setError("Warning: progress may not have been saved.");
      }
    }
    const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);
    if (nextSection) {
      router.push(`/students/${studentId}/applications/${applicationId}/intake/${nextSection.slug}`);
    } else {
      router.push(`/students/${studentId}/applications/${applicationId}`);
    }
  }

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading...</div></PageContainer>;
  }

  if (!currentSection) {
    return <PageContainer><div className="text-center py-12 text-dvivid-error">Invalid intake section.</div></PageContainer>;
  }

  const completions = calculateIntakeCompletion(profile, application);
  const readiness = getProfileReadiness(profile, application);
  const firstMissingSlug = readiness.sections.find(s => s.status === "missing")?.slug;
  const intakeComplete = readiness.canGenerate;
  const prevSection = INTAKE_SECTIONS.find(s => s.id === currentStep - 1);
  const nextSection = INTAKE_SECTIONS.find(s => s.id === currentStep + 1);

  return (
    <PageContainer>
      <WorkflowStepper
        intakeComplete={intakeComplete}
        firstIncompleteIntakeSlug={firstMissingSlug}
      />
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: application?.universityName || "Application", href: `/students/${studentId}/applications/${applicationId}` },
        { label: currentSection.label },
      ]} />

      <IntakeTracker
        studentId={studentId}
        applicationId={applicationId}
        currentStep={currentStep}
        completions={completions}
      />

      {/* Save status indicator */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-page-title text-dvivid-text-primary">{currentSection.label}</h1>
          {currentSection.optional && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-dvivid-text-muted">Optional</span>
          )}
        </div>
        <SaveStatusIndicator status={saveStatus} saving={saving} />
      </div>

      <p className="text-sm text-dvivid-text-secondary mb-6">{currentSection.description}</p>

      {error && (
        <div className="mb-4 p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input text-sm text-dvivid-error">
          {error}
        </div>
      )}

      {/* CV Upload — only on Section 1 */}
      {currentStep === 1 && (
        <div className="mb-6">
          <CVUpload
            studentId={studentId}
            profileRevision={profileRevision}
            onApplied={() => {
              // Reload profile after CV applied
              loadAll();
            }}
          />
        </div>
      )}

      {/* Section content */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6 mb-6">
        {profile && renderSection(currentStep, profile, updateProfile, application)}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        {prevSection ? (
          <Link href={`/students/${studentId}/applications/${applicationId}/intake/${prevSection.slug}`}>
            <SecondaryButton>← Back</SecondaryButton>
          </Link>
        ) : (
          <Link href={`/students/${studentId}/applications/${applicationId}`}>
            <SecondaryButton>← Back</SecondaryButton>
          </Link>
        )}

        <div className="flex gap-3">
          {currentSection.optional && (
            <SecondaryButton onClick={handleSkip}>Skip for now</SecondaryButton>
          )}
          <PrimaryButton onClick={handleSaveAndContinue} disabled={saving}>
            {saving ? "Saving..." : "Save & Continue →"}
          </PrimaryButton>
        </div>
      </div>
    </PageContainer>
  );
}

// ============================================================
// SAVE STATUS INDICATOR
// ============================================================
function SaveStatusIndicator({ status, saving }: { status: string; saving: boolean }) {
  if (saving || status === "saving") {
    return <span className="text-sm text-dvivid-text-muted">Saving...</span>;
  }
  if (status === "saved") {
    return <span className="text-sm text-dvivid-success">✓ Saved</span>;
  }
  if (status === "error") {
    return <span className="text-sm text-dvivid-error">Save failed</span>;
  }
  return <span className="text-sm text-dvivid-text-muted">Unsaved changes</span>;
}

// ============================================================
// SECTION RENDERERS
// ============================================================
function renderSection(step: number, profile: any, updateProfile: (fn: (prev: any) => any) => void, application: any): React.ReactNode {
  switch (step) {
    case 1: return <StudentDetailsSection profile={profile} updateProfile={updateProfile} />;
    case 2: return <FieldMotivationSection profile={profile} updateProfile={updateProfile} />;
    case 3: return <AcademicsProjectsSection profile={profile} updateProfile={updateProfile} />;
    case 4: return <WorkExperienceSection profile={profile} updateProfile={updateProfile} />;
    case 5: return <MastersMotivationSection profile={profile} updateProfile={updateProfile} />;
    case 6: return <CountryQuestionsSection profile={profile} updateProfile={updateProfile} application={application} />;
    case 7: return <SubjectRequirementsSection profile={profile} updateProfile={updateProfile} />;
    case 8: return <UniversityRequirementsSection profile={profile} updateProfile={updateProfile} application={application} />;
    case 9: return <CareerGoalsSection profile={profile} updateProfile={updateProfile} />;
    default: return null;
  }
}

// ============================================================
// SECTION 1: STUDENT DETAILS
// ============================================================
function StudentDetailsSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const pd = profile.personalData || {};
  const education = profile.education || [];

  const setPd = (key: string, value: string) => {
    updateProfile(p => ({ ...p, personalData: { ...p.personalData, [key]: value } }));
  };

  const addEducation = () => {
    updateProfile(p => ({
      ...p,
      education: [...(p.education || []), {
        id: crypto.randomUUID(),
        level: "", institution: "", degree: "", specialization: "",
        startYear: "", endYear: "", cgpa: "", cgpaScale: "10",
        percentage: "", backlogs: "", status: "",
      }],
    }));
  };

  const updateEducation = (id: string, key: string, value: string) => {
    updateProfile(p => ({
      ...p,
      education: (p.education || []).map((e: any) => e.id === id ? { ...e, [key]: value } : e),
    }));
  };

  const removeEducation = (id: string) => {
    updateProfile(p => ({
      ...p,
      education: (p.education || []).filter((e: any) => e.id !== id),
    }));
  };

  return (
    <div className="space-y-6">
      {/* Personal */}
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Personal Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="First Name" required>
            <input className={inputClass} value={pd.firstName || ""} onChange={e => setPd("firstName", e.target.value)} placeholder="John" />
          </FormField>
          <FormField label="Last Name" required>
            <input className={inputClass} value={pd.lastName || ""} onChange={e => setPd("lastName", e.target.value)} placeholder="Doe" />
          </FormField>
          <FormField label="Email">
            <input className={inputClass} value={pd.email || ""} onChange={e => setPd("email", e.target.value)} placeholder="john@example.com" />
          </FormField>
          <FormField label="Phone">
            <input className={inputClass} value={pd.phone || ""} onChange={e => setPd("phone", e.target.value)} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Date of Birth">
            <input type="date" className={inputClass} value={pd.dateOfBirth || ""} onChange={e => setPd("dateOfBirth", e.target.value)} />
          </FormField>
          <FormField label="Nationality" required>
            <input className={inputClass} value={pd.nationality || ""} onChange={e => setPd("nationality", e.target.value)} placeholder="Indian" />
          </FormField>
          <FormField label="Current City" required>
            <input className={inputClass} value={pd.currentCity || ""} onChange={e => setPd("currentCity", e.target.value)} placeholder="Mumbai" />
          </FormField>
          <FormField label="Current Country" required>
            <input className={inputClass} value={pd.currentCountry || ""} onChange={e => setPd("currentCountry", e.target.value)} placeholder="India" />
          </FormField>
        </div>
      </div>

      {/* Education */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-dvivid-text-primary">Education</h3>
          <button onClick={addEducation} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Education</button>
        </div>
        {education.length === 0 ? (
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No education records yet. Click "Add Education" to start.</p>
        ) : (
          <div className="space-y-4">
            {education.map((edu: any, i: number) => (
              <div key={edu.id} className="border border-dvivid-border rounded-input p-4 relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Education #{i + 1}</span>
                  <button onClick={() => removeEducation(edu.id)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Degree Level">
                    <select className={inputClass} value={edu.level || ""} onChange={e => updateEducation(edu.id, "level", e.target.value)}>
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
                    <input className={inputClass} value={edu.institution || ""} onChange={e => updateEducation(edu.id, "institution", e.target.value)} placeholder="IIT Bombay" />
                  </FormField>
                  <FormField label="Field / Major">
                    <input className={inputClass} value={edu.specialization || ""} onChange={e => updateEducation(edu.id, "specialization", e.target.value)} placeholder="Computer Science" />
                  </FormField>
                  <FormField label="CGPA / GPA">
                    <input className={inputClass} value={edu.cgpa || ""} onChange={e => updateEducation(edu.id, "cgpa", e.target.value)} placeholder="8.5" />
                  </FormField>
                  <FormField label="Maximum GPA Scale">
                    <input className={inputClass} value={edu.cgpaScale || ""} onChange={e => updateEducation(edu.id, "cgpaScale", e.target.value)} placeholder="10" />
                  </FormField>
                  <FormField label="Start Year">
                    <input className={inputClass} value={edu.startYear || ""} onChange={e => updateEducation(edu.id, "startYear", e.target.value)} placeholder="2020" />
                  </FormField>
                  <FormField label="Graduation Year">
                    <input className={inputClass} value={edu.endYear || ""} onChange={e => updateEducation(edu.id, "endYear", e.target.value)} placeholder="2024" />
                  </FormField>
                  <FormField label="Backlogs (if any)">
                    <input className={inputClass} value={edu.backlogs || ""} onChange={e => updateEducation(edu.id, "backlogs", e.target.value)} placeholder="0" />
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
function FieldMotivationSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const fm = profile.fieldMotivation || "";

  return (
    <div className="space-y-4">
      <FormField label="Why did you choose this field of study?" helper="This is optional but helps the AI understand your motivation.">
        <TextAreaField
          value={fm}
          onChange={v => updateProfile(p => ({ ...p, fieldMotivation: v }))}
          placeholder="I first became interested in computer science when..."
          rows={8}
        />
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
function AcademicsProjectsSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const projects = profile.projects || [];
  const subjects = profile.subjects || [];
  const skills = profile.skills || { technical: [], tools: [], programming: [], domain: [], soft: [] };

  // Projects
  const addProject = () => {
    updateProfile(p => ({
      ...p,
      projects: [...(p.projects || []), {
        id: crypto.randomUUID(),
        name: "", type: "", description: "", role: "",
        objective: "", technologies: "", methods: "",
        outcome: "", challenges: "", whatLearned: "", whyChosen: "",
      }],
    }));
  };

  const updateProject = (id: string, key: string, value: string) => {
    updateProfile(p => ({
      ...p,
      projects: (p.projects || []).map((pr: any) => pr.id === id ? { ...pr, [key]: value } : pr),
    }));
  };

  const removeProject = (id: string) => {
    updateProfile(p => ({ ...p, projects: (p.projects || []).filter((pr: any) => pr.id !== id) }));
  };

  // Subjects
  const addSubject = () => {
    updateProfile(p => ({
      ...p,
      subjects: [...(p.subjects || []), { id: crypto.randomUUID(), name: "", topics: "", relevance: "" }],
    }));
  };

  const updateSubject = (id: string, key: string, value: string) => {
    updateProfile(p => ({
      ...p,
      subjects: (p.subjects || []).map((s: any) => s.id === id ? { ...s, [key]: value } : s),
    }));
  };

  const removeSubject = (id: string) => {
    updateProfile(p => ({ ...p, subjects: (p.subjects || []).filter((s: any) => s.id !== id) }));
  };

  // Skills
  const setSkill = (key: string, value: string[]) => {
    updateProfile(p => ({ ...p, skills: { ...(p.skills || {}), [key]: value } }));
  };

  return (
    <div className="space-y-8">
      {/* Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-dvivid-text-primary">Projects</h3>
          <button onClick={addProject} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Project</button>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No projects yet.</p>
        ) : (
          <div className="space-y-4">
            {projects.map((proj: any, i: number) => (
              <div key={proj.id} className="border border-dvivid-border rounded-input p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Project #{i + 1}</span>
                  <button onClick={() => removeProject(proj.id)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Project Name"><input className={inputClass} value={proj.name || ""} onChange={e => updateProject(proj.id, "name", e.target.value)} /></FormField>
                  <FormField label="Project Type"><input className={inputClass} value={proj.type || ""} onChange={e => updateProject(proj.id, "type", e.target.value)} placeholder="Academic / Personal / Research" /></FormField>
                  <FormField label="Your Role"><input className={inputClass} value={proj.role || ""} onChange={e => updateProject(proj.id, "role", e.target.value)} /></FormField>
                  <FormField label="Tools / Technologies"><input className={inputClass} value={proj.technologies || ""} onChange={e => updateProject(proj.id, "technologies", e.target.value)} /></FormField>
                  <FormField label="Objective / Problem" className="md:col-span-2"><input className={inputClass} value={proj.objective || ""} onChange={e => updateProject(proj.id, "objective", e.target.value)} /></FormField>
                  <FormField label="Description" className="md:col-span-2"><TextAreaField value={proj.description || ""} onChange={v => updateProject(proj.id, "description", v)} rows={3} /></FormField>
                  <FormField label="Methods Used"><input className={inputClass} value={proj.methods || ""} onChange={e => updateProject(proj.id, "methods", e.target.value)} /></FormField>
                  <FormField label="Outcome"><input className={inputClass} value={proj.outcome || ""} onChange={e => updateProject(proj.id, "outcome", e.target.value)} /></FormField>
                  <FormField label="Challenges"><input className={inputClass} value={proj.challenges || ""} onChange={e => updateProject(proj.id, "challenges", e.target.value)} /></FormField>
                  <FormField label="What You Learned"><input className={inputClass} value={proj.whatLearned || ""} onChange={e => updateProject(proj.id, "whatLearned", e.target.value)} /></FormField>
                  <FormField label="Why You Chose This Project" className="md:col-span-2"><input className={inputClass} value={proj.whyChosen || ""} onChange={e => updateProject(proj.id, "whyChosen", e.target.value)} /></FormField>
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
          <button onClick={addSubject} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Subject</button>
        </div>
        {subjects.length === 0 ? (
          <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No subjects yet.</p>
        ) : (
          <div className="space-y-3">
            {subjects.map((sub: any, i: number) => (
              <div key={sub.id} className="border border-dvivid-border rounded-input p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-dvivid-text-secondary">Subject #{i + 1}</span>
                  <button onClick={() => removeSubject(sub.id)} className="text-sm text-dvivid-error hover:underline">Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Subject Name"><input className={inputClass} value={sub.name || ""} onChange={e => updateSubject(sub.id, "name", e.target.value)} /></FormField>
                  <FormField label="Important Topics"><input className={inputClass} value={sub.topics || ""} onChange={e => updateSubject(sub.id, "topics", e.target.value)} /></FormField>
                  <FormField label="Relevance to Future Study"><input className={inputClass} value={sub.relevance || ""} onChange={e => updateSubject(sub.id, "relevance", e.target.value)} /></FormField>
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
          <FormField label="Technical Skills" helper="Comma-separated"><input className={inputClass} value={(skills.technical || []).join(", ")} onChange={e => setSkill("technical", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="Machine Learning, Data Analysis" /></FormField>
          <FormField label="Tools" helper="Comma-separated"><input className={inputClass} value={(skills.tools || []).join(", ")} onChange={e => setSkill("tools", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="Git, JIRA, Tableau" /></FormField>
          <FormField label="Software" helper="Comma-separated"><input className={inputClass} value={(skills.software || []).join(", ")} onChange={e => setSkill("software", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="MATLAB, AutoCAD" /></FormField>
          <FormField label="Programming Languages" helper="Comma-separated"><input className={inputClass} value={(skills.programming || []).join(", ")} onChange={e => setSkill("programming", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="Python, Java, C++" /></FormField>
          <FormField label="Domain Skills" helper="Comma-separated"><input className={inputClass} value={(skills.domain || []).join(", ")} onChange={e => setSkill("domain", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="Financial Modeling, Circuit Design" /></FormField>
          <FormField label="Soft Skills" helper="Comma-separated"><input className={inputClass} value={(skills.soft || []).join(", ")} onChange={e => setSkill("soft", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="Leadership, Communication" /></FormField>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 4: WORK EXPERIENCE
// ============================================================
function WorkExperienceSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const experience = profile.experience || [];

  const addExperience = () => {
    updateProfile(p => ({
      ...p,
      experience: [...(p.experience || []), {
        id: crypto.randomUUID(),
        type: "", organization: "", role: "", location: "",
        startDate: "", endDate: "", currentlyWorking: false,
        responsibilities: "", achievements: "", skillsUsed: "",
        keyLearning: "", relevanceToMasters: "",
      }],
    }));
  };

  const updateExp = (id: string, key: string, value: any) => {
    updateProfile(p => ({
      ...p,
      experience: (p.experience || []).map((e: any) => e.id === id ? { ...e, [key]: value } : e),
    }));
  };

  const removeExp = (id: string) => {
    updateProfile(p => ({ ...p, experience: (p.experience || []).filter((e: any) => e.id !== id) }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-dvivid-text-primary">Work Experience</h3>
        <button onClick={addExperience} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Experience</button>
      </div>
      {experience.length === 0 ? (
        <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No experience records yet.</p>
      ) : (
        <div className="space-y-4">
          {experience.map((exp: any, i: number) => (
            <div key={exp.id} className="border border-dvivid-border rounded-input p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-dvivid-text-secondary">Experience #{i + 1}</span>
                <button onClick={() => removeExp(exp.id)} className="text-sm text-dvivid-error hover:underline">Remove</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Type">
                  <select className={inputClass} value={exp.type || ""} onChange={e => updateExp(exp.id, "type", e.target.value)}>
                    <option value="">Select type</option>
                    <option value="Internship">Internship</option>
                    <option value="Full-time Job">Full-time Job</option>
                    <option value="Part-time Job">Part-time Job</option>
                    <option value="Research Role">Research Role</option>
                    <option value="Other">Other Experience</option>
                  </select>
                </FormField>
                <FormField label="Organization"><input className={inputClass} value={exp.organization || ""} onChange={e => updateExp(exp.id, "organization", e.target.value)} /></FormField>
                <FormField label="Role"><input className={inputClass} value={exp.role || ""} onChange={e => updateExp(exp.id, "role", e.target.value)} /></FormField>
                <FormField label="Location"><input className={inputClass} value={exp.location || ""} onChange={e => updateExp(exp.id, "location", e.target.value)} /></FormField>
                <FormField label="Start Date"><input type="month" className={inputClass} value={exp.startDate || ""} onChange={e => updateExp(exp.id, "startDate", e.target.value)} /></FormField>
                <FormField label="End Date">
                  <input type="month" className={inputClass} value={exp.endDate || ""} onChange={e => updateExp(exp.id, "endDate", e.target.value)} disabled={exp.currentlyWorking} />
                </FormField>
                <FormField label="Currently Working" className="md:col-span-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exp.currentlyWorking || false} onChange={e => updateExp(exp.id, "currentlyWorking", e.target.checked)} />
                    <span className="text-sm text-dvivid-text-secondary">I currently work here</span>
                  </label>
                </FormField>
                <FormField label="Responsibilities" className="md:col-span-2"><TextAreaField value={exp.responsibilities || ""} onChange={v => updateExp(exp.id, "responsibilities", v)} rows={3} /></FormField>
                <FormField label="Achievements" className="md:col-span-2"><TextAreaField value={exp.achievements || ""} onChange={v => updateExp(exp.id, "achievements", v)} rows={2} /></FormField>
                <FormField label="Tools/Skills Used"><input className={inputClass} value={exp.skillsUsed || ""} onChange={e => updateExp(exp.id, "skillsUsed", e.target.value)} /></FormField>
                <FormField label="Key Learning"><input className={inputClass} value={exp.keyLearning || ""} onChange={e => updateExp(exp.id, "keyLearning", e.target.value)} /></FormField>
                <FormField label="Relevance to Master's" className="md:col-span-2"><input className={inputClass} value={exp.relevanceToMasters || ""} onChange={e => updateExp(exp.id, "relevanceToMasters", e.target.value)} /></FormField>
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
function MastersMotivationSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const mm = profile.mastersMotivation || {};

  const set = (key: string, value: string) => {
    updateProfile(p => ({ ...p, mastersMotivation: { ...(p.mastersMotivation || {}), [key]: value } }));
  };

  return (
    <div className="space-y-4">
      <FormField label="Why do you want to pursue a master's degree in this specific field?" required>
        <TextAreaField value={mm.whyField || ""} onChange={v => set("whyField", v)} rows={4} placeholder="I want to pursue a master's in this field because..." />
      </FormField>
      <FormField label="Why master's now?">
        <TextAreaField value={mm.whyNow || ""} onChange={v => set("whyNow", v)} rows={3} placeholder="Now is the right time because..." />
      </FormField>
      <FormField label="Knowledge/skill gaps you want to address">
        <TextAreaField value={mm.skillGaps || ""} onChange={v => set("skillGaps", v)} rows={3} placeholder="I want to address gaps in..." />
      </FormField>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Academic motivation"><TextAreaField value={mm.academicMotivation || ""} onChange={v => set("academicMotivation", v)} rows={3} /></FormField>
        <FormField label="Professional motivation"><TextAreaField value={mm.professionalMotivation || ""} onChange={v => set("professionalMotivation", v)} rows={3} /></FormField>
        <FormField label="Expected learning"><TextAreaField value={mm.expectedLearning || ""} onChange={v => set("expectedLearning", v)} rows={3} /></FormField>
        <FormField label="How master's supports career plans"><TextAreaField value={mm.careerSupport || ""} onChange={v => set("careerSupport", v)} rows={3} /></FormField>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 6: COUNTRY QUESTIONS
// ============================================================
function CountryQuestionsSection({ profile, updateProfile, application }: { profile: any; updateProfile: (fn: (prev: any) => any) => void; application: any }) {
  const cq = profile.countryQuestionnaire || {};
  const countryCode = cq.countryCode || application?.country || "";
  const answers = cq.answers || {};
  const questionnaire = getCountryQuestionnaire(countryCode);
  const countries = getAvailableCountries();

  const setCountry = (code: string) => {
    updateProfile(p => ({
      ...p,
      countryQuestionnaire: { ...(p.countryQuestionnaire || {}), countryCode: code, answers: {} },
    }));
  };

  const setAnswer = (questionId: string, value: string) => {
    updateProfile(p => ({
      ...p,
      countryQuestionnaire: {
        ...(p.countryQuestionnaire || {}),
        countryCode: countryCode,
        answers: { ...((p.countryQuestionnaire || {}).answers || {}), [questionId]: value },
      },
    }));
  };

  return (
    <div className="space-y-4">
      <FormField label="Select Destination Country" required>
        <select className={inputClass} value={countryCode} onChange={e => setCountry(e.target.value)}>
          <option value="">Select country</option>
          {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          <option value="OTHER">Other</option>
        </select>
      </FormField>

      {countryCode && (
        <div className="space-y-4">
          <p className="text-sm text-dvivid-text-secondary">
            Questions for <span className="font-medium">{questionnaire.countryName}</span>:
          </p>
          {questionnaire.questions.map(q => (
            <FormField key={q.id} label={q.label} required={q.required} helper={q.helper}>
              <TextAreaField
                value={answers[q.id] || ""}
                onChange={v => setAnswer(q.id, v)}
                placeholder={q.placeholder}
                rows={4}
              />
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
function SubjectRequirementsSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const sr = profile.subjectRequirements || { notes: [] };
  const notes = sr.notes || [];

  const addNote = () => {
    updateProfile(p => ({
      ...p,
      subjectRequirements: {
        ...(p.subjectRequirements || { notes: [] }),
        notes: [...(p.subjectRequirements?.notes || []), { id: crypto.randomUUID(), type: "consultant", content: "" }],
      },
    }));
  };

  const updateNote = (id: string, value: string) => {
    updateProfile(p => ({
      ...p,
      subjectRequirements: {
        ...(p.subjectRequirements || { notes: [] }),
        notes: (p.subjectRequirements?.notes || []).map((n: any) => n.id === id ? { ...n, content: value } : n),
      },
    }));
  };

  const removeNote = (id: string) => {
    updateProfile(p => ({
      ...p,
      subjectRequirements: {
        ...(p.subjectRequirements || { notes: [] }),
        notes: (p.subjectRequirements?.notes || []).filter((n: any) => n.id !== id),
      },
    }));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-dvivid-text-secondary">
        Capture subject/program-specific requirements such as required academic topics, prerequisite subjects,
        portfolio expectations, technical competencies, or special questions from the program.
      </p>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-dvivid-text-primary">Consultant-Added Notes</h3>
        <button onClick={addNote} className="text-sm text-dvivid-primary hover:underline font-medium">+ Add Note</button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-dvivid-text-muted py-4 text-center bg-gray-50 rounded-input">No notes added.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note: any, i: number) => (
            <div key={note.id} className="border border-dvivid-border rounded-input p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-dvivid-primary-light text-dvivid-primary">Consultant Added</span>
                <button onClick={() => removeNote(note.id)} className="text-sm text-dvivid-error hover:underline">Remove</button>
              </div>
              <TextAreaField value={note.content || ""} onChange={v => updateNote(note.id, v)} rows={3} placeholder="Enter requirement note..." />
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
// SECTION 8: UNIVERSITY REQUIREMENTS
// ============================================================
function UniversityRequirementsSection({ profile, updateProfile, application }: { profile: any; updateProfile: (fn: (prev: any) => any) => void; application: any }) {
  const ur = profile.universityRequirements || {};

  const set = (key: string, value: string) => {
    updateProfile(p => ({ ...p, universityRequirements: { ...(p.universityRequirements || {}), [key]: value } }));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-dvivid-text-secondary">
        Show resolved university/document requirements. Resolution remains:
        consultant/user prompt → D-Vivid requirements DB → official crawl → D-Vivid generic fallback.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="SOP Prompt / Question"><TextAreaField value={ur.promptText || ""} onChange={v => set("promptText", v)} rows={4} /></FormField>
        <div className="space-y-3">
          <FormField label="Word Limit (Min)"><input className={inputClass} value={ur.wordMin || ""} onChange={e => set("wordMin", e.target.value)} /></FormField>
          <FormField label="Word Limit (Max)"><input className={inputClass} value={ur.wordMax || ""} onChange={e => set("wordMax", e.target.value)} /></FormField>
          <FormField label="Character Limit"><input className={inputClass} value={ur.characterLimit || ""} onChange={e => set("characterLimit", e.target.value)} /></FormField>
          <FormField label="Page Limit"><input className={inputClass} value={ur.pageLimit || ""} onChange={e => set("pageLimit", e.target.value)} /></FormField>
        </div>
        <FormField label="Mandatory Topics" className="md:col-span-2"><TextAreaField value={ur.mandatoryTopics || ""} onChange={v => set("mandatoryTopics", v)} rows={3} /></FormField>
        <FormField label="University-Specific Questions" className="md:col-span-2"><TextAreaField value={ur.specificQuestions || ""} onChange={v => set("specificQuestions", v)} rows={3} /></FormField>
        <FormField label="Formatting Rules" className="md:col-span-2"><TextAreaField value={ur.formattingRules || ""} onChange={v => set("formattingRules", v)} rows={2} /></FormField>
        <FormField label="Official Source URL" className="md:col-span-2"><input className={inputClass} value={ur.officialSourceUrl || ""} onChange={e => set("officialSourceUrl", e.target.value)} /></FormField>
      </div>

      {ur.officialSourceUrl && (
        <div className="bg-blue-50 border border-blue-200 rounded-input p-3">
          <p className="text-sm text-blue-800">
            <strong>Official source:</strong> Requirements from this URL are verified.
            Do not modify verified official source text silently.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SECTION 9: CAREER GOALS
// ============================================================
function CareerGoalsSection({ profile, updateProfile }: { profile: any; updateProfile: (fn: (prev: any) => any) => void }) {
  const cg = profile.careerGoals || { shortTerm: {}, longTerm: {} };
  const st = cg.shortTerm || {};
  const lt = cg.longTerm || {};

  const setShort = (key: string, value: string) => {
    updateProfile(p => ({
      ...p,
      careerGoals: { ...(p.careerGoals || { shortTerm: {}, longTerm: {} }), shortTerm: { ...(p.careerGoals?.shortTerm || {}), [key]: value } },
    }));
  };

  const setLong = (key: string, value: string) => {
    updateProfile(p => ({
      ...p,
      careerGoals: { ...(p.careerGoals || { shortTerm: {}, longTerm: {} }), longTerm: { ...(p.careerGoals?.longTerm || {}), [key]: value } },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Short-term */}
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Short-Term Goal</h3>
        <div className="space-y-4">
          <FormField label="What role do you want after graduation?" required>
            <TextAreaField value={st.role || ""} onChange={v => setShort("role", v)} rows={2} placeholder="I want to work as a..." />
          </FormField>
          <FormField label="Which industry?"><input className={inputClass} value={st.industry || ""} onChange={e => setShort("industry", e.target.value)} placeholder="Technology / Finance / Healthcare" /></FormField>
          <FormField label="Preferred responsibilities?"><TextAreaField value={st.responsibilities || ""} onChange={v => setShort("responsibilities", v)} rows={2} /></FormField>
          <FormField label="Preferred country/location (if relevant)"><input className={inputClass} value={st.location || ""} onChange={e => setShort("location", e.target.value)} /></FormField>
        </div>
      </div>

      {/* Long-term */}
      <div>
        <h3 className="text-sm font-semibold text-dvivid-text-primary mb-4">Long-Term Goal</h3>
        <div className="space-y-4">
          <FormField label="Where do you see yourself in 5–10 years?" required>
            <TextAreaField value={lt.vision || ""} onChange={v => setLong("vision", v)} rows={3} placeholder="In 5-10 years, I see myself..." />
          </FormField>
          <FormField label="Leadership/technical/business goals?"><TextAreaField value={lt.goals || ""} onChange={v => setLong("goals", v)} rows={2} /></FormField>
          <FormField label="Impact you want to create?"><TextAreaField value={lt.impact || ""} onChange={v => setLong("impact", v)} rows={2} /></FormField>
          <FormField label="Plans for home country (if applicable)"><TextAreaField value={lt.homeCountryPlans || ""} onChange={v => setLong("homeCountryPlans", v)} rows={2} /></FormField>
        </div>
      </div>
    </div>
  );
}
