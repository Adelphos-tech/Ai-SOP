/**
 * Path to send a consultant to after sign-in. Only same-origin
 * targets are honoured; anything else falls back.
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  origin: string,
  fallback = "/students",
): string {
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // "/.//host" normalizes to "//host", which browsers resolve to another origin.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}
