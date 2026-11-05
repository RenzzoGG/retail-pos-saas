import { COLUMN_KEYS, type ColumnKey, HEADER_LABELS } from "./columns";
import { parseNumberCell, textCell } from "./numbers";
import type { RawRow } from "./parse";

/** What the database function receives for a valid row (snake_case on purpose). */
export type ImportRowData = {
  name: string;
  sku: string;
  barcode: string | null;
  category: string | null;
  sale_price: number;
  low_stock_threshold: number;
  initial_stock: number;
  unit_cost: number | null;
};

export type RowStatus = "new" | "update" | "error";
export type CellError = { column: ColumnKey | null; message: string };

export type ValidatedRow = {
  rowNumber: number;
  status: RowStatus;
  /** Values as text, for the preview table and the error report. */
  display: Record<ColumnKey, string>;
  errors: CellError[];
  /** For updates: what would change ("Sale price: 9.99 → 12.50"). */
  changes: string[];
  data: ImportRowData | null;
};

export type ExistingProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  salePrice: number;
  lowStockThreshold: number;
};

export type ImportSummary = { total: number; new: number; update: number; error: number };

const MAX_MONEY = 99_999_999.99;
const MAX_INT = 1_000_000;

function hasTwoDecimalsAtMost(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function display(value: unknown): string {
  return textCell(value);
}

/**
 * Validates every row on its own and against the rest of the file and the
 * store's existing products. Pure function: the same input always gives the
 * same preview, which is what the confirm step relies on.
 */
export function validateRows(
  rows: RawRow[],
  existing: ExistingProduct[],
  options: { updateExisting: boolean },
): { rows: ValidatedRow[]; summary: ImportSummary } {
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode as string, p]));

  // Occurrences inside the file, to report duplicates on every involved row.
  const skuRows = new Map<string, number[]>();
  const barcodeRows = new Map<string, number[]>();
  for (const row of rows) {
    const sku = textCell(row.values.sku);
    const barcode = textCell(row.values.barcode);
    if (sku) skuRows.set(sku, [...(skuRows.get(sku) ?? []), row.rowNumber]);
    if (barcode) barcodeRows.set(barcode, [...(barcodeRows.get(barcode) ?? []), row.rowNumber]);
  }

  const result = rows.map((row): ValidatedRow => {
    const v = row.values;
    const errors: CellError[] = [];
    const add = (column: ColumnKey | null, message: string) => errors.push({ column, message });
    const shown = Object.fromEntries(COLUMN_KEYS.map((k) => [k, display(v[k] ?? null)])) as Record<ColumnKey, string>;

    const name = textCell(v.name);
    if (!name) add("name", "Name is required.");
    else if (name.length > 120) add("name", "Name is longer than 120 characters.");

    const sku = textCell(v.sku);
    if (!sku) add("sku", "SKU is required.");
    else if (sku.length > 64) add("sku", "SKU is longer than 64 characters.");
    else if (!/^[A-Za-z0-9]\S*$/.test(sku)) add("sku", "SKU must start with a letter or digit and can't contain spaces.");

    const barcode = textCell(v.barcode) || null;
    if (typeof v.barcode === "number" && !Number.isInteger(v.barcode)) {
      add("barcode", "Barcode looks like a decimal number. Format the column as text.");
    } else if (barcode && !/^[0-9A-Za-z-]{4,64}$/.test(barcode)) {
      add("barcode", "Barcode must be 4–64 letters, digits or dashes.");
    }

    const category = textCell(v.category) || null;
    if (category && category.length > 60) add("category", "Category is longer than 60 characters.");

    const money = (key: "sale_price" | "unit_cost", label: string, required: boolean): number | null => {
      const n = parseNumberCell(v[key]);
      if (n === null) {
        if (required) add(key, `${label} is required.`);
        return null;
      }
      if (Number.isNaN(n)) add(key, `${label} must be a number.`);
      else if (n < 0) add(key, `${label} can't be negative.`);
      else if (n > MAX_MONEY) add(key, `${label} is too large.`);
      else if (!hasTwoDecimalsAtMost(n)) add(key, `${label} can have at most 2 decimals.`);
      else return Math.round(n * 100) / 100;
      return null;
    };
    const wholeNumber = (key: "low_stock_threshold" | "initial_stock", label: string): number | null => {
      const n = parseNumberCell(v[key]);
      if (n === null) return 0;
      if (Number.isNaN(n)) add(key, `${label} must be a number.`);
      else if (!Number.isInteger(n)) add(key, `${label} must be a whole number.`);
      else if (n < 0) add(key, `${label} can't be negative.`);
      else if (n > MAX_INT) add(key, `${label} is too large.`);
      else return n;
      return null;
    };

    const salePrice = money("sale_price", "Sale price", true);
    const threshold = wholeNumber("low_stock_threshold", "Low stock threshold");
    const stock = wholeNumber("initial_stock", "Initial stock");
    const unitCost = money("unit_cost", "Unit cost", false);
    if (stock !== null && stock > 0 && unitCost === null && !errors.some((e) => e.column === "unit_cost")) {
      add("unit_cost", "Unit cost is required when there is initial stock.");
    }
    if ((stock === 0 || stock === null) && unitCost !== null && !errors.some((e) => e.column === "initial_stock")) {
      add("unit_cost", "Unit cost needs an initial stock: costs come only from stock entries.");
    }

    // Duplicates inside the file.
    const skuDupes = sku ? (skuRows.get(sku) ?? []) : [];
    if (skuDupes.length > 1) add("sku", `Duplicate SKU in this file (rows ${skuDupes.join(", ")}).`);
    const barcodeDupes = barcode ? (barcodeRows.get(barcode) ?? []) : [];
    if (barcodeDupes.length > 1) add("barcode", `Duplicate barcode in this file (rows ${barcodeDupes.join(", ")}).`);

    // Against the store's products.
    const match = sku ? bySku.get(sku) : undefined;
    if (match && !options.updateExisting) {
      add("sku", "A product with this SKU already exists. Turn on “Update existing products” to update it.");
    }
    const barcodeOwner = barcode ? byBarcode.get(barcode) : undefined;
    if (barcodeOwner && barcodeOwner.sku !== sku) {
      add("barcode", `Barcode already used by “${barcodeOwner.name}” (SKU ${barcodeOwner.sku}).`);
    }

    if (errors.length > 0) {
      return { rowNumber: row.rowNumber, status: "error", display: shown, errors, changes: [], data: null };
    }

    // Updating: an empty optional cell (or a missing column) keeps the current
    // value, so a short file (SKU, name, price) never wipes other fields.
    const provided = (key: ColumnKey) => v[key] !== null && v[key] !== undefined;
    const data: ImportRowData = {
      name,
      sku,
      barcode: match && !provided("barcode") ? match.barcode : barcode,
      category: match && !provided("category") ? match.category : category,
      sale_price: salePrice as number,
      low_stock_threshold: match && !provided("low_stock_threshold") ? match.lowStockThreshold : (threshold as number),
      initial_stock: stock as number,
      unit_cost: unitCost,
    };

    const changes: string[] = [];
    if (match) {
      const diff = (label: string, before: string, after: string) => {
        if (before !== after) changes.push(`${label}: ${before || "—"} → ${after || "—"}`);
      };
      diff(HEADER_LABELS.name, match.name, data.name);
      diff(HEADER_LABELS.barcode, match.barcode ?? "", data.barcode ?? "");
      diff(HEADER_LABELS.category, match.category ?? "", data.category ?? "");
      diff(HEADER_LABELS.sale_price, match.salePrice.toFixed(2), data.sale_price.toFixed(2));
      diff(HEADER_LABELS.low_stock_threshold, String(match.lowStockThreshold), String(data.low_stock_threshold));
    }
    if (data.initial_stock > 0) changes.push(`Stock: +${data.initial_stock} at ${(data.unit_cost as number).toFixed(2)} each`);
    if (!match && changes.length === 0) changes.push("New product");

    return { rowNumber: row.rowNumber, status: match ? "update" : "new", display: shown, errors: [], changes, data };
  });

  const summary: ImportSummary = {
    total: result.length,
    new: result.filter((r) => r.status === "new").length,
    update: result.filter((r) => r.status === "update").length,
    error: result.filter((r) => r.status === "error").length,
  };
  return { rows: result, summary };
}
