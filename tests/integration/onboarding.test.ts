import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createStore } from "@/features/stores/service";
import type { Db } from "@/lib/services/result";

/**
 * Onboarding double submit against the real database: two "Create store"
 * requests with the same form key at the same time (each HTTP request is its
 * own connection) must leave exactly one store and one membership.
 *
 * Uses a brand-new user (signed up and confirmed through the local Mailpit
 * inbox, like a real user) so the seeded demo users keep exactly their stores.
 */
const MAILPIT_URL = "http://localhost:54324";
const run = Date.now();
const email = `onboarding-${run}@e2e.stocktill.test`;
const password = `onboarding-${run}-Pass`; // throwaway password for a throwaway local user

function newClient(): Db {
  return createClient(inject("supabaseUrl"), inject("supabasePublishableKey"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Db;
}

async function confirmationTokenHash(to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string }[] };
    const first = messages[0];
    if (first) {
      const { HTML } = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${first.ID}`)).json()) as { HTML: string };
      const hash = /token_hash=([^&"]+)/.exec(HTML)?.[1];
      if (hash) return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No confirmation email for ${to}`);
}

const settings = { name: `Double Submit ${run}`, currency: "USD", taxRate: 0.0825, pricesIncludeTax: true, timezone: "UTC" };

describe("onboarding double submit", () => {
  let db: Db;
  let userId: string;

  beforeAll(async () => {
    const anon = newClient();
    const { error } = await anon.auth.signUp({ email, password });
    if (error) throw error;
    db = newClient();
    const { data, error: verifyError } = await db.auth.verifyOtp({
      type: "email",
      token_hash: await confirmationTokenHash(email),
    });
    if (verifyError || !data.user) throw verifyError ?? new Error("No user after confirming");
    userId = data.user.id;
  });

  it("two simultaneous submits with the same key create one store", async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([createStore(db, settings, key), createStore(db, settings, key)]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data).toBe(first.data);

    const { data: memberships } = await db.from("store_members").select("store_id, role").eq("user_id", userId);
    expect(memberships).toEqual([{ store_id: first.data, role: "owner" }]);
  });

  it("a later retry with the same key still returns the same store", async () => {
    const key = randomUUID();
    const first = await createStore(db, { ...settings, name: `Retry ${run}` }, key);
    const retry = await createStore(db, { ...settings, name: `Retry ${run}` }, key);
    expect(first.ok && retry.ok && retry.data === first.data).toBe(true);

    const { count } = await db.from("stores").select("id", { count: "exact", head: true }).eq("name", `Retry ${run}`);
    expect(count).toBe(1);
  });
});
