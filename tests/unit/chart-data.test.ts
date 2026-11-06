import { describe, expect, it } from "vitest";
import { barShares, bucketLabel, columnGeometry, compactMoney, labelIndexes, niceScale, seriesSummary, toSeries } from "@/features/reports/chart-data";

describe("chart data", () => {
  it("nice scales", () => {
    expect(niceScale(870)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] });
    expect(niceScale(43.5)).toEqual({ max: 60, ticks: [0, 20, 40, 60] });
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(1)).toEqual({ max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  });

  it("labels days and months (calendar dates, no time zone shift)", () => {
    expect(bucketLabel("2026-11-05", "day")).toBe("Nov 5");
    expect(bucketLabel("2026-11-05", "day", true)).toBe("Thu, Nov 5, 2026");
    expect(bucketLabel("2026-11-01", "month")).toBe("Nov 2026");
    expect(toSeries([{ bucket: "2026-01-01", value: 3 }], "day")).toEqual([{ key: "2026-01-01", label: "Jan 1", value: 3 }]);
  });

  it("shows at most N x labels, always the last one", () => {
    expect(labelIndexes(5, 8)).toEqual([0, 1, 2, 3, 4]);
    const idx = labelIndexes(30, 6);
    expect(idx.length).toBeLessThanOrEqual(6);
    expect(idx.at(-1)).toBe(29);
    expect(labelIndexes(0, 6)).toEqual([]);
  });

  it("column geometry: bars capped at 24 px, from the baseline, empty days have no path", () => {
    const g = columnGeometry([
      { key: "a", label: "A", value: 100 },
      { key: "b", label: "B", value: 0 },
      { key: "c", label: "C", value: 50 },
    ]);
    expect(g.bars.every((b) => b.w <= 24)).toBe(true);
    expect(g.bars[0]?.y).toBeCloseTo(g.plot.top + (g.plot.bottom - g.plot.top) * 0); // 100 = scale top (nice max 100)
    expect(g.bars[1]?.path).toBe("");
    expect(g.bars[2]?.h).toBeCloseTo((g.plot.bottom - g.plot.top) / 2);
    expect(g.bars[0]?.path.startsWith(`M${Math.round((g.bars[0]?.x ?? 0) * 100) / 100},${g.plot.bottom}`)).toBe(true);
    expect(g.ticks[0]).toEqual({ value: 0, y: g.plot.bottom });
    // 30 bars still leave a gap between neighbours.
    const many = columnGeometry(Array.from({ length: 30 }, (_, i) => ({ key: String(i), label: String(i), value: i })));
    const [first, second] = many.bars;
    expect((second?.x ?? 0) - ((first?.x ?? 0) + (first?.w ?? 0))).toBeGreaterThanOrEqual(2);
  });

  it("negative values are drawn at zero", () => {
    const g = columnGeometry([{ key: "a", label: "A", value: -5 }, { key: "b", label: "B", value: 10 }]);
    expect(g.bars[0]?.h).toBe(0);
  });

  it("bar shares relative to the largest", () => {
    expect(barShares([{ value: 50 }, { value: 25 }, { value: 0 }]).map((b) => b.pct)).toEqual([100, 50, 0]);
    expect(barShares([{ value: 0 }]).map((b) => b.pct)).toEqual([0]);
    expect(barShares([{ value: 10 }, { value: -4 }]).map((b) => b.pct)).toEqual([100, 0]);
  });

  it("compact money and the accessible summary", () => {
    expect(compactMoney(1234, "USD")).toBe("$1.2K");
    expect(compactMoney(0, "USD")).toBe("$0");
    const money = (n: number) => `$${n.toFixed(2)}`;
    expect(seriesSummary([{ key: "a", label: "Nov 1", value: 10 }, { key: "b", label: "Nov 2", value: 30 }], money)).toBe(
      "2 periods from Nov 1 to Nov 2. Total $40.00. Highest: Nov 2, $30.00.",
    );
    expect(seriesSummary([], money)).toBe("No data.");
  });
});
