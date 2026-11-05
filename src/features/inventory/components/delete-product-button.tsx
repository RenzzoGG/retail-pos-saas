"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { type FormState, initialFormState } from "@/lib/forms/state";

export function DeleteProductButton({
  action,
  productName,
}: {
  action: () => Promise<FormState>;
  productName: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(e) => {
        if (!confirm(`Delete "${productName}"? It will disappear from the catalog; past sales and stock history are kept.`)) {
          e.preventDefault();
        }
      }}
    >
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton variant="danger" pendingText="Deleting…">
        Delete product
      </SubmitButton>
    </form>
  );
}
