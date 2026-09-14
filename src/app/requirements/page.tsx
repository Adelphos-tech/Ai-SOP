"use client";

import { LegacyRouteRedirect } from "@/components/LegacyRouteRedirect";

// ============================================================
// LEGACY ROUTE — REDIRECTED TO CANONICAL FLOW
// ============================================================
// Requirements lookup now happens in the application workspace.
// ============================================================

export default function Page() {
  return <LegacyRouteRedirect />;
}
