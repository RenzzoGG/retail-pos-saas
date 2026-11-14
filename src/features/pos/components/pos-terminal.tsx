"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-styles";
import { formatMoney } from "@/lib/money";
import { type CheckoutResult, checkoutAction, lookupSaleProduct, searchSaleCustomers, searchSaleProducts } from "../actions";
import { type CartItem, type Discount, cartTotals, exceedsDiscountLimit } from "../calc";
import { METHOD_LABELS } from "../labels";
import type { CustomerOption, SaleDetail, SaleProduct } from "../service";
import { CheckoutDialog, type PaymentDraft } from "./checkout-dialog";
import { NewCustomerDialog } from "./new-customer-dialog";
import { PlusIcon, XMarkIcon } from "@/components/ui/icons";

export type PosSettings = {
  storeId: string;
  currency: string;
  taxRate: number;
  pricesIncludeTax: boolean;
  /** null for owner/admin (no limit). */
  discountLimitPct: number | null;
};

type SavedState = {
  items: CartItem[];
  saleDiscount: Discount | null;
  customer: CustomerOption | null;
  idempotencyKey: string | null;
  payments: PaymentDraft[] | null;
};

const EMPTY: SavedState = { items: [], saleDiscount: null, customer: null, idempotencyKey: null, payments: null };
const storageKey = (storeId: string) => `stocktill:pos:${storeId}`;

function readSaved(storeId: string): SavedState {
  try {
    const raw = sessionStorage.getItem(storageKey(storeId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as SavedState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

const subscribe = () => () => {};

/**
 * The cart lives in sessionStorage (it survives a reload, together with the
 * checkout's idempotency key), which doesn't exist on the server. To avoid a
 * hydration mismatch the terminal mounts only in the browser.
 */
export function PosTerminal(props: PosSettings) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <p className="text-sm text-slate-500">Loading the register…</p>;
  return <Terminal {...props} initial={readSaved(props.storeId)} />;
}

function Terminal({ initial, ...settings }: PosSettings & { initial: SavedState }) {
  const { currency, taxRate, pricesIncludeTax, discountLimitPct, storeId } = settings;
  const money = useCallback((cents: number) => formatMoney(cents / 100, currency), [currency]);

  const [items, setItems] = useState<CartItem[]>(initial.items);
  const [saleDiscount, setSaleDiscount] = useState<Discount | null>(initial.saleDiscount);
  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(initial.idempotencyKey);
  const [payments, setPayments] = useState<PaymentDraft[] | null>(initial.payments);
  const [checkoutOpen, setCheckoutOpen] = useState(initial.payments !== null);
  const [done, setDone] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorProductId, setErrorProductId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<SaleProduct[]>([]);
  const [scanMessage, setScanMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [isLooking, startLookup] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();
  const submitting = useRef(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Phones: the page gets a bottom padding equal to the fixed total/Charge bar
  // (its real height, safe area included), so the end of the page is never
  // under it. Measured because the bar's height depends on fonts and insets.
  useEffect(() => {
    const bar = barRef.current;
    const layout = layoutRef.current;
    if (!bar || !layout) return;
    const update = () => layout.style.setProperty("--pos-bar-h", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
    // Re-measure when the terminal comes back after the "sale completed" screen.
  }, [done]);
  const searchSeq = useRef(0);
  const customerSeq = useRef(0);

  // Persist the sale in progress (survives reloads; cleared when the sale completes).
  useEffect(() => {
    try {
      const state: SavedState = { items, saleDiscount, customer, idempotencyKey, payments: checkoutOpen ? payments : null };
      if (items.length === 0 && !customer && !saleDiscount) sessionStorage.removeItem(storageKey(storeId));
      else sessionStorage.setItem(storageKey(storeId), JSON.stringify(state));
    } catch {
      // Private mode / storage full: the sale still works, it just won't survive a reload.
    }
  }, [items, saleDiscount, customer, idempotencyKey, payments, checkoutOpen, storeId]);

  const totals = useMemo(() => cartTotals(items, saleDiscount, taxRate, pricesIncludeTax), [items, saleDiscount, taxRate, pricesIncludeTax]);
  const invalidLineDiscount = totals.lines.some((l) => l.invalidDiscount);
  const invalidDiscount = totals.invalidSaleDiscount || invalidLineDiscount;
  // An invalid discount isn't applied, so the limit only speaks about valid ones.
  const overLimit = !invalidDiscount && discountLimitPct !== null && exceedsDiscountLimit(totals, discountLimitPct);
  const canCharge = items.length > 0 && !overLimit && !invalidDiscount;

  /** Any change to the cart invalidates the checkout key: it's a different sale now. */
  const changeCart = useCallback((update: () => void) => {
    update();
    setIdempotencyKey(null);
    setError(null);
    setErrorProductId(null);
  }, []);

  function addProduct(product: SaleProduct, fromSuggestion = false) {
    changeCart(() =>
      setItems((current) => {
        const existing = current.find((i) => i.productId === product.id);
        if (existing) {
          return current.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1, stock: product.stock } : i));
        }
        return [
          ...current,
          { productId: product.id, name: product.name, sku: product.sku, unitPrice: product.price, stock: product.stock, quantity: 1, discount: null },
        ];
      }),
    );
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
    if (text.length < 2) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const found = await searchSaleProducts(text);
      if (seq === searchSeq.current) setSuggestions(found);
    }, 300);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    const text = customerQuery.trim();
    if (text.length < 2) return;
    const seq = ++customerSeq.current;
    const timer = setTimeout(async () => {
      const found = await searchSaleCustomers(text);
      if (seq === customerSeq.current) setCustomerOptions(found);
    }, 300);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  /**
   * Exact barcode/SKU first (what a scanner sends). Typed text that isn't an
   * exact code falls back to a name search: one match is added, several are
   * listed to pick from. Long digit strings are treated as barcodes only, so
   * an unknown scanned code never adds a product that merely contains it.
   */
  function scanCode(scanned: string, { byName = false } = {}) {
    searchSeq.current++;
    startLookup(async () => {
      const product = await lookupSaleProduct(scanned);
      if (product) return addProduct(product);
      const matches = byName && !looksLikeBarcode(scanned) ? await searchSaleProducts(scanned) : [];
      const [only] = matches;
      if (matches.length === 1 && only) return addProduct(only);
      if (matches.length > 1) {
        // Show the list again (only if nothing new was typed meanwhile).
        setCode((current) => (current === "" ? scanned : current));
        setSuggestions(matches);
        setScanMessage({ tone: "info", text: `${matches.length} products match “${scanned}”. Pick one.` });
        return;
      }
      setScanMessage({ tone: "error", text: `No product with barcode or SKU “${scanned}”.` });
    });
  }

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const scanned = code.trim();
    if (!scanned) return;
    // Clear now: the scanner may already be typing the next code.
    setCode("");
    setSuggestions([]);
    scanCode(scanned, { byName: true });
  }

  const backToScan = () => scanRef.current?.focus();

  const openCheckout = useCallback(() => {
    if (!canCharge || done) return;
    // The key is created when checkout starts and kept until the cart changes:
    // double clicks, reloads and retries all reuse it, so one sale at most.
    setIdempotencyKey((key) => key ?? crypto.randomUUID());
    // A 100 % discount leaves nothing to pay: no payment line (create_sale accepts none for a 0 total).
    setPayments((current) => current ?? (totals.totalCents > 0 ? [{ method: "cash", amount: (totals.totalCents / 100).toFixed(2), tendered: "" }] : []));
    setCheckoutOpen(true);
  }, [canCharge, done, totals.totalCents]);

  const closeCheckout = useCallback(() => {
    if (submitting.current) return;
    setCheckoutOpen(false);
    setPayments(null);
    scanRef.current?.focus();
  }, []);

  const newSale = useCallback(() => {
    setItems([]);
    setSaleDiscount(null);
    setCustomer(null);
    setIdempotencyKey(null);
    setPayments(null);
    setCheckoutOpen(false);
    setDone(null);
    setError(null);
    setErrorProductId(null);
    setScanMessage(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  }, []);

  const clearSale = useCallback(() => {
    if (items.length === 0 && !customer) return;
    if (confirm("Clear this sale? The cart will be emptied.")) newSale();
  }, [items.length, customer, newSale]);

  function submit(paymentLines: { method: "cash" | "card" | "transfer"; amount: number; tendered: number | null }[]) {
    if (submitting.current || !idempotencyKey) return; // guards double clicks before React re-renders
    submitting.current = true;
    setError(null);
    startSubmit(async () => {
      let result: CheckoutResult;
      try {
        result = await checkoutAction({
          idempotencyKey,
          customerId: customer?.id ?? null,
          items: items.map((i, index) => ({
            productId: i.productId,
            name: i.name,
            quantity: i.quantity,
            discount: (totals.lines[index]?.discountCents ?? 0) / 100,
          })),
          saleDiscount: totals.saleDiscountCents / 100,
          payments: paymentLines,
        });
      } catch {
        result = { ok: false, error: { code: "network", message: "Connection problem. Try again: the sale won't be registered twice." } };
      }
      submitting.current = false;
      if (result.ok) {
        try {
          sessionStorage.removeItem(storageKey(storeId));
        } catch {
          // ignore
        }
        setDone(result.sale);
        setCheckoutOpen(false);
        setPayments(null);
      } else {
        setError(result.error.message);
        setErrorProductId(result.error.productId ?? null);
        // Stock/price problems: back to the cart to fix it (the key stays until the cart changes).
        if (["insufficient_stock", "product_not_found", "discount_limit_exceeded", "payments_mismatch"].includes(result.error.code)) {
          setCheckoutOpen(false);
          setPayments(null);
        }
      }
    });
  }

  // Keyboard shortcuts (F1, F5, F11, F12 are left to the browser).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (creatingCustomer) return; // the customer dialog handles its own keys
      if (done) {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          newSale();
        }
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        if (!checkoutOpen) scanRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        if (!checkoutOpen) customerRef.current?.focus();
      } else if (e.key === "F8") {
        e.preventDefault();
        openCheckout();
      } else if (e.key === "Backspace" && e.altKey && e.shiftKey) {
        e.preventDefault();
        if (!checkoutOpen) clearSale();
      } else if (!checkoutOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Typing (or a scanner) with no text field focused, e.g. right after
        // clicking a button: send it to the scan field instead of losing it.
        const el = document.activeElement;
        const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        if (!editable) scanRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, checkoutOpen, creatingCustomer, openCheckout, newSale, clearSale]);

  const visibleSuggestions = code.trim().length >= 2 ? suggestions : [];
  const visibleCustomers = customerQuery.trim().length >= 2 && !customer ? customerOptions : [];

  if (done) return <SaleCompleted sale={done} currency={currency} onNewSale={newSale} />;

  return (
    <div
      ref={layoutRef}
      className="grid grid-cols-1 gap-6 pb-[var(--pos-bar-h,calc(5rem+env(safe-area-inset-bottom)))] lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0"
    >
      {/* ---------------------------------------------------------- cart side */}
      <section aria-labelledby="cart-heading" className="min-w-0 space-y-4">
        <div className="space-y-1">
          <label htmlFor="pos-scan" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Scan or search <kbd className="hidden keyboard:inline ml-1 rounded border px-1 text-xs text-slate-500">F2</kbd>
          </label>
          <input
            ref={scanRef}
            id="pos-scan"
            type="text"
            autoComplete="off"
            // Phones: no auto-capital/autocorrect on names and SKUs; the Enter key reads "search".
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onScanKeyDown}
            aria-describedby="pos-scan-status"
            placeholder="Scan a barcode or type a name or SKU"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-base focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
          />
          <p
            id="pos-scan-status"
            role={scanMessage?.tone === "error" ? "alert" : "status"}
            className={`min-h-5 text-sm ${scanMessage?.tone === "error" ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}
          >
            {isLooking ? "Looking up…" : (scanMessage?.text ?? "")}
          </p>
          {visibleSuggestions.length > 0 ? (
            <SuggestionList anchorRef={scanRef}>
              {visibleSuggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => addProduct(s, true)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{s.name}</span> <span className="font-mono text-xs text-slate-500">{s.sku}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm whitespace-nowrap tabular-nums">
                      {formatMoney(s.price, currency)} <span className="block text-xs text-slate-500">stock {s.stock}</span>
                    </span>
                  </button>
                </li>
              ))}
            </SuggestionList>
          ) : null}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <h2 id="cart-heading" className="sr-only">
          Cart
        </h2>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            The cart is empty. Scan a product to start a sale.
          </p>
        ) : (
          // Cart width, not screen width, picks the layout (container query): below
          // 36rem each line is a stacked card (name and SKU on top; quantity,
          // discount, total and remove below), so a phone never scrolls sideways.
          // From 36rem up it is the usual table. Same inputs and labels in both.
          <div className="@container overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="relative overflow-x-auto">
              <table className="block w-full text-sm @xl:table @xl:min-w-full @xl:divide-y @xl:divide-slate-200 @xl:dark:divide-slate-800">
                <caption className="sr-only">Products in this sale</caption>
                <thead className="hidden bg-slate-50 text-left text-slate-700 @xl:table-header-group dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Product</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Discount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-slate-200 @xl:table-row-group dark:divide-slate-800">
                  {items.map((item, index) => {
                    const line = totals.lines[index];
                    const flagged = errorProductId === item.productId;
                    const price = formatMoney(item.unitPrice, currency);
                    return (
                      <tr
                        key={item.productId}
                        data-testid={`cart-line-${item.sku}`}
                        className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 p-3 @xl:table-row @xl:p-0 ${flagged ? "bg-red-50 dark:bg-red-950" : ""}`}
                      >
                        <td className="col-span-4 @xl:px-3 @xl:py-2">
                          <span className="font-medium">{item.name}</span>
                          <span className="block font-mono text-xs text-slate-500">
                            {item.sku}
                            {/* The price column is hidden in the card layout: show it here. */}
                            <span className="font-sans @xl:hidden"> · {price} each</span>
                          </span>
                          {line?.overStock ? (
                            <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
                              Only {item.stock} in stock
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums @xl:table-cell">{price}</td>
                        <td className="@xl:px-3 @xl:py-2 @xl:text-right">
                          <CardCaption>Qty</CardCaption>
                          <QuantityInput
                            id={`qty-${item.productId}`}
                            label={`Quantity of ${item.name}`}
                            value={item.quantity}
                            onCommit={(qty) =>
                              changeCart(() => setItems((cur) => cur.map((i) => (i.productId === item.productId ? { ...i, quantity: qty } : i))))
                            }
                            onBarcode={(scanned) => {
                              setScanMessage({ tone: "info", text: "That looked like a barcode: added it as a product." });
                              scanCode(scanned);
                            }}
                            onDone={backToScan}
                          />
                        </td>
                        <td className="@xl:px-3 @xl:py-2 @xl:text-right">
                          <CardCaption>Discount</CardCaption>
                          <DiscountInput
                            id={`disc-${item.productId}`}
                            label={`Discount on ${item.name}`}
                            value={item.discount}
                            currency={currency}
                            invalid={Boolean(line?.invalidDiscount)}
                            onDone={backToScan}
                            onChange={(d) => changeCart(() => setItems((cur) => cur.map((i) => (i.productId === item.productId ? { ...i, discount: d } : i))))}
                          />
                        </td>
                        <td className="text-right tabular-nums @xl:px-3 @xl:py-2">
                          <CardCaption>Total</CardCaption>
                          <span className="inline-block py-1 font-medium @xl:py-0 @xl:font-normal">{money(line?.totalCents ?? 0)}</span>
                        </td>
                        <td className="text-right @xl:px-3 @xl:py-2">
                          <Button
                            variant="ghost"
                            aria-label={`Remove ${item.name}`}
                            onClick={() =>
                              changeCart(() => {
                                const rest = items.filter((i) => i.productId !== item.productId);
                                setItems(rest);
                                // Empty cart: drop the sale discount too, so it can't come back on the next sale.
                                if (rest.length === 0) setSaleDiscount(null);
                              })
                            }
                          >
                            <XMarkIcon size="sm" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- totals side */}
      <aside aria-label="Sale summary" className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-1">
          <label htmlFor="pos-customer" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Customer (optional) <kbd className="hidden keyboard:inline ml-1 rounded border px-1 text-xs text-slate-500">F4</kbd>
          </label>
          {customer ? (
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span>
                <span className="font-medium">{customer.name}</span>
                {customer.detail ? <span className="block text-xs text-slate-500">{customer.detail}</span> : null}
              </span>
              <Button variant="ghost" aria-label={`Remove customer ${customer.name}`} onClick={() => changeCart(() => setCustomer(null))}>
                <XMarkIcon size="sm" />
              </Button>
            </div>
          ) : (
            <>
              <input
                ref={customerRef}
                id="pos-customer"
                type="search"
                autoComplete="off"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Name, document, phone or email"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
              />
              <Button type="button" variant="ghost" className="px-0 text-sm" onClick={() => setCreatingCustomer(true)}>
                <PlusIcon size="sm" /> New customer
              </Button>
              {visibleCustomers.length > 0 ? (
                <ul aria-label="Customer suggestions" className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {visibleCustomers.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          changeCart(() => setCustomer(c));
                          setCustomerQuery("");
                          scanRef.current?.focus();
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                      >
                        {c.name} {c.detail ? <span className="text-xs text-slate-500">· {c.detail}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-1">
          <span id="sale-discount-label" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Sale discount
          </span>
          <DiscountInput
            id="sale-discount"
            label="Discount on the whole sale"
            value={saleDiscount}
            currency={currency}
            invalid={totals.invalidSaleDiscount}
            disabled={totals.saleDiscountDisabled}
            describedBy="sale-discount-help"
            onChange={(d) => changeCart(() => setSaleDiscount(d))}
            onDone={backToScan}
            wide
          />
          <p id="sale-discount-help" className="text-xs text-slate-500 dark:text-slate-400">
            {totals.saleDiscountDisabled ? "Add products to the cart to give a discount." : null}
          </p>
        </div>

        <dl className="space-y-1 text-sm" data-testid="pos-totals">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd className="tabular-nums">{totals.itemCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{money(totals.grossCents)}</dd>
          </div>
          {totals.lineDiscountCents + totals.saleDiscountCents > 0 ? (
            <div className="flex justify-between text-green-700 dark:text-green-400">
              <dt>Discounts</dt>
              <dd className="tabular-nums">−{money(totals.lineDiscountCents + totals.saleDiscountCents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>
              Tax ({Math.round(taxRate * 10000) / 100}%{pricesIncludeTax ? ", included" : ""})
            </dt>
            <dd className="tabular-nums">{money(totals.taxCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-xl font-semibold dark:border-slate-700">
            <dt>Total</dt>
            <dd className="tabular-nums" data-testid="pos-total">
              {money(totals.totalCents)}
            </dd>
          </div>
        </dl>

        {totals.invalidSaleDiscount ? <Alert tone="error">The discount can&apos;t be larger than the subtotal.</Alert> : null}
        {invalidLineDiscount ? <Alert tone="error">A line discount can&apos;t be larger than that line&apos;s total.</Alert> : null}
        {overLimit ? (
          <Alert tone="error">
            Discounts are {totals.discountPct.toFixed(1)}% of this sale; your limit is {discountLimitPct}%. Lower them or ask an owner
            or admin.
          </Alert>
        ) : null}

        <Button className="w-full py-3 text-base" onClick={openCheckout} disabled={!canCharge}>
          Charge {money(totals.totalCents)} <kbd className="hidden keyboard:inline ml-2 rounded border border-white/40 px-1 text-xs">F8</kbd>
        </Button>
      </aside>

      <ShortcutBar />

      {/* Tablets/phones: the total and the Charge button always in reach. */}
      <div
        ref={barRef}
        data-pos-bottom-bar
        className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        <span className="text-lg font-semibold tabular-nums">
          <span className="sr-only">Total </span>
          {money(totals.totalCents)}
        </span>
        <Button onClick={openCheckout} disabled={!canCharge} className="px-6 py-3 text-base">
          Charge
        </Button>
      </div>

      {creatingCustomer ? (
        <NewCustomerDialog
          initialName={customerQuery}
          onClose={() => {
            setCreatingCustomer(false);
            customerRef.current?.focus();
          }}
          onCreated={(c) => {
            changeCart(() => setCustomer(c));
            setCustomerQuery("");
            setCreatingCustomer(false);
            setTimeout(() => scanRef.current?.focus(), 0);
          }}
        />
      ) : null}

      {checkoutOpen && payments ? (
        <CheckoutDialog
          totalCents={totals.totalCents}
          currency={currency}
          payments={payments}
          onPaymentsChange={setPayments}
          onClose={closeCheckout}
          onConfirm={submit}
          submitting={isSubmitting}
          error={error}
        />
      ) : null}
    </div>
  );
}

function DiscountInput({
  id,
  label,
  value,
  onChange,
  invalid,
  currency,
  onDone,
  wide = false,
  disabled = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: Discount | null;
  onChange: (d: Discount | null) => void;
  invalid: boolean;
  currency: string;
  onDone?: () => void;
  wide?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  // The unit is remembered even while the field is empty, so choosing "%"
  // before typing the number works.
  const [chosenKind, setChosenKind] = useState<Discount["kind"]>(value?.kind ?? "amount");
  const kind = value?.kind ?? chosenKind;
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "$";
  return (
    <div className={`inline-flex items-center gap-1 ${wide ? "w-full" : ""}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        value={value ? String(value.value) : ""}
        placeholder="0"
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onDone?.();
          }
        }}
        onChange={(e) => {
          const text = e.target.value.replace(",", ".");
          if (text.trim() === "") return onChange(null);
          const n = Number(text);
          if (Number.isFinite(n) && n >= 0) onChange({ kind, value: n });
        }}
        className={`${wide ? "flex-1" : "w-16 @xl:w-20"} rounded-md border border-slate-300 bg-white px-2 py-1 text-right tabular-nums focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 aria-[invalid=true]:border-red-500 dark:border-slate-600 dark:bg-slate-900 dark:disabled:bg-slate-800`}
      />
      <label htmlFor={`${id}-kind`} className="sr-only">
        {label}: percent or amount
      </label>
      <select
        id={`${id}-kind`}
        value={kind}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as Discount["kind"];
          setChosenKind(next);
          if (value) onChange({ kind: next, value: value.value });
        }}
        className="rounded-md border border-slate-300 bg-white px-1 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:disabled:bg-slate-800"
      >
        <option value="amount">{symbol}</option>
        <option value="percent">%</option>
      </select>
    </div>
  );
}

/** 6+ digits only: a scanned barcode, never searched by name. */
function looksLikeBarcode(text: string): boolean {
  return /^\d{6,}$/.test(text);
}

/**
 * Product matches under the scan field. On a phone the on-screen keyboard
 * covers the bottom of the page (the visual viewport shrinks): when the list
 * appears, scroll so the field sits at the top of what is visible, and cap the
 * list height to the visible area (it scrolls inside), so no match ends up
 * hidden behind the keyboard or off screen.
 */
function SuggestionList({ anchorRef, children }: { anchorRef: React.RefObject<HTMLInputElement | null>; children: React.ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    // The fixed total/Charge bar (phones) also covers the bottom of the page.
    const visibleBottom = () => {
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const bar = document.querySelector("[data-pos-bottom-bar]")?.getBoundingClientRect();
      return bar && bar.height > 0 && bar.top < bottom ? bar.top : bottom;
    };
    const visibleTop = () => (vv ? vv.offsetTop : 0);
    function fit() {
      const list = listRef.current;
      if (!list) return;
      const room = visibleBottom() - list.getBoundingClientRect().top - 8;
      list.style.maxHeight = `${Math.max(room, 96)}px`;
    }
    // Room for fewer than ~3 matches: bring the field to the top of the visible area.
    const list = listRef.current;
    const anchor = anchorRef.current;
    if (list && anchor && visibleBottom() - list.getBoundingClientRect().top < 160) {
      window.scrollBy({ top: anchor.getBoundingClientRect().top - visibleTop() - 8 });
    }
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [anchorRef]);
  return (
    <ul
      ref={listRef}
      aria-label="Product suggestions"
      className="divide-y divide-slate-200 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900"
    >
      {children}
    </ul>
  );
}

/** Visible column name for the card layout; the inputs keep their own labels. */
function CardCaption({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs text-slate-500 @xl:hidden dark:text-slate-400">
      {children}
    </span>
  );
}

function ShortcutBar() {
  const shortcuts = [
    ["F2", "Scan"],
    ["F4", "Customer"],
    ["F8", "Charge"],
    ["F9", "Complete payment"],
    ["Esc", "Back to cart"],
    ["Alt+Shift+⌫", "Clear sale"],
  ];
  return (
    <section aria-label="Keyboard shortcuts" className="hidden keyboard:block lg:col-span-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        {shortcuts.map(([key, label]) => (
          <li key={key}>
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono dark:border-slate-600 dark:bg-slate-900">{key}</kbd> {label}
          </li>
        ))}
      </ul>
    </section>
  );
}


function SaleCompleted({ sale, currency, onNewSale }: { sale: SaleDetail; currency: string; onNewSale: () => void }) {
  const money = (n: number) => formatMoney(n, currency);
  return (
    <section aria-labelledby="sale-done" className="mx-auto max-w-lg space-y-6 rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
      <div role="status">
        <h2 id="sale-done" className="text-2xl font-semibold text-slate-900 dark:text-white">
          Sale #{sale.number} completed
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{sale.items.reduce((s, i) => s + i.quantity, 0)} items</p>
      </div>
      <p className="text-4xl font-bold tabular-nums" data-testid="sale-done-total">
        {money(sale.total)}
      </p>
      <dl className="space-y-1 text-left text-sm">
        {sale.payments.map((p, index) => (
          <div key={`${p.method}-${index}`} className="flex justify-between">
            <dt>{METHOD_LABELS[p.method]}</dt>
            <dd className="tabular-nums">
              {money(p.amount)}
              {p.tendered !== null ? <span className="text-slate-500"> (received {money(p.tendered)})</span> : null}
            </dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold dark:border-slate-700">
          <dt>Change</dt>
          <dd className="tabular-nums" data-testid="sale-done-change">
            {money(sale.change)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-center gap-3">
        <Button autoFocus onClick={onNewSale} className="px-6 py-3 text-base">
          New sale <kbd className="hidden keyboard:inline ml-2 rounded border border-white/40 px-1 text-xs">Enter</kbd>
        </Button>
        <a href={`/app/sales/${sale.id}/receipt`} target="_blank" rel="noopener" className={buttonClasses("secondary", "py-3")}>
          Print receipt
        </a>
        <a href={`/app/sales/${sale.id}/receipt?download=1`} className={buttonClasses("secondary", "py-3")}>
          Download PDF
        </a>
      </div>
      <Link href={`/app/sales/${sale.id}`} className="inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        View sale
      </Link>
    </section>
  );
}


/**
 * Quantity field. The value is committed on Enter or blur. Safety net: if a
 * scanner types a barcode here by mistake (6+ digits then Enter), the quantity
 * is left as it was and the code is scanned as a product instead.
 */
function QuantityInput({
  id,
  label,
  value,
  onCommit,
  onBarcode,
  onDone,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (qty: number) => void;
  onBarcode: (code: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  function commit(text: string) {
    setDraft(null);
    const qty = Math.floor(Number(text));
    if (Number.isFinite(qty) && qty >= 1 && qty <= 9999 && qty !== value) onCommit(qty);
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={shown}
        // Select on focus: typing replaces the quantity (and a stray scan isn't appended to it).
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const text = e.currentTarget.value;
          if (text.length >= 6) {
            setDraft(null); // keep the previous quantity
            onBarcode(text);
          } else {
            commit(text);
          }
          onDone();
        }}
        className="w-14 rounded-md border border-slate-300 bg-white px-2 py-1 text-right tabular-nums @xl:w-20 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
      />
    </>
  );
}
