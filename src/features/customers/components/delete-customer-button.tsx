"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { type FormState, initialFormState } from "@/lib/forms/state";

export function DeleteCustomerButton({ action, name, hasSales }: { action: () => Promise<FormState>; name: string; hasSales: boolean }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(e) => {
        const text = hasSales
          ? `Archive "${name}"? They have purchases, so their history is kept and they won't appear in searches.`
          : `Delete "${name}"? This can't be undone.`;
        if (!confirm(text)) e.preventDefault();
      }}
    >
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton variant="danger" pendingText="Removing…">
        {hasSales ? "Archive customer" : "Delete customer"}
      </SubmitButton>
    </form>
  );
}
