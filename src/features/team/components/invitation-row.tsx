"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms/state";
import { ROLE_LABELS } from "@/lib/permissions";
import { revokeInvitationAction } from "../actions";
import type { Invitation } from "../service";

export function InvitationRow({ invitation, canRevoke }: { invitation: Invitation; canRevoke: boolean }) {
  const [state, action] = useActionState(revokeInvitationAction, initialFormState);
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
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            {state.message}
          </p>
        ) : null}
      </div>
      {canRevoke ? (
        <form action={action}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <SubmitButton variant="secondary" pendingText="Revoking…" aria-label={`Revoke invitation for ${invitation.email}`}>
            Revoke
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}
