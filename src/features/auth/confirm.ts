import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Where /auth/confirm sends the user after a valid email link.
 *
 * `next` comes from the email template: {{ .RedirectTo }} for the sign-up
 * confirmation (absolute, from emailRedirectTo, or empty), a fixed
 * "/reset-password" for the recovery email.
 *
 * - empty, another origin, or anything unsafe → the default for the link type;
 * - "/" → the default too: Supabase replaces a RedirectTo that is not in its
 *   Redirect URLs allow-list with the bare Site URL, which would otherwise drop
 *   a newly confirmed user on the landing page;
 * - otherwise the same-site path.
 *
 * Default after confirming an account: /app. A user without a store is sent on
 * to /onboarding by the app itself; a user who already created one (and clicks
 * the link again) lands on the dashboard.
 */
export function confirmDestination(next: string | null | undefined, type: EmailOtpType | null): string {
  const fallback = type === "recovery" ? "/reset-password" : "/app";
  const path = safeNextPath(next, fallback);
  return path === "/" ? fallback : path;
}
