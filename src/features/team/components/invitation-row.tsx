"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms/state";
import { ROLE_LABELS } from "@/lib/permissions";
import { resendInvitationAction, revokeInvitationAction } from "../actions";
import type { Invitation } from "../service";

/**
 * One pending or expired invitation. canManage (owner, or admin for cashier
 * invitations) shows Resend and Revoke; the server and RLS check it again.
 */
export function InvitationRow({ invitation, canManage }: { invitation: Invitation; canManage: boolean }) {
  const [revokeState, revoke] = useActionState(revokeInvitationAction, initialFormState);
  const [resendState, resend] = useActionState(resendInvitationAction, initialFormState);
  const expires = new Date(invitation.expiresAt).toLocaleDateString("en-US", { dateStyle: "medium" });
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{invitation.email}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {ROLE_LABELS[invitation.role]} ·{" "}
          {invitation.status === "expired" ? (
            <span className="text-amber-700 dark:text-amber-400">Expired</span>
          ) : (
            <>Pending · expires {expires}</>
          )}
        </p>
        {[resendState, revokeState].map((state, i) =>
          state.status === "error" ? (
            <p key={i} role="alert" className="text-sm text-red-600">
              {state.message}
            </p>
          ) : null,
        )}
        {resendState.status === "success" ? (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {resendState.message}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex gap-2">
          <form action={resend}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <SubmitButton
              variant="secondary"
              pendingText="Resending…"
              aria-label={`Resend invitation to ${invitation.email}`}
            >
              Resend
            </SubmitButton>
          </form>
          <form action={revoke}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <SubmitButton variant="secondary" pendingText="Revoking…" aria-label={`Revoke invitation for ${invitation.email}`}>
              Revoke
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </li>
  );
}
