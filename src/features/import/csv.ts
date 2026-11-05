import { COLUMN_KEYS, HEADER_LABELS } from "./columns";
import type { ValidatedRow } from "./validate";

/**
 * CSV cell escaping. Values that start with = + - @ (or tab/CR) are prefixed
 * with an apostrophe: spreadsheet apps would otherwise run them as formulas
 * ("CSV/formula injection"), and the report contains text typed by users.
 */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: string[][]): string {
  // BOM so Excel opens UTF-8 (accents, symbols) correctly; CRLF per RFC 4180.
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Rejected rows with their original values and the reasons, ready to fix and re-upload. */
export function buildErrorReport(rows: ValidatedRow[]): string {
  const header = ["Row", ...COLUMN_KEYS.map((k) => HEADER_LABELS[k]), "Errors"];
  const body = rows
    .filter((r) => r.status === "error")
    .map((r) => [
      String(r.rowNumber),
      ...COLUMN_KEYS.map((k) => r.display[k]),
      r.errors.map((e) => (e.column ? `${HEADER_LABELS[e.column]}: ${e.message}` : e.message)).join(" | "),
    ]);
  return toCsv([header, ...body]);
}
