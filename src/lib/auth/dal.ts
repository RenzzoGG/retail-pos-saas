import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { isStoreRole, type StoreRole } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer: the real authorization checks for pages and Server
 * Actions (the Proxy only does optimistic redirects). React's cache() makes
 * each function run once per request even if many components call it.
 */

export const ACTIVE_STORE_COOKIE = "stocktill_active_store";

export type SessionUser = { id: string; email: string };
/** isDemo: the public demo store (phase 11), where team and settings are locked. */
export type Membership = { storeId: string; storeName: string; role: StoreRole; isDemo: boolean };
export type StoreContext = {
  user: SessionUser;
  store: Membership;
  memberships: Membership[];
};

/** Verified user from the session cookie, or null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // The session check compares the token expiry with the current time
  // (Date.now() inside supabase-js). Mark it as request-time work so Next.js
  // never tries to prerender it into the static shell.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return { id: sub, email };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Stores the user belongs to (read through RLS as the user). */
export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_members")
    .select("store_id, role, stores(name, is_demo)")
    .eq("user_id", user.id);
  if (error) throw new Error("Could not load your stores.");
  return (data ?? [])
    .filter((row) => isStoreRole(row.role))
    .map((row) => ({
      storeId: row.store_id,
      storeName: row.stores?.name ?? "Store",
      role: row.role,
      isDemo: row.stores?.is_demo ?? false,
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
});

/**
 * The active store. The cookie only remembers the user's choice; it is never
 * trusted: if it names a store the user is not a member of (tampered, or the
 * membership was removed), we fall back to their first store.
 */
export const requireStoreContext = cache(async (): Promise<StoreContext> => {
  const user = await requireUser();
  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value;
  const store = memberships.find((m) => m.storeId === wanted) ?? (memberships[0] as Membership);
  return { user, store, memberships };
});

/** Pages/actions restricted to some roles. Unknown to others: 404, not a hint. */
export async function requireRole(roles: readonly StoreRole[]): Promise<StoreContext> {
  const context = await requireStoreContext();
  if (!roles.includes(context.store.role)) notFound();
  return context;
}

export function activeStoreCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}
