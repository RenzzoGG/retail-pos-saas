"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACTIVE_STORE_COOKIE,
  activeStoreCookieOptions,
  requireRole,
  requireUser,
} from "@/lib/auth/dal";
import { sendEmail } from "@/lib/email/mailer";
import { buildInvitationEmail } from "@/lib/email/templates";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { changeRoleSchema, invitationIdSchema, inviteSchema, memberIdSchema } from "./schemas";
import {
  type Actor,
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  removeMember,
  revokeInvitation,
} from "./service";

async function managerActor(): Promise<{ actor: Actor; storeName: string }> {
  const { user, store } = await requireRole(["owner", "admin"]);
  return { actor: { userId: user.id, storeId: store.storeId, role: store.role }, storeName: store.storeName };
}

export async function inviteMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor, storeName } = await managerActor();
  const values = formValues(formData, ["email", "role"]);
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };

  const db = await createClient();
  const result = await createInvitation(db, actor, parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };

  const { data: me } = await db.from("profiles").select("full_name, email").eq("id", actor.userId).maybeSingle();
  const email = buildInvitationEmail({
    storeName,
    inviterName: me?.full_name || me?.email || "A teammate",
    role: parsed.data.role,
    acceptUrl: `${getSiteUrl()}/invite/${result.data.token}`,
    expiresAt: result.data.expiresAt,
  });

  revalidatePath("/app/team");
  try {
    await sendEmail(parsed.data.email, email);
  } catch {
    return {
      status: "error",
      message: "The invitation was created, but the email could not be sent. Try resending it.",
    };
  }
  return { status: "success", message: `Invitation sent to ${parsed.data.email}.` };
}

export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor } = await managerActor();
  const parsed = changeRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a valid role." };

  const result = await changeMemberRole(await createClient(), actor, parsed.data.memberId, parsed.data.role);
  revalidatePath("/app", "layout");
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "success", message: "Role updated." };
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor } = await managerActor();
  const parsed = memberIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Invalid member." };

  const result = await removeMember(await createClient(), actor, parsed.data.memberId);
  revalidatePath("/app", "layout");
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "success", message: "Member removed." };
}

export async function revokeInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor } = await managerActor();
  const parsed = invitationIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Invalid invitation." };

  const result = await revokeInvitation(await createClient(), actor, parsed.data.invitationId);
  revalidatePath("/app/team");
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "success", message: "Invitation revoked." };
}

export async function acceptInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const token = String(formData.get("token") ?? "");
  const result = await acceptInvitation(await createClient(), token);
  if (!result.ok) return { status: "error", message: result.error };

  (await cookies()).set(ACTIVE_STORE_COOKIE, result.data, activeStoreCookieOptions());
  revalidatePath("/app", "layout");
  redirect("/app");
}
