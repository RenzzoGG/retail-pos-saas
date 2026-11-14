"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms/state";
import { isLeaving, withDocumentRedirect } from "@/lib/forms/document-redirect";
import { acceptInvitationAction } from "../actions";

/** Opens /app with a full page load after joining (see acceptInvitationAction). */
const acceptAndOpenStore = withDocumentRedirect(acceptInvitationAction);

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptAndOpenStore, initialFormState);
  const leaving = isLeaving(state);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton className="w-full" pendingText="Joining…" disabled={leaving}>
        {leaving ? "Joining…" : "Accept invitation"}
      </SubmitButton>
    </form>
  );
}
