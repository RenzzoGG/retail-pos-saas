import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { type ExportData, buildSalesWorkbook, excelLocalDate, exportFileName } from "@/features/reports/export";
import { safeText } from "@/lib/spreadsheet-safe";

const summary = {
  salesCount: 1, unitsSold: 2, grossSales: 22, discounts: 0, tax: 1, avgTicket: 22, returnsCount: 1, unitsReturned: 1,
  refunds: 11, netSales: 11, costOfSales: 8, restockedCost: 4, writeOffUnits: 0, writeOffCost: 0, profit: 6,
};
const data: ExportData = {
  summary,
  sales: [{
    number: 7, createdAt: "2026-11-05T20:00:00Z", cashierName: "@cashier", customerName: "=HYPERLINK(\"http://x.test\",\"Click\")",
    status: "partially_returned", units: 2, itemsSubtotal: 20, lineDiscounts: 0, saleDiscount: 0, tax: 2, total: 22,
    refunded: 11, net: 11, paymentMethods: "Cash", cost: 8, profit: 6,
  }],
  lines: [{
    saleNumber: 7, createdAt: "2026-11-05T20:00:00Z", sku: "CBL-1", productName: "+1 Cable", category: null, quantity: 2,
    unitPrice: 10, discount: 0, lineTotal: 20, returnedQty: 1, writtenOffQty: 0, unitCost: 4,
  }],
};

describe("sales export (xlsx)", () => {
  it("formula-like text is prefixed; normal text untouched", () => {
    expect(safeText("=1+1")).toBe("'=1+1");
    expect(safeText("-5")).toBe("'-5");
    expect(safeText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeText("\tx")).toBe("'\tx");
    expect(safeText("Jordan Rivera")).toBe("Jordan Rivera");
  });

  it("builds Summary, Sales and Items with typed cells and no formulas", () => {
    const bytes = buildSalesWorkbook(
      { storeName: "Demo", timeZone: "America/New_York", currency: "USD", range: { fromDate: "2026-11-01", toDate: "2026-11-05" }, generatedAt: new Date("2026-11-05T21:00:00Z") },
      data,
    );
    const book = XLSX.read(bytes, { type: "array", cellFormula: true, bookFiles: true });
    expect(book.SheetNames).toEqual(["Summary", "Sales", "Items"]);
    const sales = book.Sheets.Sales!;
    expect(sales.A2).toMatchObject({ t: "n", v: 7 });
    expect(sales.D2).toMatchObject({ t: "s", v: "'=HYPERLINK(\"http://x.test\",\"Click\")" });
    expect(sales.C2).toMatchObject({ t: "s", v: "'@cashier" });
    expect(sales.E2).toMatchObject({ t: "s", v: "Partially returned" });
    expect(sales.P2).toMatchObject({ t: "n", v: 6 });
    expect(book.Sheets.Items!.D2).toMatchObject({ t: "s", v: "'+1 Cable" });
    for (const name of book.SheetNames) {
      const ws = book.Sheets[name]!;
      expect(Object.keys(ws).filter((k) => !k.startsWith("!") && (ws[k] as XLSX.CellObject).f)).toEqual([]);
    }
    // And no <f> element anywhere in the sheet XML.
    const files = (book as unknown as { files: Record<string, { content?: Uint8Array; _data?: unknown }> }).files ?? {};
    const xml = Object.entries(files)
      .filter(([path]) => path.startsWith("xl/worksheets/"))
      .map(([, f]) => (f.content ? new TextDecoder().decode(f.content) : ""))
      .join("");
    expect(xml).toContain("HYPERLINK"); // the XML was really read
    expect(xml).not.toMatch(/<f[ >]/);
  });

  it("dates are the store's local wall-clock time", () => {
    const cell = excelLocalDate("2026-11-05T20:00:00Z", "America/New_York"); // 15:00 EST
    const parsed = XLSX.SSF.parse_date_code((cell as XLSX.CellObject).v as number);
    expect([parsed.y, parsed.m, parsed.d, parsed.H, parsed.M]).toEqual([2026, 11, 5, 15, 0]);
    const summer = XLSX.SSF.parse_date_code((excelLocalDate("2026-07-01T16:30:00Z", "America/New_York") as XLSX.CellObject).v as number);
    expect([summer.H, summer.M]).toEqual([12, 30]); // EDT
  });

  it("file name has the range", () => {
    expect(exportFileName({ fromDate: "2026-11-01", toDate: "2026-11-05" })).toBe("stocktill-sales-2026-11-01_2026-11-05.xlsx");
  });
});
