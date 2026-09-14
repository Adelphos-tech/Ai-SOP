"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PageContainer, PageHeader, PrimaryButton, EmptyState, StatusBadge } from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";

interface StudentResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
}

export default function StudentsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/application/student?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const students = data.students || [];

        const withCounts = await Promise.all(
          students.map(async (s: StudentResult) => {
            try {
              const appRes = await fetch(`/api/application/list?studentId=${s.id}`);
              if (appRes.ok) {
                const appData = await appRes.json();
                return { ...s, applicationCount: appData.applications?.length || 0 };
              }
              return { ...s, applicationCount: 0 };
            } catch {
              return { ...s, applicationCount: 0 };
            }
          }),
        );
        setResults(withCounts);
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) handleSearch();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <PageContainer>
      <WorkflowStepper />
      <PageHeader
        title="Students"
        subtitle="Search and manage student application profiles."
        action={
          <Link href="/app-setup">
            <PrimaryButton>+ New Student</PrimaryButton>
          </Link>
        }
      />

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, or student ID..."
            className="w-full px-5 py-3.5 pl-13 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:ring-2 focus:ring-dvivid-primary/12 focus:border-dvivid-primary transition-colors text-base"
            style={{ paddingLeft: "48px" }}
            autoFocus
          />
          <svg className="absolute left-4 top-4 w-5 h-5 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="text-center py-12 text-dvivid-text-secondary text-sm">Searching...</div>
      )}

      {!loading && searched && results.length === 0 && (
        <EmptyState
          title="No Students Found"
          description={`No students match "${query}". Create a new student profile to get started.`}
          action={
            <Link href="/app-setup">
              <PrimaryButton>Create New Student</PrimaryButton>
            </Link>
          }
        />
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-dvivid-text-secondary font-medium">
            {results.length} student{results.length !== 1 ? "s" : ""} found
          </p>
          {results.map(student => (
            <Link
              key={student.id}
              href={`/students/${student.id}`}
              className="block bg-white border border-dvivid-border rounded-card shadow-card p-6 hover:shadow-card-hover hover:border-dvivid-primary-border transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-dvivid-primary">
                      {student.firstName?.[0]?.toUpperCase()}{student.lastName?.[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-dvivid-text-primary">
                      {student.firstName} {student.lastName}
                    </h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-dvivid-text-secondary">
                      <span className="truncate">{student.email}</span>
                      {student.country && <span>{student.country}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  {student.applicationCount !== undefined && student.applicationCount > 0 && (
                    <StatusBadge status="IN_REVIEW" label={`${student.applicationCount} App${student.applicationCount !== 1 ? "s" : ""}`} />
                  )}
                  <div className="text-right">
                    <p className="text-xs text-dvivid-text-muted">
                      {new Date(student.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && !searched && (
        <EmptyState
          title="Search for Students"
          description="Start typing to search for students by name, email, or student ID."
          icon={
            <svg className="w-8 h-8 text-dvivid-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
          }
        />
      )}
    </PageContainer>
  );
}
