import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";

describe("formatMoney", () => {
  it("formats USD with two decimals", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
  });

  it("formats zero and negative amounts (e.g. refunds)", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(-19, "USD")).toBe("-$19.00");
  });

  it("uses the store currency", () => {
    expect(formatMoney(10, "EUR", "en-US")).toBe("€10.00");
  });

  it("rejects non-finite amounts", () => {
    expect(() => formatMoney(Number.NaN, "USD")).toThrow(RangeError);
  });
});
