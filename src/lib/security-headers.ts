/**
 * HTTP security headers for every route (applied from next.config.ts).
 *
 * The CSP is STATIC (same for every response) on purpose: the app uses
 * Cache Components / Partial Prerendering, and Next.js can only add nonces to
 * dynamically rendered pages. A static policy keeps the landing prerendered
 * (Lighthouse, phase 10) at the cost of allowing inline scripts, which Next.js
 * needs for hydration. Everything else is locked down: scripts only from this
 * origin, no framing, forms only to this origin and Stripe's hosted pages.
 */

export type SecurityHeaderOptions = {
  /** NEXT_PUBLIC_SUPABASE_URL (the browser may talk to Supabase directly). */
  supabaseUrl?: string;
  /** NEXT_PUBLIC_SITE_URL: HSTS and upgrade-insecure-requests only over https. */
  siteUrl?: string;
  /** `next dev` needs eval for React's dev tooling and Fast Refresh. */
  isDev: boolean;
};

export type Header = { key: string; value: string };

/** Stripe-hosted pages the app sends the user to (Checkout and Billing Portal). */
const STRIPE_HOSTED = ["https://checkout.stripe.com", "https://billing.stripe.com"];

function origins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const { protocol, host } = new URL(url);
    const ws = protocol === "https:" ? "wss:" : "ws:";
    return [`${protocol}//${host}`, `${ws}//${host}`];
  } catch {
    return [];
  }
}

function isHttps(url: string | undefined): boolean {
  return !!url && url.startsWith("https://");
}

export function buildContentSecurityPolicy({ supabaseUrl, siteUrl, isDev }: SecurityHeaderOptions): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // GSAP and SplitText write inline styles; Next.js inlines critical CSS.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    // next/font self-hosts Geist: no third-party font origin.
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...origins(supabaseUrl)],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'", ...STRIPE_HOSTED],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["manifest-src", "'self'"],
    ["worker-src", "'self'", "blob:"],
  ];
  const policy = directives.map((d) => d.join(" "));
  if (isHttps(siteUrl) && !isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Header[] {
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    // Legacy twin of frame-ancestors for old browsers (clickjacking).
    { key: "X-Frame-Options", value: "DENY" },
    // Full URL only to this origin; other sites only see the origin (no paths, ids or tokens).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Never guess a MIME type (an uploaded file can't be run as a script).
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The POS uses USB barcode readers (keyboard input), not the camera.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (isHttps(options.siteUrl) && !options.isDev) {
    // Two years. No `preload`: that is a hard-to-undo browser list entry for the domain.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
