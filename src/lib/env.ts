/**
 * Typed, lazy access to environment variables.
 *
 * Values are read only when a getter is called (not at import time), so
 * `next build` and CI do not need real Supabase keys until a feature uses them.
 *
 * NEXT_PUBLIC_* values must be referenced literally (process.env.NEXT_PUBLIC_X)
 * so Next.js can inline them into the browser bundle.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** URL the browser uses to reach Supabase (e.g. http://127.0.0.1:54321). */
export function getPublicSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Publishable (anon) key: safe for the browser, every request is still subject to RLS. */
export function getSupabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * URL the Next.js *server* uses to reach Supabase. Inside Docker Compose,
 * 127.0.0.1 is the app container itself, so SUPABASE_INTERNAL_URL points to the
 * host (http://host.docker.internal:54321). Outside Docker it falls back to the public URL.
 */
export function getServerSupabaseUrl(): string {
  return process.env.SUPABASE_INTERNAL_URL || getPublicSupabaseUrl();
}

/**
 * Fixed auth cookie name. By default @supabase/ssr derives it from the URL's
 * hostname, which would differ between server (host.docker.internal) and
 * browser (127.0.0.1) and break the session.
 */
export const SUPABASE_AUTH_COOKIE = "sb-stocktill-auth-token";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string | undefined;
  pass: string | undefined;
  from: string;
};

/**
 * SMTP settings for app emails (invitations). Outside production, missing
 * values default to the local Mailpit SMTP port exposed by the Supabase CLI
 * (supabase/config.toml -> [local_smtp] smtp_port = 54325), so `npm run dev`
 * works without extra configuration. In production they are required.
 */
export function getSmtpConfig(): SmtpConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const host = process.env.SMTP_HOST || (isProduction ? "" : "127.0.0.1");
  const port = Number(process.env.SMTP_PORT || (isProduction ? "" : "54325"));
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error("Missing SMTP_HOST / SMTP_PORT. See .env.example.");
  }
  return {
    host,
    port,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.EMAIL_FROM || "Stocktill <no-reply@stocktill.test>",
  };
}

/**
 * Server-only Supabase key that BYPASSES RLS. Only the Stripe webhook uses it
 * (src/lib/supabase/admin.ts; ESLint forbids importing that file elsewhere).
 */
export function getSupabaseSecretKey(): string {
  return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
}

export type StripeConfig = { secretKey: string; priceId: string };

/**
 * Stripe (test mode) for Checkout and the Billing Portal. null when it isn't
 * configured (CI, local without keys): the Billing page says so instead of failing.
 * Live keys are refused: this project only runs in Stripe test mode.
 */
export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const priceId = process.env.STRIPE_PRICE_ID ?? "";
  if (!secretKey || !priceId || secretKey.includes("example") || priceId.includes("example")) return null;
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a TEST key (sk_test_…). Live keys are not allowed.");
  }
  return { secretKey, priceId };
}

/** Signing secret of the webhook endpoint (whsec_…), from `stripe listen` or the Dashboard. */
export function getStripeWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  return secret && !secret.includes("example") ? secret : null;
}
