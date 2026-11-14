/**
 * Canonical public origin of the app (e.g. https://stocktill.renzzogg.com).
 *
 * Every absolute URL the app builds (redirects from route handlers and the
 * Proxy, email links, Stripe return URLs, metadata) must start here, never
 * from the incoming request:
 *
 * - `request.url` / `request.nextUrl.origin` is the address the server is bound
 *   to. In the Docker image (HOSTNAME=0.0.0.0, PORT=3000) behind Railway's
 *   proxy, Next.js reports it as https://0.0.0.0:3000, which no browser can open.
 * - The Host / X-Forwarded-Host headers come from the client and can be forged,
 *   so building redirects from them would be an open redirect.
 *
 * NEXT_PUBLIC_SITE_URL is a build argument (it is also used by the CSP and the
 * browser bundle). When it is not set (local development, unit tests, the CI
 * build job) the app falls back to http://localhost:3000. The Dockerfile
 * refuses to build a production image without it.
 */
const DEVELOPMENT_ORIGIN = "http://localhost:3000";

export type SiteUrlParse = { ok: true; url: URL } | { ok: false; reason: "empty" | "not_absolute" | "not_http" };

/**
 * The one place that reads a site URL value: trims it (a stray space pasted
 * into the Railway panel is common), parses it with `new URL` (which also
 * lowercases the scheme: "HTTPS://x" is https) and only accepts http(s).
 * getSiteUrl() and the security headers (HSTS, upgrade-insecure-requests) both
 * use it, so they can never disagree about the same value.
 */
export function parseSiteUrl(raw: string | undefined): SiteUrlParse {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: "empty" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "not_absolute" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "not_http" };
  return { ok: true, url };
}

/** True when the value is a valid https URL, after the same normalization as getSiteUrl(). */
export function isHttpsSiteUrl(raw: string | undefined): boolean {
  const parsed = parseSiteUrl(raw);
  return parsed.ok && parsed.url.protocol === "https:";
}

export function getSiteUrl(): string {
  const parsed = parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (!parsed.ok) {
    if (parsed.reason === "empty") return DEVELOPMENT_ORIGIN;
    throw new Error(
      parsed.reason === "not_absolute"
        ? "NEXT_PUBLIC_SITE_URL must be an absolute URL, like https://stocktill.example.com"
        : "NEXT_PUBLIC_SITE_URL must use http or https.",
    );
  }
  // Only the origin: the app has no basePath, and a trailing slash or path
  // would produce links like https://site//auth/confirm.
  return parsed.url.origin;
}

/**
 * Absolute URL for an app path ("/login?error=x"), on the canonical origin.
 * Only app-relative paths are accepted, so callers can't produce a redirect to
 * another site by accident ("//evil.example" is protocol-relative).
 */
export function absoluteUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error(`absoluteUrl() expects an app-relative path, got "${path}"`);
  }
  return new URL(path, `${getSiteUrl()}/`);
}
