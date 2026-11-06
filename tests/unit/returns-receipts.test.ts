import { describe, expect, it } from "vitest";
import { type SaleReceiptData, COLUMNS, columns, returnReceiptLines, saleReceiptLines, wrap } from "@/features/receipts/layout";
import { previewRefund } from "@/features/returns/calc";
import { saleProfitCents } from "@/features/sales/profit";

describe("refund preview (same rules as create_return)", () => {
  // Phase-2 example: P1 x2 (line 19.00) + P2 x1 (25.00) = 44.00, sale discount 4.00 -> total 40.00.
  const sale = { totalCents: 4000, subtotalCents: 4400, refundedCents: 0 };
  const items = [
    { saleItemId: "p1", soldQty: 2, returnedQty: 0, lineTotalCents: 1900 },
    { saleItemId: "p2", soldQty: 1, returnedQty: 0, lineTotalCents: 2500 },
  ];

  it("refunds the line's share of the total (discount prorated)", () => {
    const p = previewRefund(sale, items, [{ saleItemId: "p1", quantity: 1 }]);
    expect(p).toMatchObject({ totalCents: 864, completesSale: false, errors: [] }); // 40 * 9.50 / 44
  });

  it("the return that completes the sale refunds exactly what is left", () => {
    const p = previewRefund({ ...sale, refundedCents: 864 }, [{ ...items[0]!, returnedQty: 1 }, items[1]!], [
      { saleItemId: "p1", quantity: 1 },
      { saleItemId: "p2", quantity: 1 },
    ]);
    expect(p.completesSale).toBe(true);
    expect(p.totalCents).toBe(3136);
    expect(p.lines.reduce((s, l) => s + l.refundCents, 0)).toBe(3136);
  });

  it("never refunds more than what is left and rejects returning too much", () => {
    const rounding = previewRefund({ totalCents: 1000, subtotalCents: 1000, refundedCents: 995 }, [
      { saleItemId: "a", soldQty: 3, returnedQty: 1, lineTotalCents: 1000 },
    ], [{ saleItemId: "a", quantity: 1 }]);
    expect(rounding.totalCents).toBe(5);
    expect(previewRefund(sale, items, [{ saleItemId: "p2", quantity: 2 }]).errors).toEqual(["You can return at most 1 of an item."]);
    expect(previewRefund(sale, items, []).totalCents).toBe(0);
  });
});

describe("profit after returns", () => {
  it("removes the refunded share of revenue and the cost of restocked units", () => {
    // Total 40.00 incl. 3.05 tax; cost 2 x 5.00 + 12.00 = 22.00 -> profit 36.95 - 22.00 = 14.95
    expect(saleProfitCents({ totalCents: 4000, taxCents: 305, refundedCents: 0, soldCostCents: 2200, restockedCostCents: 0 })).toBe(1495);
    // Refund 8.64 for 1 restocked P1 (cost 5.00): revenue 36.95 x 31.36 / 40 = 28.97; cost 17.00 -> 11.97
    expect(saleProfitCents({ totalCents: 4000, taxCents: 305, refundedCents: 864, soldCostCents: 2200, restockedCostCents: 500 })).toBe(1197);
    // Same refund but written off: the 5.00 cost stays -> 6.97
    expect(saleProfitCents({ totalCents: 4000, taxCents: 305, refundedCents: 864, soldCostCents: 2200, restockedCostCents: 0 })).toBe(697);
    // Fully returned and restocked: no revenue, no cost
    expect(saleProfitCents({ totalCents: 4000, taxCents: 305, refundedCents: 4000, soldCostCents: 2200, restockedCostCents: 2200 })).toBe(0);
  });
});

describe("receipt layout", () => {
  const receipt: SaleReceiptData = {
    storeName: "Stocktill Demo Electronics",
    footer: "Thanks for shopping with us!\nVisit stocktill.test",
    timeZone: "America/New_York",
    currency: "USD",
    number: 42,
    createdAt: "2026-11-05T19:30:00Z",
    cashierName: "Carla Cashier",
    customerName: "Jordan Rivera",
    items: [
      { name: "USB-C to USB-C Cable 1 m", sku: "CBL-USBC-1M", quantity: 2, unitPrice: 9.99, discount: 1, lineTotal: 18.98 },
      { name: "A very long product name that certainly needs to wrap onto two lines", sku: "LONG", quantity: 1, unitPrice: 25, discount: 0, lineTotal: 25 },
    ],
    grossSubtotal: 44.98,
    lineDiscounts: 1,
    saleDiscount: 4,
    taxRate: 0.0825,
    pricesIncludeTax: true,
    taxTotal: 3.05,
    total: 39.98,
    payments: [
      { method: "card", amount: 20, tendered: null, change: 0 },
      { method: "cash", amount: 19.98, tendered: 20, change: 0.02 },
    ],
    change: 0.02,
    returns: [],
  };

  it("has every required part, fits 42 columns and shows no costs", () => {
    const lines = saleReceiptLines(receipt);
    const text = lines.map((l) => l.text).join("\n");
    for (const expected of [
      "Stocktill Demo Electronics",
      "Sale #42",
      "Nov 5, 2026, 2:30 PM", // store time zone
      "Cashier: Carla Cashier",
      "Customer: Jordan Rivera",
      "2 x $9.99",
      "Discount",
      "Tax 8.25% (included)",
      "Card",
      "Cash received",
      "Thanks for shopping with us!",
      "Visit stocktill.test",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("Thank you!"); // the store's note replaces the default line
    expect(text).toMatch(/TOTAL\s+\$39\.98/);
    expect(text).toMatch(/Change\s+\$0\.02/);
    expect(text).toMatch(/Discounts\s+-\$5\.00/);
    expect(lines.every((l) => l.text.length <= COLUMNS)).toBe(true);
    expect(text.toLowerCase()).not.toMatch(/cost|profit|margin/);
  });

  it("shows added tax and a Returns section with the net total", () => {
    const text = saleReceiptLines({
      ...receipt,
      pricesIncludeTax: false,
      taxRate: 0.21,
      returns: [{ createdAt: "2026-11-06T15:00:00Z", refund: 8.64, method: "cash", units: 1 }],
    })
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("Tax 21%");
    expect(text).not.toContain("(included)");
    expect(text).toContain("RETURNS");
    expect(text).toMatch(/1 item, Cash\s+-\$8\.64/);
    expect(text).toMatch(/Net total\s+\$31\.34/);
  });

  it("without a receipt note prints the default thank-you line", () => {
    const lines = saleReceiptLines({ ...receipt, footer: null });
    expect(lines.at(-1)?.text).toBe("Thank you!");
  });

  it("return receipt lists items, write-offs, reason and refund", () => {
    const text = returnReceiptLines({
      storeName: "Shop",
      timeZone: "UTC",
      currency: "EUR",
      saleNumber: 7,
      createdAt: "2026-11-06T10:00:00Z",
      createdBy: "Adam Admin",
      reason: "Broken on arrival",
      refundMethod: "card",
      refundTotal: 12.1,
      items: [{ name: "Phone Stand", sku: "OTH-001", quantity: 1, refund: 12.1, restocked: false }],
    })
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("RETURN RECEIPT");
    expect(text).toContain("For sale #7");
    expect(text).toContain("Not restocked (damaged)");
    expect(text).toContain("Broken on arrival");
    expect(text).toMatch(/REFUND \(Card\)\s+€12\.10/);
  });

  it("columns and wrap never overflow", () => {
    expect(columns("Short", "$1.00")).toHaveLength(COLUMNS);
    expect(columns("x".repeat(80), "$1,234.56")).toHaveLength(COLUMNS);
    expect(wrap("word ".repeat(30)).every((l) => l.length <= COLUMNS)).toBe(true);
    expect(wrap("a".repeat(100))[0]).toHaveLength(COLUMNS);
  });
});
