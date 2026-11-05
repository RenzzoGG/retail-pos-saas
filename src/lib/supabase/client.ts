import { createBrowserClient } from "@supabase/ssr";
import {
  SUPABASE_AUTH_COOKIE,
  getPublicSupabaseUrl,
  getSupabasePublishableKey,
} from "@/lib/env";

/** Supabase client for Client Components (runs in the browser). */
export function createClient() {
  return createBrowserClient(getPublicSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
  });
}
