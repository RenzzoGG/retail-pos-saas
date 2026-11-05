"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { type FormState, initialFormState } from "@/lib/forms/state";
import { listTimeZones } from "@/lib/timezone";
import { CURRENCIES } from "../schemas";

type Defaults = { name: string; currency: string; taxRatePercent: string; pricesIncludeTax: boolean; timezone: string };

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: Defaults;
  submitLabel: string;
  pendingText: string;
};

/** Used by onboarding (create) and Settings (update). */
export function StoreSettingsForm({ action, defaults, submitLabel, pendingText }: Props) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="name"
        label="Store name"
        required
        maxLength={80}
        autoComplete="organization"
        defaultValue={v?.name ?? defaults.name}
        errors={state.fieldErrors?.name}
      />
      <SelectField
        name="currency"
        label="Currency"
        defaultValue={v?.currency ?? defaults.currency}
        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        errors={state.fieldErrors?.currency}
      />
      <TextField
        name="taxRatePercent"
        label="Sales tax (%)"
        inputMode="decimal"
        required
        hint="For example 8.25. Use 0 if you don't charge sales tax."
        defaultValue={v?.taxRatePercent ?? defaults.taxRatePercent}
        errors={state.fieldErrors?.taxRatePercent}
      />
      <SelectField
        name="timezone"
        label="Time zone"
        hint="Used for dates, filters and daily reports."
        defaultValue={v?.timezone ?? defaults.timezone}
        options={listTimeZones().map((z) => ({ value: z, label: z.replaceAll("_", " ") }))}
        errors={state.fieldErrors?.timezone}
      />
      <CheckboxField
        name="pricesIncludeTax"
        label="Prices include tax"
        hint="Checked: the price on the shelf is what customers pay. Unchecked: tax is added at checkout."
        defaultChecked={v ? v.pricesIncludeTax === "on" : defaults.pricesIncludeTax}
      />
      <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
    </form>
  );
}
