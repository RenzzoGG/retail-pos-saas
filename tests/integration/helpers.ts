import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Actor } from "@/features/team/service";
import type { StoreRole } from "@/lib/permissions";
import type { Db } from "@/lib/services/result";
import { DEMO_PASSWORD, DEMO_STORE_ID, USERS } from "../fixtures/demo";

export { DEMO_PASSWORD, DEMO_STORE_ID, OTHER_STORE_ID, USERS } from "../fixtures/demo";

/** A client signed in as a demo user: exactly what the app uses for that user (RLS applies). */
export async function signInAs(user: keyof typeof USERS): Promise<Db> {
  const db = createClient(inject("supabaseUrl"), inject("supabasePublishableKey"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Db;
  const { error } = await db.auth.signInWithPassword({ email: USERS[user].email, password: DEMO_PASSWORD });
  if (error) throw new Error(`Could not sign in as ${user}: ${error.message}. Did you run npm run db:reset?`);
  return db;
}

export function actor(user: keyof typeof USERS, role: StoreRole, storeId = DEMO_STORE_ID): Actor {
  return { userId: USERS[user].id, storeId, role };
}

export async function memberId(db: Db, storeId: string, userId: string): Promise<string> {
  const { data, error } = await db
    .from("store_members")
    .select("id")
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data.id;
}
