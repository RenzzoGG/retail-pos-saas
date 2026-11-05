"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms/state";
import { acceptInvitationAction } from "../actions";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitationAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton className="w-full" pendingText="Joining…">
        Accept invitation
      </SubmitButton>
    </form>
  );
}
