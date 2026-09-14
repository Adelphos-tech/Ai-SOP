"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PageContainer, Breadcrumb, PrimaryButton, SecondaryButton, SectionCard,
} from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { FormField, inputClass } from "@/components/ui/FormField";

// ============================================================
// /students/new — New Applicant Fast Flow
// ============================================================
// Canonical entry point for creating a new student.
// Flow: create student → application → redirect to application
// workspace (where intake + CV upload + documents happen).
// Reuses the same repository functions as the legacy /app-setup
// (createStudent, createApplication) — no duplicated business logic.
// ============================================================

export default function NewApplicantPage() {
  const router = useRouter();

  // Step 1: Student details
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");

  // Step 2: Application details (asked on the same page to avoid dead-ends)
  const [universityName, setUniversityName] = useState("");
  const [programName, setProgramName] = useState("");
  const [degree, setDegree] = useState("");
  const [department, setDepartment] = useState("");
  const [appCountry, setAppCountry] = useState("");
  const [intake, setIntake] = useState("");
  const [intakeYear, setIntakeYear] = useState("");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");

    if (!firstName || !lastName || !email) {
      setError("First name, last name, and email are required");
      return;
    }
    if (!universityName || !programName || !degree) {
      setError("University, program, and degree are required to create an application");
      return;
    }

    setCreating(true);
    try {
      // Step 1: Create (or reuse) the student via canonical API
      const studentRes = await fetch("/api/application/student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone, country }),
      });
      if (!studentRes.ok) {
        const err = await studentRes.json();
        throw new Error(err.error || "Failed to create student");
      }
      const studentData = await studentRes.json();
      const studentId = studentData.student.id;

      // Step 2: Create the application via canonical API
      const appRes = await fetch("/api/application/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          universityName,
          programName,
          degree,
          department,
          country: appCountry,
          intake,
          intakeYear,
        }),
      });
      if (!appRes.ok) {
        const err = await appRes.json();
        throw new Error(err.error || "Failed to create application");
      }
      const appData = await appRes.json();
      const applicationId = appData.application.id;

      // No dead-end: go straight to the application workspace.
      // CV upload, intake, and documents happen there.
      router.push(`/students/${studentId}/applications/${applicationId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create applicant");
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageContainer>
      <WorkflowStepper />
      <Breadcrumb items={[{ label: "Students", href: "/students" }, { label: "New Applicant" }]} />

      <div className="mb-8">
        <h1 className="text-page-title text-dvivid-text-primary">New Applicant</h1>
        <p className="text-base text-dvivid-text-secondary mt-1.5">
          Create a student and their first university application. You'll upload the CV and complete the intake in the application workspace.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}

      {/* Step 1: Student */}
      <SectionCard title="1. Student Details" description="The person whose application materials are being prepared." className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="First Name" required>
            <input className={inputClass} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Kunj" autoFocus />
          </FormField>
          <FormField label="Last Name" required>
            <input className={inputClass} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Modh" />
          </FormField>
          <FormField label="Email" required>
            <input className={inputClass} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="kunj@example.com" />
          </FormField>
          <FormField label="Phone">
            <input className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Country">
            <input className={inputClass} value={country} onChange={e => setCountry(e.target.value)} placeholder="India" />
          </FormField>
        </div>
      </SectionCard>

      {/* Step 2: Application */}
      <SectionCard title="2. First Application" description="The first university/program target for this student. You can add more later." className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="University" required>
            <input className={inputClass} value={universityName} onChange={e => setUniversityName(e.target.value)} placeholder="Aalen University" />
          </FormField>
          <FormField label="Program" required>
            <input className={inputClass} value={programName} onChange={e => setProgramName(e.target.value)} placeholder="MS Machine Learning" />
          </FormField>
          <FormField label="Degree" required>
            <select className={inputClass} value={degree} onChange={e => setDegree(e.target.value)}>
              <option value="">Select degree</option>
              <option value="Master of Science">Master of Science (MS)</option>
              <option value="Master of Engineering">Master of Engineering (MEng)</option>
              <option value="Master of Arts">Master of Arts (MA)</option>
              <option value="Master of Business Administration">Master of Business Administration (MBA)</option>
              <option value="Doctor of Philosophy">Doctor of Philosophy (PhD)</option>
              <option value="Bachelor">Bachelor</option>
              <option value="Other">Other</option>
            </select>
          </FormField>
          <FormField label="Department">
            <input className={inputClass} value={department} onChange={e => setDepartment(e.target.value)} placeholder="Computer Science" />
          </FormField>
          <FormField label="Country">
            <input className={inputClass} value={appCountry} onChange={e => setAppCountry(e.target.value)} placeholder="Germany" />
          </FormField>
          <FormField label="Intake">
            <select className={inputClass} value={intake} onChange={e => setIntake(e.target.value)}>
              <option value="">Select intake</option>
              <option value="Fall">Fall</option>
              <option value="Spring">Spring</option>
              <option value="Summer">Summer</option>
              <option value="Winter">Winter</option>
            </select>
          </FormField>
          <FormField label="Intake Year">
            <input className={inputClass} value={intakeYear} onChange={e => setIntakeYear(e.target.value)} placeholder="2027" />
          </FormField>
        </div>
      </SectionCard>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Link href="/students">
          <SecondaryButton>Cancel</SecondaryButton>
        </Link>
        <PrimaryButton onClick={handleCreate} disabled={creating}>
          {creating ? "Creating..." : "Create Applicant & Application →"}
        </PrimaryButton>
      </div>
    </PageContainer>
  );
}
