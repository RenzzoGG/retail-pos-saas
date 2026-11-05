"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { type FormState, initialFormState } from "@/lib/forms/state";

export type CustomerDefaults = { name: string; documentId: string; phone: string; email: string; notes: string };

export function CustomerForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: CustomerDefaults;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField name="name" label="Name" required maxLength={120} autoComplete="off" defaultValue={v?.name ?? defaults.name} errors={state.fieldErrors?.name} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="phone" label="Phone (optional)" type="tel" maxLength={40} defaultValue={v?.phone ?? defaults.phone} errors={state.fieldErrors?.phone} />
        <TextField name="email" label="Email (optional)" type="email" maxLength={254} defaultValue={v?.email ?? defaults.email} errors={state.fieldErrors?.email} />
      </div>
      <TextField
        name="documentId"
        label="Document / tax ID (optional)"
        maxLength={40}
        defaultValue={v?.documentId ?? defaults.documentId}
        errors={state.fieldErrors?.documentId}
      />
      <TextField name="notes" label="Notes (optional)" maxLength={500} defaultValue={v?.notes ?? defaults.notes} errors={state.fieldErrors?.notes} />
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
