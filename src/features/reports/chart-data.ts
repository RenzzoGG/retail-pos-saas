/**
 * Pure helpers that turn report rows into chart geometry and labels.
 * The SVG components only draw what these return (tested with Vitest).
 */

export type SeriesPoint = { key: string; label: string; value: number };

/** Axis top and ticks at "nice" steps (1, 2, 2.5, 5 × 10^n). */
export function niceScale(max: number, tickCount = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { max: top, ticks };
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-11-05" -> "Nov 5" (day) / "Nov 2026" (month). Dates are local calendar dates. */
export function bucketLabel(date: string, bucket: "day" | "month", long = false): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === "month") return MONTH.format(d);
  return (long ? LONG_DAY : SHORT_DAY).format(d);
}

export function toSeries(rows: { bucket: string; value: number }[], bucket: "day" | "month"): SeriesPoint[] {
  return rows.map((r) => ({ key: r.bucket, label: bucketLabel(r.bucket, bucket), value: r.value }));
}

/** Indexes of the x labels to show: at most `max`, evenly spaced, always the last one. */
export function labelIndexes(count: number, max: number): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil((count - 1) / (max - 1));
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

export type ColumnGeometry<T extends SeriesPoint = SeriesPoint> = {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  ticks: { value: number; y: number }[];
  bars: (T & { x: number; y: number; w: number; h: number; band: number; path: string })[];
};

/**
 * Column chart geometry in a fixed viewBox (scaled by CSS). Bars are capped at
 * 24 px, have a 4 px rounded top and a square base on the baseline.
 */
export function columnGeometry<T extends SeriesPoint>(
  points: T[],
  { width = 640, height = 220, left = 48, top = 12, right = 8, bottom = 28 } = {},
): ColumnGeometry<T> {
  const plot = { left, top, right: width - right, bottom: height - bottom };
  const scale = niceScale(Math.max(0, ...points.map((p) => p.value)));
  const plotHeight = plot.bottom - plot.top;
  const band = points.length > 0 ? (plot.right - plot.left) / points.length : 0;
  const w = Math.min(24, Math.max(2, band - 2)); // ≥ 2 px gap between neighbours
  const y = (v: number) => plot.bottom - (Math.max(0, v) / scale.max) * plotHeight;
  return {
    width,
    height,
    plot,
    ticks: scale.ticks.map((value) => ({ value, y: y(value) })),
    bars: points.map((p, i) => {
      const x = plot.left + i * band + (band - w) / 2;
      const top = y(p.value);
      const h = plot.bottom - top;
      const r = Math.min(4, w / 2, h);
      const path =
        h <= 0
          ? ""
          : `M${round(x)},${round(plot.bottom)}V${round(top + r)}Q${round(x)},${round(top)} ${round(x + r)},${round(top)}` +
            `H${round(x + w - r)}Q${round(x + w)},${round(top)} ${round(x + w)},${round(top + r)}V${round(plot.bottom)}Z`;
      return { ...p, x, y: top, w, h, band, path };
    }),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Horizontal bars: each item's share of the largest one (0–100), for widths in %. */
export function barShares<T extends { value: number }>(items: T[]): (T & { pct: number })[] {
  const max = Math.max(0, ...items.map((i) => i.value));
  return items.map((i) => ({ ...i, pct: max > 0 ? Math.max(0, Math.round((i.value / max) * 1000) / 10) : 0 }));
}

/** "$1.2K" style for axis ticks. */
export function compactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Short sentence for the chart's accessible name. */
export function seriesSummary(points: SeriesPoint[], format: (n: number) => string): string {
  if (points.length === 0) return "No data.";
  const total = points.reduce((s, p) => s + p.value, 0);
  const best = points.reduce((a, b) => (b.value > a.value ? b : a));
  const first = points[0];
  const last = points.at(-1);
  return `${points.length} periods from ${first?.label} to ${last?.label}. Total ${format(total)}. Highest: ${best.label}, ${format(best.value)}.`;
}
