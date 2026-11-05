import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptInvitation, createInvitation, previewInvitation, removeMember } from "@/features/team/service";
import type { Db } from "@/lib/services/result";
import { OTHER_STORE_ID, USERS, actor, memberId, signInAs } from "./helpers";

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
