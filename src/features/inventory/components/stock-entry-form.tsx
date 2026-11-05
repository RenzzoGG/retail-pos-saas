"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/ui/alert";
import { Button, SubmitButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import { type EntryProduct, createStockEntryAction, lookupProductCode, searchProductsForEntry } from "../actions";

type Line = { product: EntryProduct; quantity: string; unitCost: string };

const CELL_INPUT =
  "w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Receive merchandise. The "Scan or search" field works with USB barcode
 * scanners, which type the code like a keyboard and press Enter: Enter looks up
 * the exact barcode/SKU and adds the product (or adds 1 if it's already listed).
 */
export function StockEntryForm({ currency, initialProduct }: { currency: string; initialProduct?: EntryProduct | null }) {
  const [state, formAction] = useActionState(createStockEntryAction, initialFormState);
  const [lines, setLines] = useState<Line[]>(() =>
    initialProduct ? [{ product: initialProduct, quantity: "1", unitCost: initialProduct.cost?.toFixed(2) ?? "" }] : [],
  );
  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<EntryProduct[]>([]);
  const [scanMessage, setScanMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [isLooking, startLookup] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  function addProduct(product: EntryProduct, fromSuggestion = false) {
    setLines((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (existing) {
        return current.map((l) =>
          l.product.id === product.id ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      return [...current, { product, quantity: "1", unitCost: product.cost?.toFixed(2) ?? "" }];
    });
    setScanMessage({ tone: "info", text: `Added ${product.name}.` });
    if (fromSuggestion) {
      setCode("");
      setSuggestions([]);
      scanRef.current?.focus();
    }
  }

  // Suggestions while typing by hand (debounced). Scanners are too fast to trigger it.
  useEffect(() => {
    const text = code.trim();
    if (text.length < 2) return; // nothing to fetch; visibleSuggestions below hides stale ones
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const found = await searchProductsForEntry(text);
      if (seq === searchSeq.current) setSuggestions(found);
    }, 300);
    return () => clearTimeout(timer);
  }, [code]);

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault(); // never submit the whole form from the scan field
    const scanned = code.trim();
    if (!scanned) return;
    // Clear right away (not when the lookup answers): a scanner may already be
    // typing the next code, and those characters must not be wiped.
    setCode("");
    setSuggestions([]);
    searchSeq.current++; // cancel pending suggestions
    startLookup(async () => {
      const product = await lookupProductCode(scanned);
      if (product) addProduct(product);
      else setScanMessage({ tone: "error", text: `No product with barcode or SKU “${scanned}”.` });
    });
  }

  const visibleSuggestions = code.trim().length >= 2 ? suggestions : [];

  const update = (id: string, field: "quantity" | "unitCost", value: string) =>
    setLines((current) => current.map((l) => (l.product.id === id ? { ...l, [field]: value } : l)));

  const totalCents = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.quantity) || 0) * Math.round((Number(l.unitCost) || 0) * 100)),
    0,
  );
  const payload = JSON.stringify(
    lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitCost: l.unitCost })),
  );

  return (
    <div className="space-y-6">
      <FormMessage status={state.status} message={state.message} />

      {/* Outside the <form>: Enter in the scan field can never submit the entry,
          not even before the page has finished loading its JavaScript. */}
      <div className="space-y-1">
        <label htmlFor="scan-input" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          Scan or search
        </label>
        <input
          ref={scanRef}
          id="scan-input"
          type="text"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onScanKeyDown}
          aria-describedby="scan-hint scan-status"
          placeholder="Scan a barcode or type a name or SKU"
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
        />
        <p id="scan-hint" className="text-xs text-slate-500">
          Press Enter to add the product with that exact barcode or SKU, or pick a suggestion.
        </p>
        <p
          id="scan-status"
          role={scanMessage?.tone === "error" ? "alert" : "status"}
          className={`min-h-5 text-sm ${scanMessage?.tone === "error" ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}
        >
          {isLooking ? "Looking up…" : (scanMessage?.text ?? "")}
        </p>
        {visibleSuggestions.length > 0 ? (
          <ul aria-label="Suggestions" className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {visibleSuggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => addProduct(s, true)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                >
                  <span>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="font-mono text-xs text-slate-500">{s.sku}</span>
                  </span>
                  <span className="text-xs text-slate-500">Stock {s.stock}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <form action={formAction} className="space-y-6" noValidate>
        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            No products yet. Scan or search to add them.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Products to receive</caption>
              <thead className="text-left text-slate-600 dark:text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Product</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Current stock</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Quantity</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Unit cost</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Line total</th>
                  <th scope="col" className="py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {lines.map((l) => (
                  <tr key={l.product.id} data-testid={`entry-line-${l.product.sku}`}>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{l.product.name}</span>
                      <span className="block font-mono text-xs text-slate-500">{l.product.sku}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.product.stock}</td>
                    <td className="py-2 pr-3 text-right">
                      <label htmlFor={`qty-${l.product.id}`} className="sr-only">Quantity of {l.product.name}</label>
                      <input
                        id={`qty-${l.product.id}`}
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => update(l.product.id, "quantity", e.target.value)}
                        className={CELL_INPUT}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <label htmlFor={`cost-${l.product.id}`} className="sr-only">Unit cost of {l.product.name}</label>
                      <input
                        id={`cost-${l.product.id}`}
                        inputMode="decimal"
                        value={l.unitCost}
                        placeholder="0.00"
                        onChange={(e) => update(l.product.id, "unitCost", e.target.value)}
                        className={CELL_INPUT}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatMoney(((Number(l.quantity) || 0) * Math.round((Number(l.unitCost) || 0) * 100)) / 100, currency)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove ${l.product.name}`}
                        onClick={() => setLines((current) => current.filter((x) => x.product.id !== l.product.id))}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4} className="py-2 pr-3 text-right font-medium">
                    Total cost
                  </th>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums" data-testid="entry-total">
                    {formatMoney(totalCents / 100, currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="supplier"
            label="Supplier (optional)"
            maxLength={120}
            defaultValue={state.values?.supplier}
            errors={state.fieldErrors?.supplier}
          />
          <TextField name="note" label="Note (optional)" maxLength={500} defaultValue={state.values?.note} errors={state.fieldErrors?.note} />
        </div>
        <input type="hidden" name="lines" value={payload} />
        <SubmitButton pendingText="Saving…" disabled={lines.length === 0}>
          Receive stock
        </SubmitButton>
      </form>
    </div>
  );
}
