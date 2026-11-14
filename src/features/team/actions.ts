"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  ACTIVE_STORE_COOKIE,
  activeStoreCookieOptions,
  requireRole,
  requireUser,
} from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/db-errors";
import { EmailDeliveryError } from "@/lib/email/delivery";
import { sendEmail } from "@/lib/email/mailer";
import { buildInvitationEmail } from "@/lib/email/templates";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_NOT_SENT_MESSAGE } from "./messages";
import { type InviteInput, changeRoleSchema, invitationIdSchema, inviteSchema, memberIdSchema } from "./schemas";
import {
  type Actor,
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  getPendingInvitation,
  removeMember,
  revokeInvitation,
} from "./service";

async function managerActor(): Promise<{ actor: Actor; storeName: string; isDemo: boolean }> {
  const { user, store } = await requireRole(["owner", "admin"]);
  return {
    actor: { userId: user.id, storeId: store.storeId, role: store.role },
    storeName: store.storeName,
    isDemo: store.isDemo,
  };
}

/**
 * Creates (or replaces) the invitation, then emails the link.
 *
 * The invitation is saved BEFORE the email is sent and stays when sending
 * fails: it shows in "Pending invitations" with a Resend button, and the
 * user gets EMAIL_NOT_SENT_MESSAGE instead of a spinner (sendEmail gives up
 * after EMAIL_SEND_TIMEOUT_MS). The link only exists in the email (the
 * database keeps its hash), so resending issues a new link and the old one
 * stops working.
 */
async function inviteAndEmail(
  actor: Actor,
  storeName: string,
  input: InviteInput,
): Promise<{ ok: true } | { ok: false; state: FormState }> {
  const db = await createClient();
  const result = await createInvitation(db, actor, input);
  if (!result.ok) return { ok: false, state: { status: "error", message: result.error } };
  revalidatePath("/app/team");

  const { data: me } = await db.from("profiles").select("full_name, email").eq("id", actor.userId).maybeSingle();
  const email = buildInvitationEmail({
    storeName,
    inviterName: me?.full_name || me?.email || "A teammate",
    role: input.role,
    acceptUrl: `${getSiteUrl()}/invite/${result.data.token}`,
    expiresAt: result.data.expiresAt,
  });
  try {
    await sendEmail(input.email, email);
  } catch (error) {
    // EmailDeliveryError messages carry no credentials; anything else is reduced to its name.
    console.error(
      "Invitation email not sent:",
      error instanceof EmailDeliveryError ? error.message : (error as Error)?.name ?? "unknown error",
    );
    return { ok: false, state: { status: "error", message: EMAIL_NOT_SENT_MESSAGE } };
  }
  return { ok: true };
}

const DEMO_LOCKED: FormState = { status: "error", message: dbErrorMessage({ message: "demo_locked" }) };

export async function inviteMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor, storeName, isDemo } = await managerActor();
  const values = formValues(formData, ["email", "role"]);
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  // The database refuses it too (invitations_demo_guard); checking here first
  // avoids replacing an existing invitation before that insert fails.
  if (isDemo) return { ...DEMO_LOCKED, values };

  const sent = await inviteAndEmail(actor, storeName, parsed.data);
  if (!sent.ok) {
    // Email failure: the invitation exists, so the form starts empty again.
    return sent.state.message === EMAIL_NOT_SENT_MESSAGE ? sent.state : { ...sent.state, values };
  }
  return { status: "success", message: `Invitation sent to ${parsed.data.email}.` };
}

/**
 * Sends a pending (or expired) invitation again, with a new link valid for
 * another 7 days. Same rules as inviting: owner/admin, only roles they can
 * manage (RLS on invitations), never in the demo.
 */
export async function resendInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { actor, storeName, isDemo } = await managerActor();
  const parsed = invitationIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Invalid invitation." };
  if (isDemo) return DEMO_LOCKED;

  const invitation = await getPendingInvitation(await createClient(), actor, parsed.data.invitationId);
  if (!invitation.ok) return { status: "error", message: invitation.error };

  const sent = await inviteAndEmail(actor, storeName, { email: invitation.data.email, role: invitation.data.role });
  if (!sent.ok) return sent.state;
  return { status: "success", message: `Invitation sent again to ${invitation.data.email}.` };
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
  // Full page load, like createStoreAction: an invitee who was sent from /app
  // to /onboarding earlier would otherwise replay that cached redirect.
  return { status: "success", redirectTo: "/app" };
}
