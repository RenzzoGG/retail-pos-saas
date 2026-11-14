import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptInvitation, createInvitation, getPendingInvitation, previewInvitation, removeMember } from "@/features/team/service";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, OTHER_STORE_ID, USERS, actor, memberId, signInAs } from "./helpers";

/**
 * Full invitation round trip with real users: the Other Shop owner invites the
 * demo cashier, who previews and accepts it. Cleaned up afterwards.
 */
describe("invitation round trip", () => {
  let otherOwner: Db;
  let cashier: Db;
  let admin: Db;
  let token = "";

  beforeAll(async () => {
    [otherOwner, cashier, admin] = await Promise.all([signInAs("otherOwner"), signInAs("cashier"), signInAs("admin")]);
    const invite = await createInvitation(otherOwner, actor("otherOwner", "owner", OTHER_STORE_ID), {
      email: USERS.cashier.email,
      role: "cashier",
    });
    if (!invite.ok) throw new Error(invite.error);
    token = invite.data.token;
  });

  afterAll(async () => {
    // Remove the membership created by the test (owner of Other Shop can do it).
    const { data } = await otherOwner
      .from("store_members")
      .select("id")
      .eq("store_id", OTHER_STORE_ID)
      .eq("user_id", USERS.cashier.id);
    for (const row of data ?? []) await removeMember(otherOwner, actor("otherOwner", "owner", OTHER_STORE_ID), row.id);
    await otherOwner.from("invitations").delete().eq("store_id", OTHER_STORE_ID).eq("email", USERS.cashier.email);
  });

  it("the invitee sees a preview", async () => {
    const preview = await previewInvitation(cashier, token);
    expect(preview.ok && preview.data).toMatchObject({ storeName: "Other Shop", role: "cashier", status: "pending" });
  });

  it("someone with a different email cannot accept it", async () => {
    const result = await acceptInvitation(admin, token);
    expect(result).toMatchObject({ ok: false, code: "invitation_email_mismatch" });
  });

  it("the invitee accepts and becomes a cashier of the second store", async () => {
    const result = await acceptInvitation(cashier, token);
    expect(result).toEqual({ ok: true, data: OTHER_STORE_ID });
    const id = await memberId(otherOwner, OTHER_STORE_ID, USERS.cashier.id);
    expect(id).toBeTruthy();
    const { data } = await cashier.from("stores").select("id");
    expect(data?.map((s) => s.id).sort()).toEqual([OTHER_STORE_ID, "b0000000-0000-4000-8000-000000000001"].sort());
  });

  it("the link cannot be used twice", async () => {
    const result = await acceptInvitation(cashier, token);
    expect(result).toMatchObject({ ok: false, code: "invitation_already_used" });
  });
});

/**
 * Resend (team page): the invitation is re-created with a new link. The old
 * link stops working, only managers of the store can read it, and an admin
 * can't resend an admin invitation (RLS).
 */
describe("resending an invitation", () => {
  let owner: Db;
  let admin: Db;
  let otherOwner: Db;
  const email = `resend-${Date.now()}@example.com`;

  beforeAll(async () => {
    [owner, admin, otherOwner] = await Promise.all([signInAs("owner"), signInAs("admin"), signInAs("otherOwner")]);
  });

  afterAll(async () => {
    await owner.from("invitations").delete().eq("store_id", DEMO_STORE_ID).eq("email", email);
  });

  it("issues a new link and invalidates the old one", async () => {
    const ownerActor = actor("owner", "owner");
    const first = await createInvitation(owner, ownerActor, { email, role: "admin" });
    if (!first.ok) throw new Error(first.error);

    const pending = await getPendingInvitation(owner, ownerActor, first.data.id);
    expect(pending).toEqual({ ok: true, data: { email, role: "admin" } });

    const second = await createInvitation(owner, ownerActor, pending.ok ? pending.data : { email, role: "admin" });
    if (!second.ok) throw new Error(second.error);
    expect(second.data.token).not.toBe(first.data.token);

    const { data: rows } = await owner.from("invitations").select("id").eq("store_id", DEMO_STORE_ID).eq("email", email);
    expect(rows?.map((r) => r.id)).toEqual([second.data.id]);
    expect(await previewInvitation(owner, first.data.token)).toEqual({ ok: true, data: null });
    const fresh = await previewInvitation(owner, second.data.token);
    expect(fresh.ok && fresh.data).toMatchObject({ email, role: "admin", status: "pending" });

    // Another store's owner can't see it, and an admin can't re-create an admin invitation.
    expect(await getPendingInvitation(otherOwner, actor("otherOwner", "owner", DEMO_STORE_ID), second.data.id)).toMatchObject({ ok: false });
    expect(await createInvitation(admin, actor("admin", "admin"), { email, role: "admin" })).toMatchObject({ ok: false, code: "forbidden" });
  });
});
