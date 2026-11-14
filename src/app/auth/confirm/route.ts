import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { confirmDestination } from "@/features/auth/confirm";
import { absoluteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["email", "signup", "recovery", "email_change"];

/**
 * Landing point for links in Supabase emails (confirmation, password reset):
 * {{ .SiteURL }}/auth/confirm?token_hash=…&type=email|recovery&next=…
 *
 * Exchanges the one-time token_hash for a session (cookies are set here) and
 * redirects. Works even if the email is opened in a different browser.
 *
 * - `next` never causes an error: empty, foreign or malformed values fall back
 *   to the default destination (see confirmDestination).
 * - The token is single-use. A second request with the same link (double click,
 *   a reload, or the user retrying after a failed redirect) fails
 *   verifyOtp; if this browser already holds a valid session, that first
 *   request worked, so the user continues instead of seeing "invalid link".
 * - Redirects always go to the canonical origin (src/lib/site-url.ts).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const type = ALLOWED_TYPES.find((t) => t === rawType) ?? null;
  const destination = confirmDestination(searchParams.get("next"), type);

  const supabase = await createClient();
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(absoluteUrl(destination));
  }

  // getClaims() verifies the session JWT; a forged cookie doesn't pass.
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return NextResponse.redirect(absoluteUrl(destination));

  return NextResponse.redirect(absoluteUrl("/login?error=invalid_link"));
}
