import { msOfDayInZone, todayInZone, zonedDateTimeUtc, zonedDayEndUtc, zonedDayStartUtc } from "@/lib/timezone";

/**
 * Date ranges for the dashboard and reports, always in the store's time zone.
 * Calendar math works on "YYYY-MM-DD" strings (no time zone involved); only the
 * final bounds are converted to UTC instants, as [from, to) for the database.
 */

export const PRESETS = ["today", "last7", "thisMonth", "lastMonth", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  last7: "Last 7 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  custom: "Custom",
};
export const MAX_RANGE_DAYS = 366;
/** Longer ranges are charted by month instead of by day. */
export const MAX_DAILY_DAYS = 62;

export type DateRange = {
  preset: Preset;
  /** Local dates, inclusive. */
  fromDate: string;
  toDate: string;
  /** UTC bounds: [from, to). */
  from: Date;
  to: Date;
  days: number;
  bucket: "day" | "month";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}
const format = (d: Date) => d.toISOString().slice(0, 10);

/** True for a real calendar date like "2026-02-28" (not "2026-02-30"). */
export function isValidDate(date: string): boolean {
  return DATE.test(date) && format(parse(date)) === date;
}
export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}
export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
export function addMonths(date: string, months: number): string {
  const d = parse(startOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return format(d);
}
export const daysInMonth = (date: string) => Number(addDays(addMonths(date, 1), -1).slice(8));
/** Monday of the week of `date` (ISO weeks). */
export function startOfWeek(date: string): string {
  const weekday = (parse(date).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;

function build(preset: Preset, fromDate: string, toDate: string, timeZone: string): DateRange {
  const days = daysBetween(fromDate, toDate);
  return {
    preset,
    fromDate,
    toDate,
    from: zonedDayStartUtc(fromDate, timeZone),
    to: zonedDayEndUtc(toDate, timeZone),
    days,
    bucket: days > MAX_DAILY_DAYS ? "month" : "day",
  };
}

export type RangeInput = { preset?: string | undefined; from?: string | undefined; to?: string | undefined };

/** Range from the Reports form (search params). Unknown presets fall back to "This month". */
export function resolveRange(
  input: RangeInput,
  timeZone: string,
  now = new Date(),
): { ok: true; range: DateRange } | { ok: false; error: string; range: DateRange } {
  const today = todayInZone(timeZone, now);
  const preset: Preset = (PRESETS as readonly string[]).includes(input.preset ?? "") ? (input.preset as Preset) : "thisMonth";
  switch (preset) {
    case "today":
      return { ok: true, range: build("today", today, today, timeZone) };
    case "last7":
      return { ok: true, range: build("last7", addDays(today, -6), today, timeZone) };
    case "lastMonth": {
      const first = addMonths(today, -1);
      return { ok: true, range: build("lastMonth", first, addDays(startOfMonth(today), -1), timeZone) };
    }
    case "custom": {
      const fallback = build("thisMonth", startOfMonth(today), today, timeZone);
      const from = input.from ?? "";
      const to = input.to ?? "";
      if (!isValidDate(from) || !isValidDate(to)) return { ok: false, error: "Choose both dates.", range: fallback };
      if (from > to) return { ok: false, error: "The start date must be on or before the end date.", range: fallback };
      if (daysBetween(from, to) > MAX_RANGE_DAYS) {
        return { ok: false, error: `Choose at most ${MAX_RANGE_DAYS} days.`, range: fallback };
      }
      return { ok: true, range: build("custom", from, to, timeZone) };
    }
    default:
      return { ok: true, range: build("thisMonth", startOfMonth(today), today, timeZone) };
  }
}

export const DASHBOARD_PERIODS = ["today", "week", "month"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const PERIOD_LABELS: Record<DashboardPeriod, { title: string; previous: string }> = {
  today: { title: "Today", previous: "vs. yesterday at this time" },
  week: { title: "This week", previous: "vs. the same point last week" },
  month: { title: "This month", previous: "vs. the same point last month" },
};

export type PeriodWindow = { current: { from: Date; to: Date }; previous: { from: Date; to: Date } };

/**
 * A period so far ("today until now", "this week until now"...) and the previous
 * one cut at the same elapsed wall-clock time: Nov 1–5 15:00 vs Oct 1–5 15:00.
 * If the previous month is shorter (Mar 31 vs Feb), all of it is used.
 */
export function periodWindow(period: DashboardPeriod, timeZone: string, now = new Date()): PeriodWindow {
  const today = todayInZone(timeZone, now);
  const ms = msOfDayInZone(timeZone, now);
  let start: string;
  let prevStart: string;
  let prevDay: string | null; // same wall-clock moment in the previous period (null = its end)
  if (period === "today") {
    start = today;
    prevStart = addDays(today, -1);
    prevDay = prevStart;
  } else if (period === "week") {
    start = startOfWeek(today);
    prevStart = addDays(start, -7);
    prevDay = addDays(today, -7);
  } else {
    start = startOfMonth(today);
    prevStart = addMonths(today, -1);
    const day = Number(today.slice(8));
    prevDay = day <= daysInMonth(prevStart) ? `${prevStart.slice(0, 8)}${today.slice(8)}` : null;
  }
  const from = zonedDayStartUtc(start, timeZone);
  return {
    current: { from, to: now },
    previous: {
      from: zonedDayStartUtc(prevStart, timeZone),
      to: prevDay === null ? from : zonedDateTimeUtc(prevDay, ms, timeZone),
    },
  };
}

/** The last `days` days including today, for the dashboard chart. */
export function lastDays(days: number, timeZone: string, now = new Date()): DateRange {
  const today = todayInZone(timeZone, now);
  return build("custom", addDays(today, -(days - 1)), today, timeZone);
}

/** Change vs. the previous period, as a fraction (0.12 = +12 %); null when there is nothing to compare. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

/** Search params for links that keep the chosen range. */
export function rangeParams(range: Pick<DateRange, "preset" | "fromDate" | "toDate">): string {
  const params = new URLSearchParams({ preset: range.preset });
  if (range.preset === "custom") {
    params.set("from", range.fromDate);
    params.set("to", range.toDate);
  }
  return params.toString();
}
