"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  PageContainer, PageHeader, PrimaryButton, EmptyState,
  LoadingRows, ErrorState,
} from "@/components/ui";

// ============================================================
// /students — consultant worklist.
//
// Compact table on desktop, stacked rows on mobile. Per-student
// application/document counts come from ONE extra fetch
// (/api/application/list) — no N+1 calls. A "needs review"
// column is intentionally omitted: the list payload doesn't
// carry per-student review counts.
// ============================================================

interface StudentResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

interface StudentRow extends StudentResult {
  applicationCount: number;
  documentCount: number;
}

const PAGE_SIZE = 25;

function initials(s: StudentResult): string {
  return `${s.firstName?.[0] || ""}${s.lastName?.[0] || ""}`.toUpperCase() || "?";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Row actions menu — View + Delete. Keyboard accessible. */
function RowMenu({ student, onDelete }: { student: StudentRow; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        className="p-1.5 rounded-input text-dvivid-text-muted hover:text-dvivid-text-primary hover:bg-dvivid-surface-alt transition-colors"
        aria-label={`Actions for ${student.firstName} ${student.lastName}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 bg-white border border-dvivid-border rounded-input shadow-card-hover z-20 py-1"
        >
          <Link
            role="menuitem"
            href={`/students/${student.id}`}
            className="block px-4 py-2 text-sm text-dvivid-text-primary hover:bg-dvivid-surface-alt"
            onClick={() => setOpen(false)}
          >
            Open workspace
          </Link>
          <button
            role="menuitem"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); onDelete(); }}
            className="block w-full text-left px-4 py-2 text-sm text-dvivid-error hover:bg-dvivid-error-light"
          >
            Delete student
          </button>
        </div>
      )}
    </div>
  );
}

function StudentsPageInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchStudents = useCallback(async (searchQuery: string, pageOffset: number) => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({
        list: "true",
        limit: String(PAGE_SIZE),
        offset: String(pageOffset),
      });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      // Students + ONE shared application fetch for counts — no N+1.
      const [studentsRes, appsRes] = await Promise.all([
        fetch(`/api/application/student?${params}`),
        fetch(`/api/application/list?limit=500`),
      ]);
      if (!studentsRes.ok) {
        setResults([]);
        setTotal(0);
        setLoadError("Failed to load students. Please try again.");
        return;
      }
      const data = await studentsRes.json();
      const students: StudentResult[] = data.students || [];

      // Counts per student — tolerate the count fetch failing.
      const appCount = new Map<string, number>();
      const docCount = new Map<string, number>();
      if (appsRes.ok) {
        try {
          const appsData = await appsRes.json();
          for (const app of appsData.applications || []) {
            if (!app.studentId) continue;
            appCount.set(app.studentId, (appCount.get(app.studentId) || 0) + 1);
            docCount.set(app.studentId, (docCount.get(app.studentId) || 0) + (app.documentCount || 0));
          }
        } catch { /* counts optional */ }
      }

      setResults(students.map(s => ({
        ...s,
        applicationCount: appCount.get(s.id) || 0,
        documentCount: docCount.get(s.id) || 0,
      })));
      setTotal(data.total || 0);
      setOffset(pageOffset);
    } catch {
      setResults([]);
      setTotal(0);
      setLoadError("Failed to load students. Please check your connection and try again.");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchStudents(query, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        subtitle={`${total} applicant${total !== 1 ? "s" : ""} total`}
        action={
          <Link href="/students/new">
            <PrimaryButton>+ New Applicant</PrimaryButton>
          </Link>
        }
      />

      {/* Search */}
      <div className="mb-5">
        <div className="relative max-w-md">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dvivid-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email..."
            aria-label="Search students"
            className="w-full h-10 pl-10 pr-4 border border-dvivid-border rounded-input bg-white text-sm text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:ring-2 focus:ring-dvivid-primary/15 focus:border-dvivid-primary transition-colors"
          />
        </div>
      </div>

      {/* States */}
      {loading && <div className="bg-white border border-dvivid-border rounded-card"><LoadingRows rows={6} /></div>}

      {!loading && loadError && (
        <div className="bg-white border border-dvivid-border rounded-card">
          <ErrorState title="We couldn't load the student list" description={loadError} onRetry={() => fetchStudents(query, offset)} />
        </div>
      )}

      {!loading && !loadError && loaded && results.length === 0 && (
        <div className="bg-white border border-dvivid-border rounded-card">
          <EmptyState
            title={query ? "No matching applicants" : "No applicants yet"}
            description={query ? `No students match "${query}".` : "Create your first applicant to start an application."}
            action={
              !query ? (
                <Link href="/students/new">
                  <PrimaryButton>+ New Applicant</PrimaryButton>
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      {/* Worklist — desktop/tablet table */}
      {!loading && !loadError && results.length > 0 && (
        <>
          <div className="hidden sm:block bg-white border border-dvivid-border rounded-card overflow-hidden">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-dvivid-border bg-dvivid-surface-alt/60 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide">Student</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden lg:table-cell">Country</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide text-center">Apps</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide text-center hidden md:table-cell">Docs</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-dvivid-text-secondary uppercase tracking-wide hidden md:table-cell">Updated</th>
                  <th className="px-4 py-2.5 w-12" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-dvivid-border-light">
                {results.map(student => (
                  <tr key={student.id} className="hover:bg-dvivid-surface-alt/70 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/students/${student.id}`} className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0 text-xs font-semibold text-dvivid-primary">
                          {initials(student)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium text-dvivid-text-primary truncate group-hover:text-dvivid-primary">
                            {student.firstName} {student.lastName}
                          </span>
                          <span className="block text-xs text-dvivid-text-muted truncate">{student.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-dvivid-text-secondary hidden lg:table-cell">{student.country || "—"}</td>
                    <td className="px-4 py-3 text-center text-dvivid-text-secondary tabular-nums">{student.applicationCount}</td>
                    <td className="px-4 py-3 text-center text-dvivid-text-secondary tabular-nums hidden md:table-cell">{student.documentCount}</td>
                    <td className="px-4 py-3 text-dvivid-text-muted text-xs whitespace-nowrap hidden md:table-cell">{fmtDate(student.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <RowMenu student={student} onDelete={() => { setDeleteError(""); setDeleteTarget(student); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Worklist — mobile stacked rows */}
          <div className="sm:hidden bg-white border border-dvivid-border rounded-card divide-y divide-dvivid-border-light">
            {results.map(student => (
              <div key={student.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/students/${student.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-9 h-9 rounded-full bg-dvivid-primary-light flex items-center justify-center flex-shrink-0 text-xs font-semibold text-dvivid-primary">
                    {initials(student)}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sm text-dvivid-text-primary truncate">
                      {student.firstName} {student.lastName}
                    </span>
                    <span className="block text-xs text-dvivid-text-muted truncate">
                      {student.applicationCount} app{student.applicationCount !== 1 ? "s" : ""} · {student.documentCount} doc{student.documentCount !== 1 ? "s" : ""} · {fmtDate(student.updatedAt)}
                    </span>
                  </span>
                </Link>
                <RowMenu student={student} onDelete={() => { setDeleteError(""); setDeleteTarget(student); }} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-dvivid-text-secondary">Page {currentPage} of {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchStudents(query, Math.max(0, offset - PAGE_SIZE))}
                  disabled={!hasPrev || loading}
                  className="px-4 py-2 text-sm font-medium text-dvivid-text-primary border border-dvivid-border rounded-input hover:bg-dvivid-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => fetchStudents(query, offset + PAGE_SIZE)}
                  disabled={!hasNext || loading}
                  className="px-4 py-2 text-sm font-medium text-dvivid-text-primary border border-dvivid-border rounded-input hover:bg-dvivid-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete student — destructive, explicit confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !deleting && setDeleteTarget(null)} role="dialog" aria-modal="true" aria-label="Delete student">
          <div className="bg-white rounded-card shadow-card p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-dvivid-error mb-2">
              Delete {deleteTarget.firstName} {deleteTarget.lastName}?
            </p>
            <p className="text-sm text-dvivid-text-secondary mb-1">
              This will permanently delete this student, their reusable profile,
              and <strong>ALL {deleteTarget.applicationCount} application{deleteTarget.applicationCount !== 1 ? "s" : ""}</strong> with
              their documents and generation history.
            </p>
            <p className="text-sm text-dvivid-text-secondary mb-4">This cannot be undone.</p>
            {deleteError && <p className="text-sm text-dvivid-error mb-3">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError("");
                  try {
                    const res = await fetch("/api/application/student/delete", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ studentId: deleteTarget.id }),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      setDeleteError(data.error || "Failed to delete student.");
                      return;
                    }
                    setDeleteTarget(null);
                    fetchStudents(query, offset);
                  } catch {
                    setDeleteError("Failed to delete student.");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-input bg-dvivid-error text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, delete this student"}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-input border border-dvivid-border text-dvivid-text-primary hover:bg-dvivid-surface-alt transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default function StudentsPage() {
  return (
    <Suspense fallback={<PageContainer><LoadingRows rows={6} /></PageContainer>}>
      <StudentsPageInner />
    </Suspense>
  );
}
