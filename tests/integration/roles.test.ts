import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStoreSettings, updateStoreSettings } from "@/features/stores/service";
import { changeMemberRole, createInvitation, listMembers, removeMember, revokeInvitation } from "@/features/team/service";
import { hashInvitationToken } from "@/features/team/tokens";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, USERS, actor, memberId, signInAs } from "./helpers";

const settings = {
  name: "Stocktill Demo Electronics",
  currency: "USD",
  taxRate: 0.0825,
  pricesIncludeTax: true,
  timezone: "America/New_York",
};

describe("cashier (through the app services and directly against the API)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await signInAs("cashier");
  });

  it("can see the team", async () => {
    const members = await listMembers(db, actor("cashier", "cashier"));
    expect(members.ok && members.data.map((m) => m.email)).toContain(USERS.owner.email);
  });

  it("cannot change store settings", async () => {
    const result = await updateStoreSettings(db, { storeId: DEMO_STORE_ID, role: "cashier" }, { ...settings, taxRate: 0 });
    expect(result.ok).toBe(false);
    // Bypassing the server check does not help: RLS updates 0 rows.
    const { data } = await db.from("stores").update({ tax_rate: 0 }).eq("id", DEMO_STORE_ID).select("id");
    expect(data).toEqual([]);
  });

  it("cannot invite anyone", async () => {
    const result = await createInvitation(db, actor("cashier", "cashier"), { email: "x@example.com", role: "cashier" });
    expect(result.ok).toBe(false);
    const { error } = await db.from("invitations").insert({
      store_id: DEMO_STORE_ID,
      email: "x@example.com",
      role: "cashier",
      token_hash: hashInvitationToken("cashier-attempt-token-000000"),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(error?.code).toBe("42501");
  });

  it("cannot change roles or remove members", async () => {
    const adminMember = await memberId(db, DEMO_STORE_ID, USERS.admin.id);
    expect((await changeMemberRole(db, actor("cashier", "cashier"), adminMember, "cashier")).ok).toBe(false);
    expect((await removeMember(db, actor("cashier", "cashier"), adminMember)).ok).toBe(false);
    const { data } = await db.from("store_members").delete().eq("id", adminMember).select("id");
    expect(data).toEqual([]);
  });

  it("never sees costs", async () => {
    const { data } = await db.from("product_costs").select("product_id");
    expect(data).toEqual([]);
  });
});

describe("admin", () => {
  let db: Db;
  const created: string[] = [];
  beforeAll(async () => {
    db = await signInAs("admin");
  });
  afterAll(async () => {
    for (const id of created) await revokeInvitation(db, actor("admin", "admin"), id);
    await updateStoreSettings(db, { storeId: DEMO_STORE_ID, role: "admin" }, settings);
  });

  it("can invite a cashier", async () => {
    const result = await createInvitation(db, actor("admin", "admin"), {
      email: `cashier-${Date.now()}@example.com`,
      role: "cashier",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      created.push(result.data.id);
      expect(result.data.token.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("cannot invite an admin (server and database)", async () => {
    const result = await createInvitation(db, actor("admin", "admin"), { email: "boss@example.com", role: "admin" });
    expect(result.ok).toBe(false);
    const { error } = await db.from("invitations").insert({
      store_id: DEMO_STORE_ID,
      email: "boss@example.com",
      role: "admin",
      token_hash: hashInvitationToken("admin-attempt-token-00000000"),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(error?.code).toBe("42501");
  });

  it("cannot demote the owner or promote a cashier to admin", async () => {
    const ownerMember = await memberId(db, DEMO_STORE_ID, USERS.owner.id);
    const cashierMember = await memberId(db, DEMO_STORE_ID, USERS.cashier.id);
    expect((await changeMemberRole(db, actor("admin", "admin"), ownerMember, "cashier")).ok).toBe(false);
    expect((await changeMemberRole(db, actor("admin", "admin"), cashierMember, "admin")).ok).toBe(false);
    const { error } = await db.from("store_members").update({ role: "admin" }).eq("id", cashierMember);
    expect(error?.code).toBe("42501");
  });

  it("can change store settings", async () => {
    const update = await updateStoreSettings(db, { storeId: DEMO_STORE_ID, role: "admin" }, { ...settings, taxRate: 0.07 });
    expect(update.ok).toBe(true);
    const read = await getStoreSettings(db, DEMO_STORE_ID);
    expect(read.ok && read.data.taxRate).toBe(0.07);
  });
});

describe("owner", () => {
  let db: Db;
  beforeAll(async () => {
    db = await signInAs("owner");
  });

  it("can promote a cashier to admin and back", async () => {
    const cashierMember = await memberId(db, DEMO_STORE_ID, USERS.cashier.id);
    try {
      expect((await changeMemberRole(db, actor("owner", "owner"), cashierMember, "admin")).ok).toBe(true);
      const members = await listMembers(db, actor("owner", "owner"));
      expect(members.ok && members.data.find((m) => m.userId === USERS.cashier.id)?.role).toBe("admin");
    } finally {
      expect((await changeMemberRole(db, actor("owner", "owner"), cashierMember, "cashier")).ok).toBe(true);
    }
  });

  it("cannot leave the store without another owner", async () => {
    const ownerMember = await memberId(db, DEMO_STORE_ID, USERS.owner.id);
    const result = await removeMember(db, actor("owner", "owner"), ownerMember);
    expect(result).toMatchObject({ ok: false, code: "store_needs_owner" });
  });
});
