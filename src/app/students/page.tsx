"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageContainer, PageHeader, PrimaryButton, EmptyState, StatusBadge } from "@/components/ui";

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

const PAGE_SIZE = 25;

export default function StudentsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchStudents = useCallback(async (searchQuery: string, pageOffset: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        list: "true",
        limit: String(PAGE_SIZE),
        offset: String(pageOffset),
      });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(`/api/application/student?${params}`);
      if (res.ok) {
        const data = await res.json();
        const students = data.students || [];

        // Fetch application counts in parallel
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
        setTotal(data.total || 0);
        setOffset(pageOffset);
      } else {
        setResults([]);
        setTotal(0);
      }
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Load first page on mount
  useEffect(() => {
    fetchStudents("", 0);
  }, [fetchStudents]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loaded) fetchStudents(query, 0);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, loaded, fetchStudents]);

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <PageContainer>
      <PageHeader
        title="Students"
        subtitle={`${total} student${total !== 1 ? "s" : ""} total`}
        action={
          <Link href="/students/new">
            <PrimaryButton>+ New Applicant</PrimaryButton>
          </Link>
        }
      />

      {/* Search bar */}
      <form onSubmit={(e) => { e.preventDefault(); fetchStudents(query, 0); }} className="mb-8">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, or student ID..."
            className="w-full px-5 py-3.5 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:ring-2 focus:ring-dvivid-primary/12 focus:border-dvivid-primary transition-colors text-base"
            style={{ paddingLeft: "48px" }}
          />
          <svg className="absolute left-4 top-4 w-5 h-5 text-dvivid-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </form>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading students...</div>
      )}

      {/* Empty results */}
      {!loading && loaded && results.length === 0 && (
        <EmptyState
          title={query ? "No Students Found" : "No Students Yet"}
          description={query ? `No students match "${query}".` : "Create your first student to get started."}
          action={
            <Link href="/students/new">
              <PrimaryButton>Create New Student</PrimaryButton>
            </Link>
          }
        />
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <div className="space-y-4">
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-dvivid-text-secondary">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchStudents(query, Math.max(0, offset - PAGE_SIZE))}
                  disabled={!hasPrev || loading}
                  className="px-4 py-2 text-sm font-medium text-dvivid-text-primary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => fetchStudents(query, offset + PAGE_SIZE)}
                  disabled={!hasNext || loading}
                  className="px-4 py-2 text-sm font-medium text-dvivid-text-primary border border-dvivid-border rounded-button hover:bg-dvivid-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
