"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { type PaymentLine, type PaymentMethod, paymentSummary } from "../calc";

/** Payment rows as typed (strings), converted when checking or sending. */
export type PaymentDraft = { method: PaymentMethod; amount: string; tendered: string };

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "transfer", label: "Transfer" },
];

const INPUT =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-right tabular-nums focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";

function toNumber(text: string): number {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() === "" ? Number.NaN : n;
}

function toLines(drafts: PaymentDraft[]): PaymentLine[] {
  return drafts.map((d) => ({
    method: d.method,
    amount: toNumber(d.amount),
    tendered: d.method === "cash" && d.tendered.trim() !== "" ? toNumber(d.tendered) : null,
  }));
}

type Props = {
  totalCents: number;
  currency: string;
  payments: PaymentDraft[];
  onPaymentsChange: (p: PaymentDraft[]) => void;
  onClose: () => void;
  onConfirm: (lines: PaymentLine[]) => void;
  submitting: boolean;
  error: string | null;
};

/**
 * Payment step. A native <dialog> opened with showModal() traps focus and
 * closes with Esc. Payments must add up to exactly the total; for cash,
 * "Cash received" gives the change.
 */
export function CheckoutDialog({ totalCents, currency, payments, onPaymentsChange, onClose, onConfirm, submitting, error }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const lines = toLines(payments);
  const summary = paymentSummary(totalCents, lines);
  const canConfirm = summary.ready && !submitting;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const update = (index: number, patch: Partial<PaymentDraft>) =>
    onPaymentsChange(payments.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  function confirm() {
    if (canConfirm) onConfirm(lines);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="checkout-title"
      onCancel={(e) => {
        e.preventDefault(); // Esc: let the parent decide (it ignores Esc while sending)
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "F9") {
          e.preventDefault();
          confirm();
        }
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <form
        method="dialog"
        className="space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <div className="flex items-baseline justify-between">
          <h2 id="checkout-title" className="text-xl font-semibold">
            Payment
          </h2>
          <p className="text-2xl font-bold tabular-nums" data-testid="checkout-total">
            {money(totalCents)}
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="sr-only">Payment methods</legend>
          {payments.map((p, index) => (
            <div key={index} className="grid grid-cols-[7rem_1fr_auto] items-end gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-700" data-testid={`payment-${index}`}>
              <div>
                <label htmlFor={`pay-method-${index}`} className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Method
                </label>
                <select
                  id={`pay-method-${index}`}
                  value={p.method}
                  onChange={(e) => update(index, { method: e.target.value as PaymentMethod, tendered: "" })}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`pay-amount-${index}`} className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Amount
                </label>
                <input
                  id={`pay-amount-${index}`}
                  inputMode="decimal"
                  autoFocus={index === 0}
                  value={p.amount}
                  onChange={(e) => update(index, { amount: e.target.value })}
                  className={`mt-1 ${INPUT}`}
                />
              </div>
              <div className="pb-1">
                {payments.length > 1 ? (
                  <Button type="button" variant="ghost" aria-label={`Remove payment ${index + 1}`} onClick={() => onPaymentsChange(payments.filter((_, i) => i !== index))}>
                    ✕
                  </Button>
                ) : null}
              </div>
              {p.method === "cash" ? (
                <div className="col-span-3 grid grid-cols-[1fr_auto] items-end gap-2">
                  <div>
                    <label htmlFor={`pay-tendered-${index}`} className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Cash received (for change)
                    </label>
                    <input
                      id={`pay-tendered-${index}`}
                      inputMode="decimal"
                      value={p.tendered}
                      placeholder={p.amount}
                      onChange={(e) => update(index, { tendered: e.target.value })}
                      className={`mt-1 ${INPUT}`}
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={() => update(index, { tendered: p.amount })}>
                    Exact
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </fieldset>

        {payments.length < 6 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              onPaymentsChange([
                ...payments,
                { method: "card", amount: summary.remainingCents > 0 ? (summary.remainingCents / 100).toFixed(2) : "", tendered: "" },
              ])
            }
          >
            Add payment method
          </Button>
        ) : null}

        <dl className="space-y-1 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800" aria-live="polite">
          <div className="flex justify-between">
            <dt>Paid</dt>
            <dd className="tabular-nums">{money(summary.paidCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{summary.remainingCents >= 0 ? "Remaining" : "Over the total"}</dt>
            <dd className="tabular-nums" data-testid="checkout-remaining">
              {money(Math.abs(summary.remainingCents))}
            </dd>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <dt>Change</dt>
            <dd className="tabular-nums" data-testid="checkout-change">
              {money(summary.changeCents)}
            </dd>
          </div>
        </dl>

        {summary.problems.length > 0 ? (
          <ul className="text-sm text-amber-800 dark:text-amber-300" aria-live="polite">
            {summary.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Back to cart <kbd className="ml-1 rounded border px-1 text-xs">Esc</kbd>
          </Button>
          <Button type="submit" disabled={!canConfirm} aria-disabled={!canConfirm} className="px-6">
            {submitting ? "Registering…" : "Complete sale"} <kbd className="ml-1 rounded border border-white/40 px-1 text-xs">F9</kbd>
          </Button>
        </div>
      </form>
    </dialog>
  );
}

