"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { type FormState, initialFormState } from "@/lib/forms/state";

export type ProductDefaults = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  salePrice: string;
  lowStockThreshold: string;
  active: boolean;
};

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: ProductDefaults;
  submitLabel: string;
  categories: string[];
};

/** Stock and cost are not editable here: they change only through stock entries, sales and returns. */
export function ProductForm({ action, defaults, submitLabel, categories }: Props) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField name="name" label="Name" required maxLength={120} defaultValue={v?.name ?? defaults.name} errors={state.fieldErrors?.name} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="sku"
          label="SKU"
          required
          maxLength={64}
          autoCapitalize="characters"
          defaultValue={v?.sku ?? defaults.sku}
          errors={state.fieldErrors?.sku}
        />
        <TextField
          name="barcode"
          label="Barcode (optional)"
          maxLength={64}
          inputMode="numeric"
          hint="Scan it here or type it. Must be unique in your store."
          defaultValue={v?.barcode ?? defaults.barcode}
          errors={state.fieldErrors?.barcode}
          onKeyDown={(e) => {
            // USB scanners press Enter after the code: don't submit the form by accident.
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      </div>
      <TextField
        name="category"
        label="Category (optional)"
        maxLength={60}
        list="category-options"
        defaultValue={v?.category ?? defaults.category}
        errors={state.fieldErrors?.category}
      />
      <datalist id="category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="salePrice"
          label="Sale price"
          required
          inputMode="decimal"
          defaultValue={v?.salePrice ?? defaults.salePrice}
          errors={state.fieldErrors?.salePrice}
        />
        <TextField
          name="lowStockThreshold"
          label="Low-stock threshold"
          required
          inputMode="numeric"
          hint="You'll be alerted when stock is at or below this number."
          defaultValue={v?.lowStockThreshold ?? defaults.lowStockThreshold}
          errors={state.fieldErrors?.lowStockThreshold}
        />
      </div>
      <CheckboxField
        name="active"
        label="Active"
        hint="Inactive products can't be sold."
        defaultChecked={v ? v.active === "on" : defaults.active}
      />
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
