/**
 * Cart math for the POS screen, in integer cents and with the same formulas as
 * public.create_sale. It only previews: the database recomputes everything
 * from its own prices and is the one that decides.
 */
export type Discount = { kind: "amount" | "percent"; value: number };

export type CartItem = {
  productId: string;
  name: string;
  sku: string;
  /** Price shown when the product was scanned (the database re-reads it). */
  unitPrice: number;
  /** Stock known when scanned, to warn early. */
  stock: number;
  quantity: number;
  discount: Discount | null;
};

export type LineTotals = {
  productId: string;
  grossCents: number;
  discountCents: number;
  totalCents: number;
  overStock: boolean;
  invalidDiscount: boolean;
};

export type CartTotals = {
  lines: LineTotals[];
  grossCents: number;
  lineDiscountCents: number;
  /** After line discounts (what the database calls subtotal). */
  subtotalCents: number;
  saleDiscountCents: number;
  taxCents: number;
  totalCents: number;
  /** All discounts as a % of the gross amount (what the cashier limit checks). */
  discountPct: number;
  invalidSaleDiscount: boolean;
  itemCount: number;
};

/** Half-up rounding that ignores float noise (e.g. 4.4999999999 from 0.1 * 45). */
export function roundCents(value: number): number {
  return Math.round(Number(value.toFixed(6)));
}

export function toCents(value: number): number {
  return roundCents(value * 100);
}

/** A discount in cents for a base amount; percents are rounded to the cent. */
export function discountCents(baseCents: number, discount: Discount | null): number {
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return 0;
  return discount.kind === "percent" ? roundCents((baseCents * discount.value) / 100) : toCents(discount.value);
}

export function cartTotals(
  items: CartItem[],
  saleDiscount: Discount | null,
  taxRate: number,
  pricesIncludeTax: boolean,
): CartTotals {
  const lines = items.map((item): LineTotals => {
    const grossCents = toCents(item.unitPrice) * item.quantity;
    const discount = discountCents(grossCents, item.discount);
    const invalidDiscount = discount > grossCents || (item.discount?.kind === "percent" && item.discount.value > 100);
    return {
      productId: item.productId,
      grossCents,
      discountCents: discount,
      totalCents: Math.max(0, grossCents - discount),
      overStock: item.quantity > item.stock,
      invalidDiscount,
    };
  });
  const grossCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const lineDiscountCents = grossCents - subtotalCents;
  const saleDiscount$ = discountCents(subtotalCents, saleDiscount);
  const invalidSaleDiscount = saleDiscount$ > subtotalCents;
  const taxableCents = Math.max(0, subtotalCents - saleDiscount$);

  // Same as create_sale: included -> extract the tax; added -> tax on top.
  const taxCents = pricesIncludeTax
    ? roundCents((taxableCents * taxRate) / (1 + taxRate))
    : roundCents(taxableCents * taxRate);
  const totalCents = pricesIncludeTax ? taxableCents : taxableCents + taxCents;

  return {
    lines,
    grossCents,
    lineDiscountCents,
    subtotalCents,
    saleDiscountCents: saleDiscount$,
    taxCents,
    totalCents,
    discountPct: grossCents > 0 ? ((lineDiscountCents + saleDiscount$) * 100) / grossCents : 0,
    invalidSaleDiscount,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
  };
}

/** True when a cashier's discounts exceed the store limit (same rule as the database). */
export function exceedsDiscountLimit(totals: CartTotals, limitPct: number): boolean {
  return (totals.lineDiscountCents + totals.saleDiscountCents) * 100 > limitPct * totals.grossCents;
}

export type PaymentMethod = "cash" | "card" | "transfer";
export type PaymentLine = { method: PaymentMethod; amount: number; tendered: number | null };

export type PaymentSummary = {
  paidCents: number;
  /** Positive: still to pay. Negative: payments exceed the total. */
  remainingCents: number;
  changeCents: number;
  problems: string[];
  ready: boolean;
};

/**
 * Payments must add up to exactly the total (as create_sale requires). For
 * cash, "tendered" is what the customer handed over; change = tendered - amount.
 */
export function paymentSummary(totalCents: number, payments: PaymentLine[]): PaymentSummary {
  const problems: string[] = [];
  let paidCents = 0;
  let changeCents = 0;
  for (const p of payments) {
    const amount = toCents(p.amount);
    if (!Number.isFinite(p.amount) || amount <= 0) {
      problems.push("Each payment must be greater than 0.");
      continue;
    }
    paidCents += amount;
    if (p.method === "cash" && p.tendered !== null) {
      const tendered = toCents(p.tendered);
      if (tendered < amount) problems.push("Cash received is less than the cash amount.");
      else changeCents += tendered - amount;
    }
  }
  const remainingCents = totalCents - paidCents;
  if (remainingCents > 0) problems.push("Payments don't cover the total yet.");
  if (remainingCents < 0) problems.push("Payments are more than the total. Use “Cash received” for change.");
  const unique = [...new Set(problems)];
  return { paidCents, remainingCents, changeCents, problems: unique, ready: unique.length === 0 && totalCents >= 0 };
}
