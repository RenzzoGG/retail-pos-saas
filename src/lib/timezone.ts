/**
 * Time zone helpers based on Intl (no extra dependencies). Stores have an
 * IANA time zone (stores.timezone); dates are shown and filtered in it.
 */

/** Zones offered in the UI. Intl's list does not include "UTC", so it is added first. */
export function listTimeZones(): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...zones.filter((z) => z !== "UTC")];
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at a given instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of the local wall-clock time `date` + `msOfDay` in `timeZone`.
 * E.g. 2026-11-05 + 15:00 in America/New_York (UTC-5) -> 2026-11-05T20:00:00Z.
 */
export function zonedDateTimeUtc(date: string, msOfDay: number, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + msOfDay;
  // Two passes handle days where the offset changes (DST transitions).
  let guess = localAsUtc - offsetMs(new Date(localAsUtc), timeZone);
  guess = localAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/**
 * The UTC instant when the local day `date` ("YYYY-MM-DD") starts in `timeZone`.
 * E.g. 2026-11-05 in America/New_York (UTC-5) -> 2026-11-05T05:00:00Z.
 */
export function zonedDayStartUtc(date: string, timeZone: string): Date {
  return zonedDateTimeUtc(date, 0, timeZone);
}

/** Milliseconds since local midnight of `now` in `timeZone` (wall clock). */
export function msOfDayInZone(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + now.getUTCMilliseconds();
}

/** Start of the next local day: an exclusive upper bound for "until <date>" filters. */
export function zonedDayEndUtc(date: string, timeZone: string): Date {
  const start = zonedDayStartUtc(date, timeZone);
  const next = new Date(start.getTime() + 36 * 60 * 60 * 1000); // safely inside the next day
  const y = next.toLocaleString("en-CA", { timeZone, year: "numeric" });
  const m = next.toLocaleString("en-CA", { timeZone, month: "2-digit" });
  const d = next.toLocaleString("en-CA", { timeZone, day: "2-digit" });
  return zonedDayStartUtc(`${y}-${m}-${d}`, timeZone);
}

/** "Nov 5, 2026, 2:30 PM" in the store's time zone. */
export function formatDateTime(iso: string | Date, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

/** Today's date ("YYYY-MM-DD") in `timeZone`. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
