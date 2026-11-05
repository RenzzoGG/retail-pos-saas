import * as XLSX from "xlsx";
import { type ColumnKey, HEADER_LABELS, mapHeaders } from "./columns";
import { MAX_DATA_ROWS, MAX_FILE_BYTES } from "./limits";
import { checkZipDeclaredSize } from "./zip";

/** A cell as read from the file: text, number, boolean or empty. */
export type RawCell = string | number | boolean | null;

export type RawRow = {
  /** Row number as the user sees it in Excel (1 = first row). */
  rowNumber: number;
  values: Record<ColumnKey, RawCell>;
};

export type ParsedFile = {
  format: "xlsx" | "csv";
  rows: RawRow[];
  /** Headers we didn't recognize (ignored). */
  unknownColumns: string[];
};

export type ParseResult = { ok: true; data: ParsedFile } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

function detectFormat(fileName: string, bytes: Uint8Array): "xlsx" | "csv" | "invalid" {
  const name = fileName.toLowerCase();
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (name.endsWith(".xlsx")) return isZip ? "xlsx" : "invalid";
  if (name.endsWith(".csv")) {
    // A CSV is text: no ZIP signature and no NUL bytes at the start.
    if (isZip || bytes.subarray(0, 1024).includes(0)) return "invalid";
    return "csv";
  }
  return "invalid";
}

/**
 * Reads an uploaded .xlsx/.csv as UNTRUSTED data: checks size, type and (for
 * .xlsx) the ZIP's declared uncompressed size before parsing; parses only the
 * first sheet, without formulas, styles, HTML or macros, and stops after the
 * row limit. Nothing is written to disk.
 */
export function parseImportFile(fileName: string, bytes: Uint8Array): ParseResult {
  if (bytes.length === 0) return fail("The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) return fail("The file is larger than 1 MB. Split it into smaller files.");

  const format = detectFormat(fileName, bytes);
  if (format === "invalid") return fail("Upload an Excel (.xlsx) or CSV (.csv) file.");

  if (format === "xlsx") {
    const zip = checkZipDeclaredSize(bytes);
    if (!zip.ok) {
      return fail(
        zip.reason === "too_large_uncompressed" || zip.reason === "too_many_entries"
          ? "This Excel file is too large once uncompressed. Save only the product list and try again."
          : "We couldn't read this Excel file. Save it again as .xlsx and retry.",
      );
    }
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      dense: true,
      // +2: header row and one extra row to detect files over the limit.
      sheetRows: MAX_DATA_ROWS + 2,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      cellDates: false,
      bookVBA: false,
      bookFiles: false,
      // CSV: keep every value as typed (e.g. barcode "0012" must not become 12).
      raw: format === "csv",
      codepage: 65001,
    });
  } catch {
    return fail("We couldn't read this file. Make sure it's a valid .xlsx or .csv file.");
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet || !sheet["!ref"]) return fail("The file has no data.");

  const firstRow = XLSX.utils.decode_range(sheet["!ref"]).s.r; // 0-based
  const table = XLSX.utils.sheet_to_json<RawCell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });

  const isBlank = (cells: RawCell[] | undefined) =>
    !cells || cells.every((c) => c === null || (typeof c === "string" && c.trim() === ""));
  const headerIndex = table.findIndex((r) => !isBlank(r));
  if (headerIndex < 0) return fail("The file has no data.");

  const mapping = mapHeaders(table[headerIndex] ?? []);
  if (mapping.missing.length > 0) {
    return fail(
      `Missing required column${mapping.missing.length > 1 ? "s" : ""}: ${mapping.missing.map((k) => HEADER_LABELS[k]).join(", ")}. Download the template to see the expected columns.`,
    );
  }
  if (mapping.duplicated.length > 0) {
    return fail(`These columns appear more than once: ${mapping.duplicated.map((k) => HEADER_LABELS[k]).join(", ")}.`);
  }

  const rows: RawRow[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    const values = {} as Record<ColumnKey, RawCell>;
    let empty = true;
    for (const [key, index] of Object.entries(mapping.indexes) as [ColumnKey, number][]) {
      let cell = cells[index] ?? null;
      if (typeof cell === "string") cell = cell.trim() === "" ? null : cell.trim();
      values[key] = cell;
      if (cell !== null) empty = false;
    }
    if (empty) continue; // blank rows are skipped, not reported
    if (rows.length === MAX_DATA_ROWS) {
      return fail(`The file has more than ${MAX_DATA_ROWS.toLocaleString("en-US")} products. Split it into smaller files.`);
    }
    rows.push({ rowNumber: firstRow + i + 1, values });
  }
  if (rows.length === 0) return fail("The file has headers but no products.");

  return { ok: true, data: { format, rows, unknownColumns: mapping.unknown } };
}

/** Template with the expected headers and one example row (column B/C as text in .xlsx). */
export function buildTemplate(format: "xlsx" | "csv"): Uint8Array {
  const headers = ["Name", "SKU", "Barcode", "Category", "Sale price", "Low stock threshold", "Initial stock", "Unit cost"];
  const example = ["Example USB-C Cable 1 m", "EXAMPLE-CABLE-1M", "0012345678905", "Cables", 9.99, 5, 20, 3.2];
  const sheet = XLSX.utils.aoa_to_sheet([headers, example]);
  // Keep SKU and barcode as text so Excel doesn't drop leading zeros or use scientific notation.
  for (const ref of ["B2", "C2"]) {
    const cell = sheet[ref];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }
  sheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 11 }, { wch: 20 }, { wch: 13 }, { wch: 10 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  const out = XLSX.write(book, { type: "array", bookType: format === "xlsx" ? "xlsx" : "csv" }) as ArrayBuffer | string;
  return typeof out === "string" ? new TextEncoder().encode(out) : new Uint8Array(out);
}
