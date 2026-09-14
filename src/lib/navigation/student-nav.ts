// ============================================================
// NAVIGATION HELPER
// Phase SOP-AI-31
// ============================================================
// Preserves active studentId across intake page navigation.
// ============================================================

/**
 * Build a URL with the current studentId query parameter preserved.
 * Usage: hrefWithStudent("/education") → "/education?studentId=ABC"
 */
export function hrefWithStudent(path: string, studentId?: string | null): string {
  if (!studentId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}studentId=${studentId}`;
}

/**
 * Extract studentId from the current URL search params.
 * Safe to call in client components.
 */
export function getStudentIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("studentId");
}

/**
 * Get the next/prev section path with studentId preserved.
 */
export function sectionPathWithStudent(
  section: string,
  studentId?: string | null,
): string {
  return hrefWithStudent(`/${section}`, studentId);
}
