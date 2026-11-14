import { getSiteUrl } from "@/lib/site-url";

/**
 * Returns a same-site path ("/invite/abc?x=1") to redirect to after sign-in,
 * sign-up or an email link, or `fallback`. Prevents open redirects.
 *
 * Accepted:
 * - app-relative paths that start with a single "/";
 * - absolute http(s) URLs on our own origin (`siteUrl`), reduced to their path.
 *   Supabase's {{ .RedirectTo }} is absolute: it echoes the emailRedirectTo
 *   that sign-up sends.
 *
 * Everything else falls back: other origins, protocol-relative "//evil.example",
 * "/\evil.example", "javascript:", bare "evil.example". The candidate is parsed
 * with the WHATWG URL parser (the one browsers use) and its origin compared, so
 * tricks like "/\t/evil.example" (tabs are stripped) can't slip through.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/app",
  siteUrl: string = getSiteUrl(),
): string {
  const candidate = next?.trim();
  if (!candidate) return fallback;

  const isAbsolute = /^https?:\/\//i.test(candidate);
  if (!isAbsolute && (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\"))) {
    return fallback;
  }

  try {
    const base = new URL(siteUrl);
    const url = new URL(candidate, base);
    if (url.origin !== base.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
