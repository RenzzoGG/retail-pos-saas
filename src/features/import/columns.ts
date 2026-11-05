/**
 * Columns of the import file. Headers are matched ignoring case, spaces,
 * underscores and dashes, in any order, with a few common aliases.
 */
export const COLUMN_KEYS = [
  "name",
  "sku",
  "barcode",
  "category",
  "sale_price",
  "low_stock_threshold",
  "initial_stock",
  "unit_cost",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export type ColumnSpec = { key: ColumnKey; header: string; required: boolean; aliases: string[]; help: string };

export const COLUMNS: readonly ColumnSpec[] = [
  { key: "name", header: "Name", required: true, aliases: ["product", "product name"], help: "Product name (up to 120 characters)." },
  { key: "sku", header: "SKU", required: true, aliases: ["item code", "product code"], help: "Unique code in your store, no spaces." },
  { key: "barcode", header: "Barcode", required: false, aliases: ["ean", "upc", "gtin", "bar code"], help: "Optional. 4–64 letters, digits or dashes. Keep the column as text so leading zeros survive." },
  { key: "category", header: "Category", required: false, aliases: [], help: "Optional." },
  { key: "sale_price", header: "Sale price", required: true, aliases: ["price", "selling price", "retail price"], help: "0 or more, up to 2 decimals." },
  { key: "low_stock_threshold", header: "Low stock threshold", required: false, aliases: ["min stock", "minimum stock", "reorder level"], help: "Optional whole number (default 0)." },
  { key: "initial_stock", header: "Initial stock", required: false, aliases: ["stock", "quantity", "qty", "opening stock"], help: "Optional whole number. Added as a stock entry (never written directly)." },
  { key: "unit_cost", header: "Unit cost", required: false, aliases: ["cost", "cost price", "purchase price"], help: "Required when there is initial stock; not allowed without it." },
];

export const HEADER_LABELS: Record<ColumnKey, string> = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header])) as Record<
  ColumnKey,
  string
>;

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^﻿/, "") // UTF-8 BOM some tools add to CSV files
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP = new Map<string, ColumnKey>();
for (const column of COLUMNS) {
  for (const name of [column.key, column.header, ...column.aliases]) LOOKUP.set(normalizeHeader(name), column.key);
}

export type HeaderMapping = {
  /** Column key -> index in the row. */
  indexes: Partial<Record<ColumnKey, number>>;
  missing: ColumnKey[];
  /** Headers we don't recognize (ignored, reported as a warning). */
  unknown: string[];
  /** Columns that appear more than once. */
  duplicated: ColumnKey[];
};

export function mapHeaders(headerRow: unknown[]): HeaderMapping {
  const indexes: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  const duplicated: ColumnKey[] = [];
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const key = LOOKUP.get(normalized);
    if (!key) {
      unknown.push(String(cell).trim());
    } else if (indexes[key] !== undefined) {
      if (!duplicated.includes(key)) duplicated.push(key);
    } else {
      indexes[key] = index;
    }
  });
  const missing = COLUMNS.filter((c) => c.required && indexes[c.key] === undefined).map((c) => c.key);
  return { indexes, missing, unknown, duplicated };
}
