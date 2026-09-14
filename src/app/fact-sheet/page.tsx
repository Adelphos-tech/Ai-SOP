"use client";

import { LegacyRouteRedirect } from "@/components/LegacyRouteRedirect";

// ============================================================
// LEGACY ROUTE — REDIRECTED TO CANONICAL FLOW
// ============================================================
// This page was part of the old localStorage-based generation
// flow. Generation now happens through the document workspace:
// /students/{id}/applications/{id}/documents/{id}
// ============================================================

export default function Page() {
  return <LegacyRouteRedirect />;
}
