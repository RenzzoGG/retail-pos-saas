import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  SUPABASE_AUTH_COOKIE,
  getServerSupabaseUrl,
  getSupabasePublishableKey,
} from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/** Areas that need a signed-in user. */
const PROTECTED_PREFIXES = ["/app", "/onboarding", "/invite"];
/** Pages that make no sense once signed in. */
const GUEST_ONLY = ["/login", "/signup"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Runs before every matched request (src/proxy.ts).
 *
 * 1. Refreshes the Supabase session: the access token (JWT) lives ~1 h; when it
 *    expires, getClaims() uses the refresh token and @supabase/ssr writes the new
 *    cookies both to the request (so Server Components see them now) and to the
 *    response (so the browser stores them).
 * 2. Optimistic redirects only. This is NOT the security boundary: every page,
 *    Server Action and the database (RLS) check access again.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getServerSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): the session
  // refresh must happen before any decision is made.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    const [pathOnly, query] = path.split("?");
    url.pathname = pathOnly ?? "/";
    url.search = query ? `?${query}` : "";
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed session cookies on the redirect response.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!signedIn && matches(pathname, PROTECTED_PREFIXES)) {
    return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  if (signedIn && matches(pathname, GUEST_ONLY)) {
    return redirectTo("/app");
  }
  return response;
}
