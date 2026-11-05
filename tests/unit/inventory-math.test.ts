import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent, marginInfo, toCents } from "@/lib/money";
import { escapeSearchTerm } from "@/lib/postgrest";
import { formatDateTime, isValidTimeZone, todayInZone, zonedDayEndUtc, zonedDayStartUtc } from "@/lib/timezone";

describe("money", () => {
  it("converts Postgres numeric strings to cents without float errors", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(() => toCents("abc")).toThrow(RangeError);
  });

  it("computes the margin on the net price when prices include tax", () => {
    // 10.825 incl. 8.25 % tax -> net 10.00; cost 6.00 -> margin 4.00 (40 %)
    expect(marginInfo("10.83", "6.00", "0.0825", true)).toMatchObject({ netPrice: 10, margin: 4, cost: 6 });
    const m = marginInfo("10.83", "6.00", "0.0825", true);
    expect(m?.marginPct).toBeCloseTo(0.4, 5);
  });

  it("uses the price as-is when tax is added at checkout", () => {
    expect(marginInfo("100.00", "75.00", "0.21", false)).toEqual({ netPrice: 100, cost: 75, margin: 25, marginPct: 0.25 });
  });

  it("returns null without a cost and handles negative margins and free items", () => {
    expect(marginInfo("10.00", null, "0", true)).toBeNull();
    expect(marginInfo("5.00", "8.00", "0", true)?.margin).toBe(-3);
    expect(marginInfo("0.00", "1.00", "0", true)?.marginPct).toBeNull();
  });

  it("formats store currency and percentages", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(9.5, "EUR")).toBe("€9.50");
    expect(formatPercent(0.4)).toBe("40%");
    expect(formatPercent(-0.125)).toBe("-12.5%");
  });
});

describe("time zones", () => {
  it("finds when a local day starts in UTC", () => {
    expect(zonedDayStartUtc("2026-11-05", "America/New_York").toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(zonedDayStartUtc("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(zonedDayStartUtc("2026-11-05", "Europe/Madrid").toISOString()).toBe("2026-11-04T23:00:00.000Z");
    expect(zonedDayStartUtc("2026-11-05", "UTC").toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("handles DST transition days (US clocks go back on 2026-11-01)", () => {
    expect(zonedDayStartUtc("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(zonedDayEndUtc("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("formats and validates", () => {
    expect(formatDateTime("2026-11-05T05:00:00Z", "America/New_York")).toBe("Nov 5, 2026, 12:00 AM");
    expect(todayInZone("Asia/Tokyo", new Date("2026-11-05T20:00:00Z"))).toBe("2026-11-06");
    expect(isValidTimeZone("America/Lima")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(() => zonedDayStartUtc("05/11/2026", "UTC")).toThrow(RangeError);
  });
});

describe("escapeSearchTerm", () => {
  it("neutralizes PostgREST syntax and wildcards", () => {
    expect(escapeSearchTerm("usb-c, cable")).toBe("usb-c cable");
    expect(escapeSearchTerm("a),name.eq.(x")).toBe("a name.eq. x");
    expect(escapeSearchTerm("SKU-A.1")).toBe("SKU-A.1");
    expect(escapeSearchTerm("100%_*")).toBe("100");
    expect(escapeSearchTerm('  "quoted"  ')).toBe("quoted");
    expect(escapeSearchTerm("x".repeat(100))).toHaveLength(64);
  });
});
