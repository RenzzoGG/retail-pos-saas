import { describe, expect, it } from "vitest";
import { change, lastDays, periodWindow, rangeParams, resolveRange, startOfWeek } from "@/features/reports/ranges";

const NY = "America/New_York";
const iso = (d: Date) => d.toISOString();

describe("report ranges (store time zone)", () => {
  const now = new Date("2026-11-05T20:00:00Z"); // Thu Nov 5, 15:00 in New York (EST)

  it("presets: today, last 7 days, this month, last month", () => {
    const today = resolveRange({ preset: "today" }, NY, now);
    expect(today.ok && [today.range.fromDate, today.range.toDate, iso(today.range.from), iso(today.range.to)]).toEqual([
      "2026-11-05", "2026-11-05", "2026-11-05T05:00:00.000Z", "2026-11-06T05:00:00.000Z",
    ]);
    const last7 = resolveRange({ preset: "last7" }, NY, now);
    expect(last7.ok && [last7.range.fromDate, last7.range.toDate, last7.range.days]).toEqual(["2026-10-30", "2026-11-05", 7]);
    const thisMonth = resolveRange({}, NY, now); // default
    expect(thisMonth.ok && [thisMonth.range.preset, thisMonth.range.fromDate, thisMonth.range.toDate]).toEqual(["thisMonth", "2026-11-01", "2026-11-05"]);
    // Nov 1 starts at 04:00Z (still EDT at midnight; clocks go back at 02:00).
    expect(thisMonth.ok && iso(thisMonth.range.from)).toBe("2026-11-01T04:00:00.000Z");
    const lastMonth = resolveRange({ preset: "lastMonth" }, NY, now);
    expect(lastMonth.ok && [lastMonth.range.fromDate, lastMonth.range.toDate, lastMonth.range.days]).toEqual(["2026-10-01", "2026-10-31", 31]);
  });

  it("last month in January is December of the previous year", () => {
    const r = resolveRange({ preset: "lastMonth" }, NY, new Date("2026-01-15T17:00:00Z"));
    expect(r.ok && [r.range.fromDate, r.range.toDate]).toEqual(["2025-12-01", "2025-12-31"]);
  });

  it("DST days have 23 and 25 hours", () => {
    const spring = resolveRange({ preset: "custom", from: "2026-03-08", to: "2026-03-08" }, NY, now);
    expect(spring.ok && [iso(spring.range.from), iso(spring.range.to)]).toEqual(["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
    expect(spring.ok && (spring.range.to.getTime() - spring.range.from.getTime()) / 3_600_000).toBe(23);
    const fall = resolveRange({ preset: "custom", from: "2026-11-01", to: "2026-11-01" }, NY, now);
    expect(fall.ok && (fall.range.to.getTime() - fall.range.from.getTime()) / 3_600_000).toBe(25);
  });

  it("validates custom ranges and picks monthly buckets for long ones", () => {
    expect(resolveRange({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, NY, now)).toMatchObject({ ok: false, error: "Choose both dates." });
    expect(resolveRange({ preset: "custom", from: "2026-03-02", to: "2026-03-01" }, NY, now)).toMatchObject({ ok: false });
    expect(resolveRange({ preset: "custom", from: "2025-01-01", to: "2026-03-01" }, NY, now)).toMatchObject({ ok: false, error: "Choose at most 366 days." });
    const invalid = resolveRange({ preset: "custom", from: "x", to: "y" }, NY, now);
    expect(invalid.range.preset).toBe("thisMonth"); // falls back to a valid range
    const long = resolveRange({ preset: "custom", from: "2026-01-01", to: "2026-06-30" }, NY, now);
    expect(long.ok && [long.range.days, long.range.bucket]).toEqual([181, "month"]);
    const short = resolveRange({ preset: "custom", from: "2026-01-01", to: "2026-03-03" }, NY, now);
    expect(short.ok && [short.range.days, short.range.bucket]).toEqual([62, "day"]);
  });

  it("other time zones: UTC and a positive offset", () => {
    const utc = resolveRange({ preset: "today" }, "UTC", now);
    expect(utc.ok && iso(utc.range.from)).toBe("2026-11-05T00:00:00.000Z");
    const tokyo = resolveRange({ preset: "today" }, "Asia/Tokyo", now); // already Nov 6 05:00 there
    expect(tokyo.ok && [tokyo.range.fromDate, iso(tokyo.range.from)]).toEqual(["2026-11-06", "2026-11-05T15:00:00.000Z"]);
  });

  it("weeks start on Monday", () => {
    expect(startOfWeek("2026-11-05")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });

  it("keeps the range in links", () => {
    expect(rangeParams({ preset: "last7", fromDate: "a", toDate: "b" })).toBe("preset=last7");
    expect(rangeParams({ preset: "custom", fromDate: "2026-01-01", toDate: "2026-01-31" })).toBe("preset=custom&from=2026-01-01&to=2026-01-31");
  });
});

describe("dashboard periods: same elapsed wall-clock time", () => {
  it("month: Nov 1–5 15:00 vs Oct 1–5 15:00 (across the DST change)", () => {
    const w = periodWindow("month", NY, new Date("2026-11-05T20:00:00Z"));
    expect([iso(w.current.from), iso(w.current.to)]).toEqual(["2026-11-01T04:00:00.000Z", "2026-11-05T20:00:00.000Z"]);
    expect([iso(w.previous.from), iso(w.previous.to)]).toEqual(["2026-10-01T04:00:00.000Z", "2026-10-05T19:00:00.000Z"]);
  });

  it("today vs yesterday at the same wall-clock time, the day after spring forward", () => {
    // Mon Mar 9 15:00 EDT. Yesterday (Mar 8) had 23 hours: 15:00 EDT = 19:00Z, not 20:00Z.
    const w = periodWindow("today", NY, new Date("2026-03-09T19:00:00Z"));
    expect([iso(w.previous.from), iso(w.previous.to)]).toEqual(["2026-03-08T05:00:00.000Z", "2026-03-08T19:00:00.000Z"]);
  });

  it("week: Monday until now vs the same weekday and time last week", () => {
    const w = periodWindow("week", NY, new Date("2026-11-05T20:00:00Z"));
    expect(iso(w.current.from)).toBe("2026-11-02T05:00:00.000Z");
    expect([iso(w.previous.from), iso(w.previous.to)]).toEqual(["2026-10-26T04:00:00.000Z", "2026-10-29T19:00:00.000Z"]);
  });

  it("a shorter previous month is used whole (Mar 31 vs all of February)", () => {
    const w = periodWindow("month", NY, new Date("2026-03-31T16:00:00Z"));
    expect([iso(w.previous.from), iso(w.previous.to)]).toEqual(["2026-02-01T05:00:00.000Z", "2026-03-01T05:00:00.000Z"]);
  });

  it("last 30 days for the chart", () => {
    const r = lastDays(30, NY, new Date("2026-11-05T20:00:00Z"));
    expect([r.fromDate, r.toDate, r.days, r.bucket]).toEqual(["2026-10-07", "2026-11-05", 30, "day"]);
  });

  it("change vs. previous", () => {
    expect(change(110, 100)).toBeCloseTo(0.1);
    expect(change(50, 100)).toBeCloseTo(-0.5);
    expect(change(0, 0)).toBe(0);
    expect(change(10, 0)).toBeNull();
    expect(change(-5, -10)).toBeCloseTo(0.5); // profit going from -10 to -5 is an improvement
  });
});
