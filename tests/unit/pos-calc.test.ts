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
