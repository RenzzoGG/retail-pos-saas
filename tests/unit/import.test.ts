import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { mapHeaders } from "@/features/import/columns";
import { buildErrorReport, csvCell } from "@/features/import/csv";
import { MAX_DATA_ROWS, MAX_FILE_BYTES } from "@/features/import/limits";
import { parseNumberCell, textCell } from "@/features/import/numbers";
import { buildTemplate, parseImportFile } from "@/features/import/parse";
import { type ExistingProduct, validateRows } from "@/features/import/validate";
import { checkZipDeclaredSize } from "@/features/import/zip";

const HEADERS = ["Name", "SKU", "Barcode", "Category", "Sale price", "Low stock threshold", "Initial stock", "Unit cost"];

function xlsx(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Products");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
const csv = (text: string) => new TextEncoder().encode(text);

function parseOk(name: string, bytes: Uint8Array) {
  const result = parseImportFile(name, bytes);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("numbers", () => {
  it.each([
    [12, 12],
    ["12", 12],
    [" 7 ", 7],
    ["$1,234.50", 1234.5],
    ["1.234,50", 1234.5],
    ["12,5", 12.5],
    ["1,234", 1234],
    ["1.234.567", 1234567],
    ["€9.99", 9.99],
    ["USD 12.50", 12.5],
    ["12.50 EUR", 12.5],
    ["+3", 3],
    ["-5", -5],
  ])("parses %j as %j", (input, expected) => {
    expect(parseNumberCell(input)).toBe(expected);
  });

  it("returns null for empty and NaN for text", () => {
    expect(parseNumberCell(null)).toBeNull();
    expect(parseNumberCell("  ")).toBeNull();
    expect(parseNumberCell("abc")).toBeNaN();
    expect(parseNumberCell("12a")).toBeNaN();
    expect(parseNumberCell(true)).toBeNaN();
  });

  it("keeps long numeric codes as plain digits", () => {
    expect(textCell(2000000000015)).toBe("2000000000015");
    expect(textCell(1e15)).toBe("1000000000000000");
    expect(textCell("  CBL-1 ")).toBe("CBL-1");
  });
});

describe("headers", () => {
  it("accepts any order, case, spacing and common aliases", () => {
    const m = mapHeaders(["  price ", "SKU", "product name", "Unit_Cost", "QTY", "notes"]);
    expect(m.indexes).toEqual({ sale_price: 0, sku: 1, name: 2, unit_cost: 3, initial_stock: 4 });
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["notes"]);
  });

  it("reports missing and duplicated columns", () => {
    expect(mapHeaders(["Name", "Category"]).missing).toEqual(["sku", "sale_price"]);
    expect(mapHeaders(["Name", "SKU", "Price", "Sale price"]).duplicated).toEqual(["sale_price"]);
  });
});

describe("parseImportFile", () => {
  it("reads .xlsx and .csv with the same result", () => {
    const rows = [HEADERS, ["Cable", "C-1", "0012345678905", "Cables", 9.99, 2, 10, 3.2]];
    const fromXlsx = parseOk("a.xlsx", xlsx(rows));
    const fromCsv = parseOk("a.csv", csv(`${HEADERS.join(",")}\nCable,C-1,0012345678905,Cables,9.99,2,10,3.2\n`));
    expect(fromXlsx.rows[0]?.values.sku).toBe("C-1");
    expect(fromCsv.rows[0]?.values.barcode).toBe("0012345678905"); // CSV keeps leading zeros
    expect(fromCsv.rows[0]?.rowNumber).toBe(2);
  });

  it("skips blank rows but keeps the spreadsheet row numbers", () => {
    const data = parseOk("a.csv", csv(`Name,SKU,Sale price\n\nCable,C-1,1\n,,\nCase,C-2,2\n`));
    expect(data.rows.map((r) => r.rowNumber)).toEqual([3, 5]);
  });

  it("accepts a header row that is not the first one and a UTF-8 BOM", () => {
    const data = parseOk("a.csv", csv(`﻿\n\nName,SKU,Price\nCable,C-1,1\n`));
    expect(data.rows).toHaveLength(1);
  });

  it("rejects empty, oversized, wrong-type and header-only files", () => {
    expect(parseImportFile("a.csv", new Uint8Array())).toMatchObject({ ok: false, error: "The file is empty." });
    expect(parseImportFile("a.csv", new Uint8Array(MAX_FILE_BYTES + 1).fill(65))).toMatchObject({ ok: false });
    expect(parseImportFile("a.pdf", csv("Name,SKU\n"))).toMatchObject({ ok: false, error: "Upload an Excel (.xlsx) or CSV (.csv) file." });
    expect(parseImportFile("a.xlsx", csv("Name,SKU,Price\nx,y,1"))).toMatchObject({ ok: false }); // not a ZIP
    expect(parseImportFile("a.csv", xlsx([HEADERS]))).toMatchObject({ ok: false }); // a ZIP renamed to .csv
    expect(parseImportFile("a.csv", csv("Name,SKU,Sale price\n"))).toMatchObject({ ok: false, error: "The file has headers but no products." });
    expect(parseImportFile("a.csv", csv("\n\n"))).toMatchObject({ ok: false, error: "The file has no data." });
  });

  it("explains missing required columns", () => {
    const result = parseImportFile("a.csv", csv("Name,Category\nCable,Cables\n"));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("Missing required columns: SKU, Sale price");
  });

  it(`rejects more than ${MAX_DATA_ROWS} products`, () => {
    const lines = ["Name,SKU,Sale price", ...Array.from({ length: MAX_DATA_ROWS + 1 }, (_, i) => `P${i},S-${i},1`)];
    const result = parseImportFile("big.csv", csv(lines.join("\n")));
    expect(!result.ok && result.error).toContain("more than 2,000 products");
    const exact = parseImportFile("ok.csv", csv(lines.slice(0, MAX_DATA_ROWS + 1).join("\n")));
    expect(exact.ok && exact.data.rows).toHaveLength(MAX_DATA_ROWS);
  });

  it("produces a template the parser itself reads", () => {
    for (const format of ["xlsx", "csv"] as const) {
      const data = parseOk(`template.${format}`, buildTemplate(format));
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0]?.values).toMatchObject({ sku: "EXAMPLE-CABLE-1M", barcode: "0012345678905" });
      expect(data.unknownColumns).toEqual([]);
    }
  });
});

describe("zip bomb protection", () => {
  it("accepts a normal workbook", () => {
    expect(checkZipDeclaredSize(xlsx([HEADERS]))).toMatchObject({ ok: true });
  });

  it("rejects archives that declare a huge uncompressed size", () => {
    const bytes = xlsx([HEADERS]);
    const view = new DataView(bytes.buffer);
    // Find the first central directory header and inflate its declared size.
    let i = bytes.length - 22;
    while (view.getUint32(i, true) !== 0x06054b50) i--;
    const dir = view.getUint32(i + 16, true);
    view.setUint32(dir + 24, 500 * 1024 * 1024, true);
    expect(checkZipDeclaredSize(bytes)).toEqual({ ok: false, reason: "too_large_uncompressed" });
    expect(parseImportFile("bomb.xlsx", bytes)).toMatchObject({ ok: false });
  });

  it("rejects bytes that are not a ZIP", () => {
    expect(checkZipDeclaredSize(csv("hello"))).toMatchObject({ ok: false, reason: "not_a_zip" });
  });
});

describe("validateRows", () => {
  const existing: ExistingProduct[] = [
    { id: "p1", sku: "OLD-1", barcode: "1111111111111", name: "Old cable", category: "Cables", salePrice: 5, lowStockThreshold: 1 },
  ];
  const rowsFrom = (text: string) => parseOk("t.csv", csv(text)).rows;

  it("marks new rows, normalizes values and needs a cost only with stock", () => {
    const { rows, summary } = validateRows(
      rowsFrom(`Name,SKU,Sale price,Initial stock,Unit cost\nCable,NEW-1,"$1,234.50",10,"3,20"\nCase,NEW-2,9.99,,\n`),
      existing,
      { updateExisting: false },
    );
    expect(summary).toEqual({ total: 2, new: 2, update: 0, error: 0 });
    expect(rows[0]?.data).toEqual({
      name: "Cable",
      sku: "NEW-1",
      barcode: null,
      category: null,
      sale_price: 1234.5,
      low_stock_threshold: 0,
      initial_stock: 10,
      unit_cost: 3.2,
    });
    expect(rows[1]?.data?.initial_stock).toBe(0);
  });

  it("reports errors per column with clear messages", () => {
    const { rows } = validateRows(
      rowsFrom(
        [
          "Name,SKU,Barcode,Sale price,Low stock threshold,Initial stock,Unit cost",
          ",A 1,12,abc,-1,2.5,",
          "Ok,OK-1,,9.999,,5,",
          "Cost only,OK-2,,1,,,2",
        ].join("\n"),
      ),
      existing,
      { updateExisting: false },
    );
    const messages = (i: number) => rows[i]?.errors.map((e) => `${e.column}: ${e.message}`);
    expect(messages(0)).toEqual([
      "name: Name is required.",
      "sku: SKU must start with a letter or digit and can't contain spaces.",
      "barcode: Barcode must be 4–64 letters, digits or dashes.",
      "sale_price: Sale price must be a number.",
      "low_stock_threshold: Low stock threshold can't be negative.",
      "initial_stock: Initial stock must be a whole number.",
    ]);
    expect(messages(1)).toEqual([
      "sale_price: Sale price can have at most 2 decimals.",
      "unit_cost: Unit cost is required when there is initial stock.",
    ]);
    expect(messages(2)).toEqual(["unit_cost: Unit cost needs an initial stock: costs come only from stock entries."]);
    expect(rows.every((r) => r.status === "error" && r.data === null)).toBe(true);
  });

  it("rejects SKUs that look like spreadsheet formulas", () => {
    const { rows } = validateRows(rowsFrom("Name,SKU,Sale price\nX,=1+1,1\nY,@cmd,1\nZ,-5,1\nOk,9-OK,1\n"), [], { updateExisting: false });
    expect(rows.map((r) => r.status)).toEqual(["error", "error", "error", "new"]);
  });

  it("flags duplicates inside the file on every involved row", () => {
    const { rows, summary } = validateRows(
      rowsFrom("Name,SKU,Barcode,Sale price\nA,DUP,2222222222222,1\nB,DUP,3333333333333,1\nC,UNIQUE,2222222222222,1\n"),
      existing,
      { updateExisting: false },
    );
    expect(summary.error).toBe(3);
    expect(rows[0]?.errors.map((e) => e.message)).toEqual([
      "Duplicate SKU in this file (rows 2, 3).",
      "Duplicate barcode in this file (rows 2, 4).",
    ]);
  });

  it("existing SKUs: error by default, update when the option is on", () => {
    const text = "Name,SKU,Barcode,Category,Sale price,Initial stock,Unit cost\nNew name,OLD-1,1111111111111,Cables,6.5,4,2\n";
    const off = validateRows(rowsFrom(text), existing, { updateExisting: false });
    expect(off.rows[0]?.errors[0]?.message).toContain("already exists");
    const on = validateRows(rowsFrom(text), existing, { updateExisting: true });
    expect(on.summary).toEqual({ total: 1, new: 0, update: 1, error: 0 });
    expect(on.rows[0]?.changes).toEqual(["Name: Old cable → New name", "Sale price: 5.00 → 6.50", "Stock: +4 at 2.00 each"]);
  });

  it("when updating, empty optional cells keep the current values", () => {
    const { rows } = validateRows(rowsFrom("Name,SKU,Sale price\nOld cable,OLD-1,7\n"), existing, { updateExisting: true });
    expect(rows[0]?.data).toMatchObject({ barcode: "1111111111111", category: "Cables", low_stock_threshold: 1, sale_price: 7 });
    expect(rows[0]?.changes).toEqual(["Sale price: 5.00 → 7.00"]);
  });

  it("rejects a barcode that belongs to another existing product", () => {
    const { rows } = validateRows(rowsFrom("Name,SKU,Barcode,Sale price\nX,NEW-9,1111111111111,1\n"), existing, { updateExisting: true });
    expect(rows[0]?.errors[0]?.message).toBe("Barcode already used by “Old cable” (SKU OLD-1).");
  });
});

describe("error report CSV", () => {
  it("neutralizes formulas and escapes separators", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("contains only rejected rows, their values and reasons", () => {
    const { rows } = validateRows(
      parseOk("t.csv", csv("Name,SKU,Sale price\nGood,G-1,1\n=cmd,B-1,-3\n")).rows,
      [],
      { updateExisting: false },
    );
    const report = buildErrorReport(rows);
    const lines = report.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Row,Name,SKU,Barcode,Category,Sale price,Low stock threshold,Initial stock,Unit cost,Errors");
    expect(lines[1]).toBe("3,'=cmd,B-1,,,'-3,,,,Sale price: Sale price can't be negative.");
  });
});
