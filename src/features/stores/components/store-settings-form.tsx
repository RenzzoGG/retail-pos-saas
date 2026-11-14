"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { type FormState, initialFormState } from "@/lib/forms/state";
import { isLeaving, withDocumentRedirect } from "@/lib/forms/document-redirect";
import { listTimeZones, preferredTimeZone } from "@/lib/timezone";
import { CURRENCIES } from "../schemas";

type Defaults = {
  name: string;
  currency: string;
  taxRatePercent: string;
  pricesIncludeTax: boolean;
  timezone: string;
  /** Only in Settings (not shown during onboarding). */
  cashierDiscountLimit?: string;
  /** Only in Settings. */
  ticketFooter?: string;
};

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: Defaults;
  submitLabel: string;
  pendingText: string;
  /** Onboarding: one key per page view, so a double submit creates one store. */
  idempotencyKey?: string;
  /** Onboarding: preselect the browser's time zone (when offered), else UTC. */
  detectTimeZone?: boolean;
};

/** Used by onboarding (create) and Settings (update). */
export function StoreSettingsForm({ action, defaults, submitLabel, pendingText, idempotencyKey, detectTimeZone }: Props) {
  // After creating a store: full page load to /app (see createStoreAction).
  const actionWithRedirect = useMemo(() => withDocumentRedirect(action), [action]);
  const [state, formAction] = useActionState(actionWithRedirect, initialFormState);
  const v = state.values;
  const formRef = useRef<HTMLFormElement>(null);
  const leaving = isLeaving(state);
  // Blocks a second submit before React re-renders the button as disabled
  // (fast double click). Released when the action answers, unless leaving.
  const submitting = useRef(false);
  useEffect(() => {
    if (!leaving) submitting.current = false;
  }, [state, leaving]);

  // The browser's zone is only known on the client: the server renders the
  // default (UTC) and the select is updated after hydration, unless the form
  // is showing values echoed back after an error.
  const echoedTimeZone = v?.timezone;
  useEffect(() => {
    if (!detectTimeZone || echoedTimeZone) return;
    const select = formRef.current?.elements.namedItem("timezone");
    if (select instanceof HTMLSelectElement) {
      select.value = preferredTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [detectTimeZone, echoedTimeZone]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        if (submitting.current) event.preventDefault();
        else submitting.current = true;
      }}
      className="space-y-5"
      noValidate
    >
      {idempotencyKey ? <input type="hidden" name="idempotencyKey" value={idempotencyKey} /> : null}
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
      {defaults.cashierDiscountLimit !== undefined ? (
        <TextField
          name="cashierDiscountLimit"
          label="Cashier discount limit (%)"
          inputMode="decimal"
          hint="Most a cashier can discount on a sale, as a % of its amount. Owners and admins have no limit."
          defaultValue={v?.cashierDiscountLimit ?? defaults.cashierDiscountLimit}
          errors={state.fieldErrors?.cashierDiscountLimit}
        />
      ) : null}
      <CheckboxField
        name="pricesIncludeTax"
        label="Prices include tax"
        hint="Checked: the price on the shelf is what customers pay. Unchecked: tax is added at checkout."
        defaultChecked={v ? v.pricesIncludeTax === "on" : defaults.pricesIncludeTax}
      />
      {defaults.ticketFooter !== undefined ? (
        <TextAreaField
          name="ticketFooter"
          label="Receipt note (optional)"
          rows={3}
          maxLength={200}
          hint="Printed at the bottom of every receipt, for example a thank-you message or your website."
          defaultValue={v?.ticketFooter ?? defaults.ticketFooter}
          errors={state.fieldErrors?.ticketFooter}
        />
      ) : null}
      <SubmitButton pendingText={pendingText} disabled={leaving}>
        {leaving ? pendingText : submitLabel}
      </SubmitButton>
    </form>
  );
}
