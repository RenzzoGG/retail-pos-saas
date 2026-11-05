/**
 * Returns a same-site relative path for post-login redirects, or the fallback.
 * Prevents open redirects (`?next=https://evil.example` or `//evil.example`).
 * Absolute URLs pointing at our own site are reduced to their path.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/app",
  siteUrl?: string,
): string {
  if (!next) return fallback;
  let candidate = next.trim();

  if (/^https?:\/\//i.test(candidate)) {
    if (!siteUrl) return fallback;
    try {
      const url = new URL(candidate);
      if (url.origin !== new URL(siteUrl).origin) return fallback;
      candidate = url.pathname + url.search;
    } catch {
      return fallback;
    }
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return fallback;
  }
  return candidate;
}
