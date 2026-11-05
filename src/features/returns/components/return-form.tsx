"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { createReturnAction } from "../actions";
import { previewRefund } from "../calc";

type Item = { saleItemId: string; name: string; sku: string; quantity: number; returnedQty: number; lineTotal: number };

type Props = {
  saleId: string;
  currency: string;
  total: number;
  subtotal: number;
  refunded: number;
  items: Item[];
  defaultMethod: "cash" | "card" | "transfer";
};

const cents = (n: number) => Math.round(n * 100);

/** Owner/admin: choose items, quantities, restock, reason and refund method. */
export function ReturnForm({ saleId, currency, total, subtotal, refunded, items, defaultMethod }: Props) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(defaultMethod);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; returnId?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (c: number) => formatMoney(c / 100, currency);

  const request = items.map((i) => ({ saleItemId: i.saleItemId, quantity: Math.max(0, Math.floor(Number(quantities[i.saleItemId] || 0))) }));
  // Cheap to compute: no memoization needed.
  const preview = previewRefund(
    { totalCents: cents(total), subtotalCents: cents(subtotal), refundedCents: cents(refunded) },
    items.map((i) => ({ saleItemId: i.saleItemId, soldQty: i.quantity, returnedQty: i.returnedQty, lineTotalCents: cents(i.lineTotal) })),
    request,
  );
  const selected = request.some((r) => r.quantity > 0);
  const canSubmit = selected && preview.errors.length === 0 && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setMessage(null);
    startTransition(async () => {
      const result = await createReturnAction({
        saleId,
        reason,
        refundMethod: method,
        items: request.map((r) => ({ ...r, restock: restock[r.saleItemId] ?? true })),
      });
      if (result.ok) {
        setQuantities({});
        setRestock({});
        setReason("");
        setMessage({ tone: "success", text: "Return registered.", returnId: result.returnId });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Return items" noValidate>
      {message ? (
        <Alert tone={message.tone}>
          {message.text}{" "}
          {message.returnId ? (
            <a href={`/app/sales/${saleId}/returns/${message.returnId}/receipt?download=1`} className="font-medium underline">
              Download return receipt
            </a>
          ) : null}
        </Alert>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Items that can be returned</caption>
          <thead className="text-left text-slate-600 dark:text-slate-400">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Item</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Can return</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Return</th>
              <th scope="col" className="py-2 font-medium">Back to stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map((i) => {
              const left = i.quantity - i.returnedQty;
              return (
                <tr key={i.saleItemId} data-testid={`return-line-${i.sku}`}>
                  <td className="py-2 pr-3">
                    {i.name}
                    <span className="block font-mono text-xs text-slate-500">{i.sku}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{left}</td>
                  <td className="py-2 pr-3 text-right">
                    <label htmlFor={`ret-qty-${i.saleItemId}`} className="sr-only">Units of {i.name} to return</label>
                    <input
                      id={`ret-qty-${i.saleItemId}`}
                      type="number"
                      min={0}
                      max={left}
                      step={1}
                      inputMode="numeric"
                      disabled={left === 0}
                      value={quantities[i.saleItemId] ?? ""}
                      placeholder="0"
                      onChange={(e) => setQuantities((q) => ({ ...q, [i.saleItemId]: e.target.value }))}
                      className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right tabular-nums focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                    />
                  </td>
                  <td className="py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={restock[i.saleItemId] ?? true}
                        disabled={left === 0}
                        onChange={(e) => setRestock((r) => ({ ...r, [i.saleItemId]: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
                      />
                      <span className="text-sm">
                        Return to stock <span className="sr-only">for {i.name}</span>
                      </span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Uncheck “Return to stock” for damaged items: they are refunded but don&apos;t go back to inventory.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="return-reason" className="block text-sm font-medium text-slate-800 dark:text-slate-200">Reason (optional)</label>
          <input
            id="return-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
        <div>
          <label htmlFor="return-method" className="block text-sm font-medium text-slate-800 dark:text-slate-200">Refund method</label>
          <select
            id="return-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as Props["defaultMethod"])}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
      </div>

      {preview.errors.length > 0 ? (
        <ul role="alert" className="text-sm text-red-700 dark:text-red-400">
          {preview.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800">
        <p className="text-sm" aria-live="polite">
          Refund: <strong className="tabular-nums" data-testid="refund-preview">{money(preview.totalCents)}</strong>
          <span className="block text-xs text-slate-500">Includes the share of the sale&apos;s discounts and tax.</span>
        </p>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? "Registering…" : "Register return"}
        </Button>
      </div>
    </form>
  );
}
