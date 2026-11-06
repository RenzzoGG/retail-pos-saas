import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT, FINAL_DEMO, INITIAL_DEMO, demoReducer, formatUsd, includedTax } from "@/features/landing/demo-cart";

describe("landing hero: demo register", () => {
  it("scanning adds lines, repeats raise the quantity and totals include tax", () => {
    let s = demoReducer(INITIAL_DEMO, { type: "scan", sku: "CBL-USBC-1M" });
    s = demoReducer(s, { type: "scan", sku: "CHG-20W-C" });
    s = demoReducer(s, { type: "scan", sku: "CBL-USBC-1M" });
    expect(s.lines.map((l) => [l.sku, l.quantity, l.lineCents])).toEqual([
      ["CBL-USBC-1M", 2, 1998],
      ["CHG-20W-C", 1, 1999],
    ]);
    expect(s.totalCents).toBe(3997);
    expect(s.taxCents).toBe(includedTax(3997));
    expect(s.lastSku).toBe("CBL-USBC-1M");
    expect(s.status).toBe("scanning");
  });

  it("the whole script ends paid with the change and updated sample figures", () => {
    expect(FINAL_DEMO).toMatchObject({
      status: "paid",
      totalCents: 5596, // 2 x 9.99 + 19.99 + 15.99
      tenderedCents: 6000,
      changeCents: 404,
      saleNumber: INITIAL_DEMO.saleNumber + 1,
      todaySalesCount: INITIAL_DEMO.todaySalesCount + 1,
      todaySalesCents: INITIAL_DEMO.todaySalesCents + 5596,
    });
    expect(FINAL_DEMO.lines).toHaveLength(3);
    expect(DEMO_SCRIPT.reduce(demoReducer, INITIAL_DEMO)).toEqual(FINAL_DEMO);
  });

  it("tax included at 8.25 %", () => {
    expect(includedTax(5596)).toBe(426); // 55.96 - 55.96 / 1.0825 = 4.2648…
    expect(includedTax(0)).toBe(0);
  });

  it("guards: no charge on an empty cart or with too little cash; nothing changes after paying; reset", () => {
    expect(demoReducer(INITIAL_DEMO, { type: "charge", tenderedCents: 6000 })).toBe(INITIAL_DEMO);
    const one = demoReducer(INITIAL_DEMO, { type: "scan", sku: "CHG-20W-C" });
    expect(demoReducer(one, { type: "charge", tenderedCents: 1000 })).toBe(one);
    expect(demoReducer(FINAL_DEMO, { type: "scan", sku: "CHG-20W-C" })).toBe(FINAL_DEMO);
    expect(demoReducer(FINAL_DEMO, { type: "reset" })).toBe(INITIAL_DEMO);
    expect(() => demoReducer(INITIAL_DEMO, { type: "scan", sku: "NOPE" })).toThrow();
  });

  it("formats dollars", () => {
    expect(formatUsd(5596)).toBe("$55.96");
    expect(formatUsd(128_410)).toBe("$1,284.10");
  });
});
