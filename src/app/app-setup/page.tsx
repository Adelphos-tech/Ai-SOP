"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ============================================================
// /app-setup — REDIRECTED TO CANONICAL NEW APPLICANT FLOW
// ============================================================
// The parallel creation workflow is removed.
// All new applicants go through /students/new.
// ============================================================

export default function AppSetupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/students/new");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-dvivid-page-bg">
      <div className="text-center">
        <div className="w-8 h-8 border-3 border-dvivid-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-dvivid-text-secondary">Redirecting to new applicant...</p>
      </div>
    </div>
  );
}
