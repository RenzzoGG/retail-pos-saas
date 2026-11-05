import { assignableRoles, canManageRole, invitableRoles, isManager, type StoreRole } from "@/lib/permissions";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import type { InviteInput } from "./schemas";
import { INVITATION_TTL_DAYS, generateInvitationToken, hashInvitationToken } from "./tokens";

export type Actor = { userId: string; storeId: string; role: StoreRole };

export type Member = {
  id: string;
  userId: string;
  role: StoreRole;
  name: string | null;
  email: string | null;
  joinedAt: string;
  isYou: boolean;
};

export type InvitationStatus = "pending" | "expired" | "accepted";

export type Invitation = {
  id: string;
  email: string;
  role: StoreRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
};

export function invitationStatus(row: { accepted_at: string | null; expires_at: string }, now = new Date()): InvitationStatus {
  if (row.accepted_at) return "accepted";
  return new Date(row.expires_at) <= now ? "expired" : "pending";
}

export async function listMembers(db: Db, actor: Actor): Promise<Result<Member[]>> {
  const { data: rows, error } = await db
    .from("store_members")
    .select("id, user_id, role, created_at")
    .eq("store_id", actor.storeId)
    .order("created_at");
  if (error) return fail(error);

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: profiles, error: profileError } = ids.length
    ? await db.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [], error: null };
  if (profileError) return fail(profileError);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  return ok(
    (rows ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      role: r.role,
      name: byId.get(r.user_id)?.full_name ?? null,
      email: byId.get(r.user_id)?.email ?? null,
      joinedAt: r.created_at,
      isYou: r.user_id === actor.userId,
    })),
  );
}

/** Pending and expired invitations (accepted ones become members). Owner/admin only. */
export async function listInvitations(db: Db, actor: Actor): Promise<Result<Invitation[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, expires_at, accepted_at, created_at")
    .eq("store_id", actor.storeId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) return fail(error);
  return ok(
    (data ?? []).map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: invitationStatus(r),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  );
}

/**
 * Creates an invitation and returns the raw token (to email it). Only its
 * SHA-256 hash is stored. Re-inviting the same email replaces the old link.
 */
export async function createInvitation(
  db: Db,
  actor: Actor,
  input: InviteInput,
): Promise<Result<{ id: string; token: string; expiresAt: Date }>> {
  if (!invitableRoles(actor.role).includes(input.role)) return forbidden();

  const members = await listMembers(db, actor);
  if (!members.ok) return members;
  if (members.data.some((m) => m.email === input.email)) {
    return { ok: false, error: "That person is already a member of this store.", code: "already_member" };
  }

  // Replace a previous pending invitation for the same email (RLS limits what we can delete).
  const { error: deleteError } = await db
    .from("invitations")
    .delete()
    .eq("store_id", actor.storeId)
    .eq("email", input.email)
    .is("accepted_at", null);
  if (deleteError) return fail(deleteError);

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await db
    .from("invitations")
    .insert({
      store_id: actor.storeId,
      email: input.email,
      role: input.role,
      token_hash: hashInvitationToken(token),
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "There is already a pending invitation for that email.", code: "duplicate" };
    }
    return fail(error);
  }
  return ok({ id: data.id, token, expiresAt });
}

export async function revokeInvitation(db: Db, actor: Actor, invitationId: string): Promise<Result<null>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("invitations")
    .delete()
    .eq("id", invitationId)
    .eq("store_id", actor.storeId)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}

async function getMember(db: Db, actor: Actor, memberId: string) {
  return db
    .from("store_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("store_id", actor.storeId)
    .maybeSingle();
}

export async function changeMemberRole(
  db: Db,
  actor: Actor,
  memberId: string,
  role: StoreRole,
): Promise<Result<null>> {
  const { data: member, error } = await getMember(db, actor, memberId);
  if (error) return fail(error);
  if (!member) return { ok: false, error: "Member not found.", code: "not_found" };
  if (!canManageRole(actor.role, member.role) || !assignableRoles(actor.role).includes(role)) {
    return forbidden();
  }
  if (member.role === role) return ok(null);

  const { data, error: updateError } = await db
    .from("store_members")
    .update({ role })
    .eq("id", memberId)
    .eq("store_id", actor.storeId)
    .select("id");
  if (updateError) return fail(updateError);
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}

export async function removeMember(db: Db, actor: Actor, memberId: string): Promise<Result<null>> {
  const { data: member, error } = await getMember(db, actor, memberId);
  if (error) return fail(error);
  if (!member) return { ok: false, error: "Member not found.", code: "not_found" };
  if (!canManageRole(actor.role, member.role)) return forbidden();

  const { data, error: deleteError } = await db
    .from("store_members")
    .delete()
    .eq("id", memberId)
    .eq("store_id", actor.storeId)
    .select("id");
  if (deleteError) return fail(deleteError);
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}

export type InvitationPreview = {
  storeName: string;
  role: StoreRole;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
};

export async function previewInvitation(db: Db, token: string): Promise<Result<InvitationPreview | null>> {
  const { data, error } = await db.rpc("invitation_preview", { p_token: token });
  if (error) return fail(error);
  const row = data?.[0];
  if (!row) return ok(null);
  return ok({
    storeName: row.store_name,
    role: row.role,
    email: row.email,
    status: row.status as InvitationStatus,
    expiresAt: row.expires_at,
  });
}

/** Accepts as the signed-in user; returns the store id. */
export async function acceptInvitation(db: Db, token: string): Promise<Result<string>> {
  const { data, error } = await db.rpc("accept_invitation", { p_token: token });
  if (error || !data) return fail(error);
  return ok(data);
}
