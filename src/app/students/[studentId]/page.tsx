"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PageContainer, Breadcrumb, PageHeader, PrimaryButton, SecondaryButton,
  SectionCard, EmptyState, StatusBadge,
} from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { FormField, inputClass } from "@/components/ui/FormField";

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
  documentCount?: number;
}

interface ProfileData {
  personalData?: { firstName?: string; lastName?: string; currentCountry?: string };
  education?: unknown[];
  experience?: unknown[];
  noWorkExperience?: boolean;
  [key: string]: unknown;
}

export default function StudentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;

  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewAppForm, setShowNewAppForm] = useState(false);

  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [degree, setDegree] = useState("");
  const [department, setDepartment] = useState("");
  const [country, setCountry] = useState("");
  const [intake, setIntake] = useState("");
  const [intakeYear, setIntakeYear] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadStudent();
  }, [studentId]);

  async function loadStudent() {
    setLoading(true);
    setError("");
    try {
      const studentRes = await fetch(`/api/application/student?id=${studentId}`);
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
      setStudent(studentData.student);

      const profileRes = await fetch(`/api/application/profile?studentId=${studentId}`);
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setProfile(profileData.profile);
      }

      const appsRes = await fetch(`/api/application/list?studentId=${studentId}`);
      if (appsRes.ok) {
        const appsData = await appsRes.json();
        const apps = appsData.applications || [];

        const withCounts = await Promise.all(
          apps.map(async (app: Application) => {
            try {
              const docRes = await fetch(`/api/application/list?applicationId=${app.id}`);
              if (docRes.ok) {
                const docData = await docRes.json();
                return { ...app, documentCount: docData.documents?.length || 0 };
              }
              return { ...app, documentCount: 0 };
            } catch {
              return { ...app, documentCount: 0 };
            }
          }),
        );
        setApplications(withCounts);
      }
    } catch {
      setError("Failed to load student");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateApplication() {
    if (!universityName || !programName || !degree) {
      setError("University, program, and degree are required");
      return;
    }

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

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading student...</div></PageContainer>;
  }

  if (error && !student) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error}</p>
          <Link href="/students" className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">← Back to Students</Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <WorkflowStepper />
      <Breadcrumb items={[{ label: "Students", href: "/students" }, { label: `${student?.firstName} ${student?.lastName}` }]} />

      {/* Student Summary */}
      <div className="bg-white border border-dvivid-border rounded-card shadow-card p-7 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-semibold text-dvivid-primary">
                {student?.firstName?.[0]?.toUpperCase()}{student?.lastName?.[0]?.toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-page-title text-dvivid-text-primary">
                {student?.firstName} {student?.lastName}
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-dvivid-text-secondary">
                <span>{student?.email}</span>
                {student?.phone && <span>{student.phone}</span>}
                {student?.country && <span>{student.country}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            {applications.length > 0 && (
              <Link href={`/students/${studentId}/applications/${applications[0].id}`}>
                <SecondaryButton>Edit / Complete Profile</SecondaryButton>
              </Link>
            )}
            <PrimaryButton onClick={() => setShowNewAppForm(!showNewAppForm)}>
              + New Application
            </PrimaryButton>
          </div>
        </div>

      </div>

      {/* New Application Form */}
      {showNewAppForm && (
        <SectionCard title="New Application" description="Create a new university application for this student." className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField label="University" required>
              <input className={inputClass} value={universityName} onChange={e => setUniversityName(e.target.value)} placeholder="Stanford University" />
            </FormField>
            <FormField label="Program" required>
              <input className={inputClass} value={programName} onChange={e => setProgramName(e.target.value)} placeholder="Civil Engineering" />
            </FormField>
            <FormField label="Degree" required>
              <select className={inputClass} value={degree} onChange={e => setDegree(e.target.value)}>
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

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}

      {/* Applications */}
      <div className="mb-4">
        <h2 className="text-section-title text-dvivid-text-primary">
          Applications
        </h2>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No Applications Yet"
          description="Create the student's first university application to begin."
          action={<PrimaryButton onClick={() => setShowNewAppForm(true)}>Create First Application</PrimaryButton>}
        />
      ) : (
        <div className="space-y-4">
          {applications.map(app => (
            <Link
              key={app.id}
              href={`/students/${studentId}/applications/${app.id}`}
              className="block bg-white border border-dvivid-border rounded-card shadow-card p-6 hover:shadow-card-hover hover:border-dvivid-primary-border transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-card-title text-dvivid-text-primary">{app.universityName}</h3>
                  <p className="text-sm text-dvivid-text-secondary mt-1">
                    {app.programName} · {app.degree}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-dvivid-text-muted">
                    <span>{app.intake} {app.intakeYear}</span>
                    {app.country && <span>{app.country}</span>}
                    {app.department && <span>{app.department}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {app.documentCount !== undefined && app.documentCount > 0 && (
                    <StatusBadge status="IN_REVIEW" label={`${app.documentCount} Doc${app.documentCount !== 1 ? "s" : ""}`} />
                  )}
                  <StatusBadge status={app.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
