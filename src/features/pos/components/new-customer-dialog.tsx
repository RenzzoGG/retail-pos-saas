"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { quickCreateCustomer } from "@/features/customers/actions";
import type { CustomerOption } from "../service";

const INPUT =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 aria-[invalid=true]:border-red-500 dark:border-slate-600 dark:bg-slate-900";

/** Quick customer creation from the register (native <dialog>: focus trap + Esc). */
export function NewCustomerDialog({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string;
  onCreated: (c: CustomerOption) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string[]>>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await quickCreateCustomer({ name, phone, email });
      if (result.ok) onCreated(result.customer);
      else {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, type = "text", key = id) => (
    <div>
      <label htmlFor={`new-customer-${id}`} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
      </label>
      <input
        id={`new-customer-${id}`}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={fieldErrors[key] ? true : undefined}
        aria-describedby={fieldErrors[key] ? `new-customer-${id}-error` : undefined}
        className={INPUT}
      />
      {fieldErrors[key] ? (
        <p id={`new-customer-${id}-error`} className="mt-1 text-sm text-red-600">
          {fieldErrors[key]?.join(" ")}
        </p>
      ) : null}
    </div>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby="new-customer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={submit} className="space-y-4 p-6" noValidate>
        <h2 id="new-customer-title" className="text-lg font-semibold">
          New customer
        </h2>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {field("name", "Name", name, setName)}
        {field("phone", "Phone (optional)", phone, setPhone, "tel")}
        {field("email", "Email (optional)", email, setEmail, "email")}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || name.trim() === ""}>
            {pending ? "Saving…" : "Add to sale"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
