"use client";

import { LegacyRouteRedirect } from "@/components/LegacyRouteRedirect";

// ============================================================
// LEGACY ROUTE — REDIRECTED TO CANONICAL FLOW
// ============================================================
// This page used the old ProfileContext/localStorage flow.
// Profile editing now happens only through the canonical
// 9-section intake in the application workspace.
// ============================================================

export default function Page() {
  return <LegacyRouteRedirect />;
}
