"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

// ============================================================
// LEGACY ROUTE REDIRECT
// ============================================================
// Redirects legacy localStorage-based pages to canonical
// database-backed destinations.
//
// If ?studentId=... is present → /students/{studentId}
// Otherwise → /students
//
// This prevents consultants from entering the legacy
// ProfileContext/localStorage flow and ensures only the
// canonical 9-section intake is used for profile editing.
// ============================================================

function LegacyRedirectInner({ fallback = "/students" }: { fallback?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId");

  useEffect(() => {
    if (studentId) {
      router.replace(`/students/${studentId}`);
    } else {
      router.replace(fallback);
    }
  }, [router, studentId, fallback]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-dvivid-page-bg">
      <div className="text-center">
        <div className="w-8 h-8 border-3 border-dvivid-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-dvivid-text-secondary">Redirecting to student workspace…</p>
      </div>
    </div>
  );
}

export function LegacyRouteRedirect({ fallback = "/students" }: { fallback?: string }) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LegacyRedirectInner fallback={fallback} />
    </Suspense>
  );
}
