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

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return DEVELOPMENT_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute URL, like https://stocktill.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use http or https.");
  }
  // Only the origin: the app has no basePath, and a trailing slash or path
  // would produce links like https://site//auth/confirm.
  return url.origin;
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
