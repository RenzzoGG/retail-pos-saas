import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabaseUrl, getSupabaseSecretKey } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client with the SECRET key: it bypasses RLS. Only the Stripe webhook
 * may use it (it is a server-to-server call with no signed-in user), and it only
 * calls apply_stripe_event. ESLint forbids importing this file anywhere else.
 */
export function createAdminClient() {
  return createClient<Database>(getServerSupabaseUrl(), getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
