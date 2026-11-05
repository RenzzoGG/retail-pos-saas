import { createBrowserClient } from "@supabase/ssr";
import {
  SUPABASE_AUTH_COOKIE,
  getPublicSupabaseUrl,
  getSupabasePublishableKey,
} from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/** Supabase client for Client Components (runs in the browser). */
export function createClient() {
  return createBrowserClient<Database>(getPublicSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
  });
}
