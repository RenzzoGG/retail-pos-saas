"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms/state";
import { ROLE_LABELS, type StoreRole } from "@/lib/permissions";
import { inviteMemberAction } from "../actions";

export function InviteForm({ roles }: { roles: StoreRole[] }) {
  const [state, action] = useActionState(inviteMemberAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          required
          defaultValue={state.status === "error" ? state.values?.email : ""}
          key={state.status === "success" ? state.message : "invite-email"}
          errors={state.fieldErrors?.email}
        />
        <SelectField
          name="role"
          label="Role"
          defaultValue={state.values?.role ?? roles[roles.length - 1]}
          options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          errors={state.fieldErrors?.role}
        />
      </div>
      <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
    </form>
  );
}
