"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  PageContainer, PageHeader, PrimaryButton, EmptyState, StatusBadge,
} from "@/components/ui";

// ============================================================
// /applications — Cross-student Applications Listing
// ============================================================
// Shows all applications across all students. Clicking a row
// opens the canonical application workspace.
// This replaces the legacy /app-setup quick-form as the
// "Applications" tab destination.
// ============================================================

interface ApplicationRow {
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
  studentFirstName: string;
  studentLastName: string;
  studentEmail: string;
  documentCount: number;
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadApplications();
  }, []);

  async function loadApplications() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/application/list?limit=200");
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load applications");
        return;
      }
      const data = await res.json();
      setApplications(data.applications || []);
    } catch {
      setError("Failed to load applications");
    } finally {
      setLoading(false);
    }
  }

  const filtered = query.trim()
    ? applications.filter(a => {
        const q = query.toLowerCase();
        return (
          a.universityName?.toLowerCase().includes(q) ||
          a.programName?.toLowerCase().includes(q) ||
          a.studentFirstName?.toLowerCase().includes(q) ||
          a.studentLastName?.toLowerCase().includes(q) ||
          a.studentEmail?.toLowerCase().includes(q) ||
          a.intakeYear?.toLowerCase().includes(q)
        );
      })
    : applications;

  return (
    <PageContainer>
      <PageHeader
        title="Applications"
        subtitle="All university applications across students. Click an application to open its workspace."
        action={
          <Link href="/students/new">
            <PrimaryButton>+ New Applicant</PrimaryButton>
          </Link>
        }
      />

      {/* Search */}
      <div className="relative mb-8">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by student, university, program, or intake year..."
          className="w-full px-5 py-3.5 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:ring-2 focus:ring-dvivid-primary/12 focus:border-dvivid-primary transition-colors text-base"
          style={{ paddingLeft: "48px" }}
        />
        <svg className="absolute left-4 top-4 w-5 h-5 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {loading && (
        <div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading applications...</div>
      )}

      {!loading && error && (
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title={query ? "No Applications Match" : "No Applications Yet"}
          description={
            query
              ? `No applications match "${query}".`
              : "Create a new applicant to start their first university application."
          }
          action={
            !query && (
              <Link href="/students/new">
                <PrimaryButton>+ New Applicant</PrimaryButton>
              </Link>
            )
          }
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-dvivid-text-secondary font-medium">
            {filtered.length} application{filtered.length !== 1 ? "s" : ""}
          </p>
          {filtered.map(app => (
            <Link
              key={app.id}
              href={`/students/${app.studentId}/applications/${app.id}`}
              className="block bg-white border border-dvivid-border rounded-card shadow-card p-6 hover:shadow-card-hover hover:border-dvivid-primary-border transition-all"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-card-title text-dvivid-text-primary">{app.universityName}</h3>
                    <StatusBadge status={app.status} />
                  </div>
                  <p className="text-sm text-dvivid-text-secondary mt-1">
                    {app.programName} · {app.degree}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-dvivid-text-muted">
                    <span className="font-medium text-dvivid-text-primary">
                      {app.studentFirstName} {app.studentLastName}
                    </span>
                    <span>{app.studentEmail}</span>
                    {app.intake && <span>{app.intake} {app.intakeYear}</span>}
                    {app.country && <span>{app.country}</span>}
                    {app.department && <span>{app.department}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {app.documentCount > 0 && (
                    <StatusBadge status="IN_REVIEW" label={`${app.documentCount} Doc${app.documentCount !== 1 ? "s" : ""}`} />
                  )}
                  <div className="text-right">
                    <p className="text-xs text-dvivid-text-muted">
                      Updated {new Date(app.updatedAt || app.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
