import { describe, expect, it } from "vitest";
import { type CartItem, cartTotals, discountCents, exceedsDiscountLimit, paymentSummary, roundCents } from "@/features/pos/calc";

const item = (over: Partial<CartItem> = {}): CartItem => ({
  productId: "p1",
  name: "Cable",
  sku: "C-1",
  unitPrice: 10,
  stock: 10,
  quantity: 1,
  discount: null,
  ...over,
});

describe("cart totals", () => {
  it("matches create_sale with tax included (phase-2 example)", () => {
    // P1 x2 (-1.00) + P2 x1 = 44.00; sale discount 4.00 -> 40.00; tax = round(40 * 0.0825 / 1.0825) = 3.05
    const t = cartTotals(
      [item({ quantity: 2, discount: { kind: "amount", value: 1 } }), item({ productId: "p2", unitPrice: 25 })],
      { kind: "amount", value: 4 },
      0.0825,
      true,
    );
    expect(t).toMatchObject({ grossCents: 4500, lineDiscountCents: 100, subtotalCents: 4400, saleDiscountCents: 400, taxCents: 305, totalCents: 4000, itemCount: 3 });
    expect(t.discountPct).toBeCloseTo(11.11, 2);
  });

  it("adds the tax on top when prices exclude it", () => {
    const t = cartTotals([item({ unitPrice: 100 })], null, 0.21, false);
    expect(t).toMatchObject({ subtotalCents: 10000, taxCents: 2100, totalCents: 12100 });
  });

  it("supports percentage discounts on lines and on the sale", () => {
    const t = cartTotals([item({ unitPrice: 19.99, quantity: 3, discount: { kind: "percent", value: 10 } })], { kind: "percent", value: 5 }, 0, true);
    // gross 59.97; 10 % = 6.00 -> 53.97; 5 % of 53.97 = 2.70 -> 51.27
    expect(t).toMatchObject({ grossCents: 5997, lineDiscountCents: 600, saleDiscountCents: 270, totalCents: 5127 });
  });

  it("flags invalid discounts and lines over the known stock", () => {
    const t = cartTotals(
      [item({ quantity: 3, stock: 2, discount: { kind: "amount", value: 31 } }), item({ productId: "p2", discount: { kind: "percent", value: 120 } })],
      { kind: "amount", value: 999 },
      0,
      true,
    );
    expect(t.lines.map((l) => [l.overStock, l.invalidDiscount])).toEqual([[true, true], [false, true]]);
    expect(t.invalidSaleDiscount).toBe(true);
  });

  it("rounds like the database (half up, ignoring float noise)", () => {
    expect(roundCents(304.49999999999994)).toBe(305); // float noise for an exact .5
    expect(roundCents(304.5)).toBe(305);
    expect(roundCents(304.49)).toBe(304);
    expect(discountCents(4500, { kind: "percent", value: 10 })).toBe(450);
    expect(discountCents(999, { kind: "percent", value: 15 })).toBe(150); // 149.85 -> 150
    expect(discountCents(1000, null)).toBe(0);
    expect(discountCents(1000, { kind: "amount", value: -5 })).toBe(0);
  });
});

describe("cashier discount limit", () => {
  it("allows exactly the limit and rejects anything above", () => {
    const atLimit = cartTotals([item({ unitPrice: 50, quantity: 2, discount: { kind: "amount", value: 4 } })], { kind: "amount", value: 6 }, 0, true);
    expect(exceedsDiscountLimit(atLimit, 10)).toBe(false);
    const over = cartTotals([item({ unitPrice: 50, quantity: 2 })], { kind: "amount", value: 10.01 }, 0, true);
    expect(exceedsDiscountLimit(over, 10)).toBe(true);
    expect(exceedsDiscountLimit(cartTotals([item()], null, 0, true), 0)).toBe(false);
  });
});

describe("discount bounds", () => {
  const amount = (value: number) => ({ kind: "amount" as const, value });
  const percent = (value: number) => ({ kind: "percent" as const, value });

  it("ignores the sale discount with an empty cart (subtotal 0): no discount, no error, 0 %", () => {
    const t = cartTotals([], amount(20), 0.0825, true);
    expect(t).toMatchObject({ subtotalCents: 0, saleDiscountCents: 0, totalCents: 0, invalidSaleDiscount: false, saleDiscountDisabled: true, discountPct: 0 });
    expect(exceedsDiscountLimit(t, 10)).toBe(false);
    expect(cartTotals([], percent(50), 0, true).saleDiscountDisabled).toBe(true);
  });

  it("also ignores it when line discounts already take the subtotal to 0", () => {
    const t = cartTotals([item({ discount: percent(100) })], amount(5), 0, true);
    expect(t).toMatchObject({ grossCents: 1000, subtotalCents: 0, saleDiscountCents: 0, totalCents: 0, saleDiscountDisabled: true, invalidSaleDiscount: false });
    expect(t.discountPct).toBe(100);
  });

  it("accepts a sale discount equal to the subtotal (amount and 100 %)", () => {
    for (const d of [amount(10), percent(100)]) {
      const t = cartTotals([item()], d, 0.0825, true);
      expect(t).toMatchObject({ saleDiscountCents: 1000, taxCents: 0, totalCents: 0, invalidSaleDiscount: false });
      expect(t.discountPct).toBe(100);
    }
  });

  it("rejects a sale discount larger than the subtotal after line discounts, without applying it", () => {
    // gross 20.00, line discount 2.00 -> subtotal 18.00
    const lines = [item({ quantity: 2, discount: amount(2) })];
    expect(cartTotals(lines, amount(18), 0, true).invalidSaleDiscount).toBe(false);
    for (const d of [amount(18.01), percent(100.5)]) {
      const t = cartTotals(lines, d, 0, true);
      expect(t).toMatchObject({ invalidSaleDiscount: true, saleDiscountCents: 0, subtotalCents: 1800, totalCents: 1800 });
    }
  });

  it("does not apply an invalid line discount either", () => {
    const t = cartTotals([item({ discount: amount(10.01) })], null, 0, true);
    expect(t.lines[0]).toMatchObject({ invalidDiscount: true, discountCents: 0, totalCents: 1000 });
    expect(t).toMatchObject({ lineDiscountCents: 0, totalCents: 1000, discountPct: 0 });
  });

  it("computes the cashier % right for amounts and percents (always finite, 0–100)", () => {
    const pct = cartTotals([item({ unitPrice: 50, quantity: 2 })], percent(10), 0, true);
    expect(pct.discountPct).toBeCloseTo(10, 6);
    expect(exceedsDiscountLimit(pct, 10)).toBe(false);
    expect(exceedsDiscountLimit(pct, 9.99)).toBe(true);
    const fixed = cartTotals([item({ unitPrice: 50, quantity: 2 })], amount(10.01), 0, true);
    expect(fixed.discountPct).toBeCloseTo(10.01, 6);
    expect(exceedsDiscountLimit(fixed, 10)).toBe(true);
    // A 0-priced product: gross 0, so no division by zero and no false 0 % "over the limit".
    const free = cartTotals([item({ unitPrice: 0 })], amount(1), 0, true);
    expect(free).toMatchObject({ grossCents: 0, discountPct: 0, saleDiscountDisabled: true });
    expect(exceedsDiscountLimit(free, 0)).toBe(false);
    for (const t of [pct, fixed, free]) expect(Number.isFinite(t.discountPct)).toBe(true);
  });
});

describe("payments", () => {
  it("accepts a split payment that covers the total and computes the change", () => {
    const s = paymentSummary(10000, [
      { method: "card", amount: 60, tendered: null },
      { method: "transfer", amount: 10, tendered: null },
      { method: "cash", amount: 30, tendered: 50 },
    ]);
    expect(s).toEqual({ paidCents: 10000, remainingCents: 0, changeCents: 2000, problems: [], ready: true });
  });

  it("explains why a payment can't be confirmed", () => {
    expect(paymentSummary(1000, [{ method: "card", amount: 5, tendered: null }]).problems).toEqual(["Payments don't cover the total yet."]);
    expect(paymentSummary(1000, [{ method: "cash", amount: 10, tendered: 5 }]).problems).toEqual(["Cash received is less than the cash amount."]);
    expect(paymentSummary(1000, [{ method: "card", amount: 12, tendered: null }]).problems[0]).toContain("more than the total");
    expect(paymentSummary(1000, [{ method: "card", amount: 0, tendered: null }]).ready).toBe(false);
  });

  it("uses cents so 0.1 + 0.2 style sums are exact", () => {
    expect(paymentSummary(30, [{ method: "card", amount: 0.1, tendered: null }, { method: "cash", amount: 0.2, tendered: 0.2 }]).ready).toBe(true);
  });
});
