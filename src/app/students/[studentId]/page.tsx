"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton,
  SectionCard, EmptyState, StatusBadge, LoadingRows, ErrorState,
} from "@/components/ui";
import { FormField, inputClass } from "@/components/ui/FormField";
import { UniversitySelect } from "@/components/ui/UniversitySelect";

// ============================================================
// /students/[id] — CRM-style student workspace.
//
// Header strip (identity + actions), compact stats, tabbed
// sections: Overview / Applications / Documents / Profile.
// Per-application document fetches are bounded by app count
// (small per student) and reused for counts + recent docs.
// ============================================================

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

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
  createdAt: string;
  updatedAt: string;
}

interface AppDocument {
  id: string;
  applicationId: string;
  documentType: string;
  documentTitle: string;
  generationStatus: string;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileData {
  personalData?: { firstName?: string; lastName?: string; currentCountry?: string };
  education?: unknown[];
  experience?: unknown[];
  noWorkExperience?: boolean;
  [key: string]: unknown;
}

type Tab = "overview" | "applications" | "documents" | "profile";

/** Display status for a document — review status wins once real work exists. */
function docStatus(d: AppDocument): string {
  if (d.reviewStatus === "APPROVED") return "APPROVED";
  if (d.reviewStatus === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (d.reviewStatus === "IN_REVIEW") return "IN_REVIEW";
  if (d.generationStatus === "GENERATING") return "GENERATING";
  if (d.generationStatus === "GENERATED") return "GENERATED";
  if (d.generationStatus === "FAILED") return "FAILED";
  return "DRAFT";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className={`text-xl font-semibold tabular-nums ${accent && value > 0 ? "text-dvivid-warning" : "text-dvivid-text-primary"}`}>{value}</p>
      <p className="text-xs text-dvivid-text-muted mt-0.5">{label}</p>
    </div>
  );
}

export default function StudentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;

  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [showNewAppForm, setShowNewAppForm] = useState(false);

  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [degree, setDegree] = useState("");
  const [department, setDepartment] = useState("");
  const [country, setCountry] = useState("");
  const [intake, setIntake] = useState("");
  const [intakeYear, setIntakeYear] = useState("");
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const loadTokenRef = useRef(0);

  // Identity change resets all student-scoped state AND invalidates
  // any in-flight load — student A data can never land on student B.
  useEffect(() => {
    loadTokenRef.current++;
    setStudent(null);
    setProfile(null);
    setApplications([]);
    setDocuments([]);
    setError("");
    setShowNewAppForm(false);
    loadStudent();
  }, [studentId]);

  async function loadStudent() {
    const token = ++loadTokenRef.current;
    const stale = () => token !== loadTokenRef.current;
    setLoading(true);
    setError("");
    try {
      const studentRes = await fetch(`/api/application/student?id=${studentId}`);
      if (stale()) return;
      if (!studentRes.ok) {
        let msg = studentRes.status === 404 ? "Student not found" : "Failed to load student. Please try again.";
        try {
          const data = await studentRes.json();
          if (data.error) msg = data.error;
        } catch { /* keep default */ }
        setError(msg);
        return;
      }
      const studentData = await studentRes.json();
      if (stale()) return;
      setStudent(studentData.student);

      const profileRes = await fetch(`/api/application/profile?studentId=${studentId}`);
      if (stale()) return;
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        if (stale()) return;
        setProfile(profileData.profile);
      }

      const appsRes = await fetch(`/api/application/list?studentId=${studentId}`);
      if (stale()) return;
      if (appsRes.ok) {
        const appsData = await appsRes.json();
        if (stale()) return;
        const apps: Application[] = appsData.applications || [];

        // One document fetch per application (bounded — few apps/student);
        // reused for counts, recent docs, and stats.
        const docResults = await Promise.all(
          apps.map(async (app) => {
            try {
              const docRes = await fetch(`/api/application/list?applicationId=${app.id}`);
              if (docRes.ok) {
                const docData = await docRes.json();
                return (docData.documents || []) as AppDocument[];
              }
            } catch { /* counts optional */ }
            return [] as AppDocument[];
          }),
        );
        if (stale()) return;
        setApplications(apps);
        setDocuments(docResults.flat());
      }
    } catch {
      if (!stale()) setError("Failed to load student");
    } finally {
      if (!stale()) setLoading(false);
    }
  }

  async function handleCreateApplication() {
    const errs: Record<string, string> = {};
    if (!universityName.trim()) errs.universityName = "Please enter the university name.";
    if (!programName.trim()) errs.programName = "Please enter the program name.";
    if (!degree) errs.degree = "Choose a degree type.";
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setCreating(true);
    setError("");

    try {
      const res = await fetch("/api/application/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          universityName,
          programName,
          degree,
          department,
          country,
          intake,
          intakeYear,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create application");
      }

      const data = await res.json();
      const newAppId = data.application?.id;

      setShowNewAppForm(false);
      setUniversityName("");
      setProgramName("");
      setDegree("");
      setDepartment("");
      setCountry("");
      setIntake("");
      setIntakeYear("");
      setFormErrors({});

      // No dead-end: go straight to the new Application Workspace
      if (newAppId) {
        router.push(`/students/${studentId}/applications/${newAppId}`);
      } else {
        await loadStudent();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create application");
    } finally {
      setCreating(false);
    }
  }

  const docsByApp = new Map<string, AppDocument[]>();
  for (const d of documents) {
    const list = docsByApp.get(d.applicationId) || [];
    list.push(d);
    docsByApp.set(d.applicationId, list);
  }
  const needsReviewCount = documents.filter(d => docStatus(d) === "NEEDS_REVIEW" || docStatus(d) === "IN_REVIEW").length;
  const generatedCount = documents.filter(d => ["GENERATED", "APPROVED", "IN_REVIEW", "NEEDS_REVIEW"].includes(docStatus(d))).length;
  const approvedCount = documents.filter(d => docStatus(d) === "APPROVED").length;
  const recentDocs = [...documents].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 8);
  const appName = (id: string) => applications.find(a => a.id === id)?.universityName || "Application";
  const firstApp = applications[0];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "applications", label: "Applications", count: applications.length },
    { id: "documents", label: "Documents", count: documents.length },
    { id: "profile", label: "Profile" },
  ];

  if (loading) {
    return (
      <PageContainer>
        <div className="bg-white border border-dvivid-border rounded-card mt-6"><LoadingRows rows={4} /></div>
      </PageContainer>
    );
  }

  if (error && !student) {
    return (
      <PageContainer>
        <div className="bg-white border border-dvivid-border rounded-card mt-6">
          <ErrorState title="We couldn't load this student" description={error} onRetry={loadStudent} />
          <div className="text-center pb-8">
            <Link href="/students" className="text-sm text-dvivid-primary hover:underline">← Back to Students</Link>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Breadcrumb items={[{ label: "Students", href: "/students" }, { label: `${student?.firstName} ${student?.lastName}` }]} />

      {/* Identity header — flat strip, not a card */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0">
            <span className="text-base font-semibold text-dvivid-primary">
              {student?.firstName?.[0]?.toUpperCase()}{student?.lastName?.[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-page-title text-dvivid-text-primary leading-tight">
              {student?.firstName} {student?.lastName}
            </h1>
            <p className="text-sm text-dvivid-text-secondary mt-1 truncate">
              {student?.email}
              {student?.country ? ` · ${student.country}` : ""}
              {student?.phone ? ` · ${student.phone}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {firstApp && (
            <Link href={`/students/${studentId}/applications/${firstApp.id}`}>
              <SecondaryButton>Edit Profile</SecondaryButton>
            </Link>
          )}
          <PrimaryButton onClick={() => setShowNewAppForm(!showNewAppForm)}>
            + New Application
          </PrimaryButton>
        </div>
      </div>

      {/* Stats strip */}
      <div className="bg-white border border-dvivid-border rounded-card divide-x divide-dvivid-border-light grid grid-cols-2 sm:grid-cols-4 mb-6">
        <Stat label="Applications" value={applications.length} />
        <Stat label="Documents" value={documents.length} />
        <Stat label="Approved" value={approvedCount} />
        <Stat label="Needs Review" value={needsReviewCount} accent />
      </div>

      {/* Tabs */}
      <div className="border-b border-dvivid-border mb-6 -mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1 min-w-max" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "border-dvivid-primary text-dvivid-primary"
                  : "border-transparent text-dvivid-text-secondary hover:text-dvivid-text-primary"
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-1.5 text-xs text-dvivid-text-muted tabular-nums">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* New Application Form */}
      {showNewAppForm && (
        <SectionCard title="New Application" description="Create a new university application for this student." className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField label="University" required error={formErrors.universityName}>
              <UniversitySelect value={universityName} onChange={v => { setUniversityName(v); setFormErrors(f => ({ ...f, universityName: "" })); }} required placeholder="Search university..." />
            </FormField>
            <FormField label="Program" required error={formErrors.programName}>
              <input className={inputClass} value={programName} onChange={e => { setProgramName(e.target.value); setFormErrors(f => ({ ...f, programName: "" })); }} placeholder="Civil Engineering" />
            </FormField>
            <FormField label="Degree" required error={formErrors.degree}>
              <select className={inputClass} value={degree} onChange={e => { setDegree(e.target.value); setFormErrors(f => ({ ...f, degree: "" })); }}>
                <option value="">Select degree</option>
                <option value="Master of Science">Master of Science (MS)</option>
                <option value="Master of Engineering">Master of Engineering (MEng)</option>
                <option value="Doctor of Philosophy">Doctor of Philosophy (PhD)</option>
                <option value="Other">Other</option>
              </select>
            </FormField>
            <FormField label="Department">
              <input className={inputClass} value={department} onChange={e => setDepartment(e.target.value)} placeholder="CEE" />
            </FormField>
            <FormField label="Country">
              <input className={inputClass} value={country} onChange={e => setCountry(e.target.value)} placeholder="USA" />
            </FormField>
            <FormField label="Intake">
              <select className={inputClass} value={intake} onChange={e => setIntake(e.target.value)}>
                <option value="">Select intake</option>
                <option value="Fall">Fall</option>
                <option value="Spring">Spring</option>
                <option value="Summer">Summer</option>
              </select>
            </FormField>
            <FormField label="Intake Year">
              <input className={inputClass} value={intakeYear} onChange={e => setIntakeYear(e.target.value)} placeholder="2027" />
            </FormField>
          </div>
          <div className="flex gap-3 justify-end mt-6">
            <SecondaryButton onClick={() => setShowNewAppForm(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleCreateApplication} disabled={creating}>
              {creating ? "Creating..." : "Create Application"}
            </PrimaryButton>
          </div>
        </SectionCard>
      )}

      {error && student && (
        <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}

      {/* ===== Overview ===== */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Applications column */}
          <section>
            <h2 className="text-base font-semibold text-dvivid-text-primary mb-3">Applications</h2>
            {applications.length === 0 ? (
              <div className="bg-white border border-dvivid-border rounded-card">
                <EmptyState
                  title="No applications yet"
                  description="Create this student's first university application to begin."
                  action={<PrimaryButton onClick={() => setShowNewAppForm(true)}>Create First Application</PrimaryButton>}
                />
              </div>
            ) : (
              <div className="bg-white border border-dvivid-border rounded-card divide-y divide-dvivid-border-light">
                {applications.map(app => (
                  <Link key={app.id} href={`/students/${studentId}/applications/${app.id}`} className="block px-4 py-3.5 hover:bg-dvivid-surface-alt/70 transition-colors group">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dvivid-text-primary truncate group-hover:text-dvivid-primary">{app.universityName}</p>
                        <p className="text-xs text-dvivid-text-muted mt-0.5 truncate">
                          {app.programName} · {app.country || "—"} {app.intakeYear ? `· ${app.intake} ${app.intakeYear}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={app.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Recent documents column */}
          <section>
            <h2 className="text-base font-semibold text-dvivid-text-primary mb-3">Recent Documents</h2>
            {recentDocs.length === 0 ? (
              <div className="bg-white border border-dvivid-border rounded-card">
                <EmptyState
                  title="No documents yet"
                  description="Documents are created inside an application workspace."
                />
              </div>
            ) : (
              <div className="bg-white border border-dvivid-border rounded-card divide-y divide-dvivid-border-light">
                {recentDocs.map(doc => (
                  <Link
                    key={doc.id}
                    href={`/students/${studentId}/applications/${doc.applicationId}/documents/${doc.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-dvivid-surface-alt/70 transition-colors group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-dvivid-text-primary truncate group-hover:text-dvivid-primary">{doc.documentTitle}</p>
                      <p className="text-xs text-dvivid-text-muted mt-0.5 truncate">{appName(doc.applicationId)} · {fmtDate(doc.updatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={docStatus(doc)} />
                      <span className="text-xs font-medium text-dvivid-primary opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ===== Applications ===== */}
      {tab === "applications" && (
        applications.length === 0 ? (
          <div className="bg-white border border-dvivid-border rounded-card">
            <EmptyState
              title="No applications yet"
              description="Create this student's first university application to begin."
              action={<PrimaryButton onClick={() => setShowNewAppForm(true)}>Create First Application</PrimaryButton>}
            />
          </div>
        ) : (
          <div className="bg-white border border-dvivid-border rounded-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dvivid-border bg-dvivid-surface-alt/60 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide">Application</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden md:table-cell">Destination</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide text-center hidden sm:table-cell">Docs</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden md:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dvivid-border-light">
                {applications.map(app => (
                  <tr key={app.id} className="hover:bg-dvivid-surface-alt/70 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/students/${studentId}/applications/${app.id}`} className="min-w-0">
                        <span className="block font-medium text-dvivid-text-primary truncate group-hover:text-dvivid-primary">{app.universityName}</span>
                        <span className="block text-xs text-dvivid-text-muted truncate">{app.programName} · {app.degree}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-dvivid-text-secondary hidden md:table-cell">
                      {app.country || "—"}{app.intakeYear ? ` · ${app.intake} ${app.intakeYear}` : ""}
                    </td>
                    <td className="px-4 py-3 text-center text-dvivid-text-secondary tabular-nums hidden sm:table-cell">
                      {docsByApp.get(app.id)?.length || 0}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3 text-xs text-dvivid-text-muted whitespace-nowrap hidden md:table-cell">{fmtDate(app.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ===== Documents ===== */}
      {tab === "documents" && (
        documents.length === 0 ? (
          <div className="bg-white border border-dvivid-border rounded-card">
            <EmptyState
              title="No documents yet"
              description="Documents are created inside an application workspace."
            />
          </div>
        ) : (
          <div className="bg-white border border-dvivid-border rounded-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dvivid-border bg-dvivid-surface-alt/60 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide">Document</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden md:table-cell">Application</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden sm:table-cell">Updated</th>
                  <th className="px-4 py-2.5 w-16" aria-label="Open" />
                </tr>
              </thead>
              <tbody className="divide-y divide-dvivid-border-light">
                {[...documents].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).map(doc => (
                  <tr key={doc.id} className="hover:bg-dvivid-surface-alt/70 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/students/${studentId}/applications/${doc.applicationId}/documents/${doc.id}`} className="font-medium text-dvivid-text-primary group-hover:text-dvivid-primary">
                        {doc.documentTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-dvivid-text-secondary hidden md:table-cell">{appName(doc.applicationId)}</td>
                    <td className="px-4 py-3"><StatusBadge status={docStatus(doc)} /></td>
                    <td className="px-4 py-3 text-xs text-dvivid-text-muted whitespace-nowrap hidden sm:table-cell">{fmtDate(doc.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/students/${studentId}/applications/${doc.applicationId}/documents/${doc.id}`} className="text-xs font-medium text-dvivid-primary hover:underline whitespace-nowrap">
                        {docStatus(doc) === "NEEDS_REVIEW" || docStatus(doc) === "IN_REVIEW" ? "Review →" : "Open →"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ===== Profile ===== */}
      {tab === "profile" && (
        <div className="bg-white border border-dvivid-border rounded-card p-6">
          <h2 className="text-base font-semibold text-dvivid-text-primary mb-4">Reusable Profile</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="px-4 py-3 bg-dvivid-surface-alt rounded-input">
              <p className="text-lg font-semibold text-dvivid-text-primary tabular-nums">{profile?.education?.length ?? 0}</p>
              <p className="text-xs text-dvivid-text-muted">Education entries</p>
            </div>
            <div className="px-4 py-3 bg-dvivid-surface-alt rounded-input">
              <p className="text-lg font-semibold text-dvivid-text-primary tabular-nums">{profile?.experience?.length ?? 0}</p>
              <p className="text-xs text-dvivid-text-muted">Experience entries</p>
            </div>
            <div className="px-4 py-3 bg-dvivid-surface-alt rounded-input">
              <p className="text-lg font-semibold text-dvivid-text-primary tabular-nums">{profile?.personalData?.firstName ? "Yes" : "—"}</p>
              <p className="text-xs text-dvivid-text-muted">Personal details</p>
            </div>
            <div className="px-4 py-3 bg-dvivid-surface-alt rounded-input">
              <p className="text-lg font-semibold text-dvivid-text-primary tabular-nums">{profile?.personalData?.currentCountry || student?.country || "—"}</p>
              <p className="text-xs text-dvivid-text-muted">Country</p>
            </div>
          </div>
          <p className="text-sm text-dvivid-text-secondary mb-4">
            The full intake is edited inside an application workspace so answers can be scoped per application.
          </p>
          {firstApp ? (
            <Link href={`/students/${studentId}/applications/${firstApp.id}`}>
              <SecondaryButton>Open intake workspace →</SecondaryButton>
            </Link>
          ) : (
            <p className="text-sm text-dvivid-text-muted">Create an application to start the intake.</p>
          )}
        </div>
      )}
    </PageContainer>
  );
}
