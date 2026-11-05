import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  SUPABASE_AUTH_COOKIE,
  getServerSupabaseUrl,
  getSupabasePublishableKey,
} from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * It acts as the signed-in user (session read from cookies), so RLS applies.
 * Create one per request; never share it between requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getServerSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The session refresh will be handled by middleware/proxy (phase 3).
        }
      },
    },
  });
}
