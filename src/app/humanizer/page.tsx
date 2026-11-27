// ============================================================
// /humanizer — standalone "Humanizer & AI Check" module.
// Consultants humanize externally-written SOP text and run AI
// detection reports without creating a student/application first.
// Auth is enforced by the global AuthGuard + session checks inside
// every /api/standalone-studio/* route.
// ============================================================

import { StandaloneStudio } from "@/components/standalone/StandaloneStudio";

export default function HumanizerPage() {
  return <StandaloneStudio />;
}
