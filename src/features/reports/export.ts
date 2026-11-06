import * as XLSX from "xlsx";
import { STATUS_LABELS } from "@/features/pos/labels";
import { isManager, type StoreRole } from "@/lib/permissions";
import { type Db, type Result, fail, forbidden, ok } from "@/lib/services/result";
import { safeText } from "@/lib/spreadsheet-safe";
import type { DateRange } from "./ranges";
import { type Summary, getSummary } from "./service";

/** Most sales per file (the file is built in memory on the server). */
export const MAX_EXPORT_SALES = 50_000;
const PAGE = 1000; // PostgREST returns at most 1,000 rows per request (max_rows)

export type ExportSale = {
  number: number;
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  status: keyof typeof STATUS_LABELS;
  units: number;
  itemsSubtotal: number;
  lineDiscounts: number;
  saleDiscount: number;
  tax: number;
  total: number;
  refunded: number;
  net: number;
  paymentMethods: string | null;
  cost: number;
  profit: number;
};

export type ExportLine = {
  saleNumber: number;
  createdAt: string;
  sku: string;
  productName: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  returnedQty: number;
  writtenOffQty: number;
  unitCost: number | null;
};

export type ExportData = { summary: Summary; sales: ExportSale[]; lines: ExportLine[] };

const num = (v: unknown) => Number(v ?? 0);

/** Loads everything for the file, 1,000 rows per request, as the user (RLS + role check in SQL). */
export async function loadExport(db: Db, actor: { storeId: string; role: StoreRole }, range: DateRange): Promise<Result<ExportData>> {
  if (!isManager(actor.role)) return forbidden();
  const args = { p_store_id: actor.storeId, p_from: range.from.toISOString(), p_to: range.to.toISOString() };

  const summary = await getSummary(db, actor, range);
  if (!summary.ok) return summary;
  if (summary.data.salesCount > MAX_EXPORT_SALES) {
    return { ok: false, error: `This range has more than ${MAX_EXPORT_SALES.toLocaleString("en-US")} sales. Choose a shorter range.`, code: "too_many_rows" };
  }

  const sales: ExportSale[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.rpc("report_sales_export", args).range(offset, offset + PAGE - 1);
    if (error) return fail(error);
    for (const r of data ?? []) {
      sales.push({
        number: r.number,
        createdAt: r.created_at,
        cashierName: r.cashier_name,
        customerName: r.customer_name,
        status: r.status,
        units: num(r.units),
        itemsSubtotal: num(r.items_subtotal),
        lineDiscounts: num(r.line_discounts),
        saleDiscount: num(r.sale_discount),
        tax: num(r.tax),
        total: num(r.total),
        refunded: num(r.refunded),
        net: num(r.net),
        paymentMethods: r.payment_methods,
        cost: num(r.cost),
        profit: num(r.profit),
      });
    }
    if ((data ?? []).length < PAGE) break;
  }

  const lines: ExportLine[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.rpc("report_sale_lines_export", args).range(offset, offset + PAGE - 1);
    if (error) return fail(error);
    for (const r of data ?? []) {
      lines.push({
        saleNumber: r.sale_number,
        createdAt: r.created_at,
        sku: r.sku,
        productName: r.product_name,
        category: r.category,
        quantity: num(r.quantity),
        unitPrice: num(r.unit_price),
        discount: num(r.discount),
        lineTotal: num(r.line_total),
        returnedQty: num(r.returned_qty),
        writtenOffQty: num(r.written_off_qty),
        unitCost: r.unit_cost === null ? null : num(r.unit_cost),
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return ok({ summary: summary.data, sales, lines });
}

// ----------------------------------------------------------------- workbook

type Cell = XLSX.CellObject | null;
const MONEY = "#,##0.00";
const DATE_TIME = "yyyy-mm-dd hh:mm";

/** Text cells are always type "s" (never a formula) and formula-like text gets an apostrophe. */
const text = (v: string | null | undefined): Cell => (v === null || v === undefined || v === "" ? null : { t: "s", v: safeText(v) });
const int = (v: number): Cell => ({ t: "n", v });
const money = (v: number | null): Cell => (v === null ? null : { t: "n", v, z: MONEY });

/** Local wall-clock time in the store's time zone as an Excel date serial (Excel dates have no time zone). */
export function excelLocalDate(iso: string, timeZone: string): Cell {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return { t: "n", v: localMs / 86_400_000 + 25_569, z: DATE_TIME };
}

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows as unknown as XLSX.CellObject[][]);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

export type WorkbookMeta = { storeName: string; timeZone: string; currency: string; range: Pick<DateRange, "fromDate" | "toDate">; generatedAt: Date };

/** Summary + Sales (one row per sale) + Items (one row per line). Owner/admin only: it has costs. */
export function buildSalesWorkbook(meta: WorkbookMeta, data: ExportData): Uint8Array {
  const s = data.summary;
  const header = (labels: string[]): Cell[] => labels.map((l) => ({ t: "s", v: l }));

  const summary = sheet(
    [
      [text("Stocktill sales export")],
      [text("Store"), text(meta.storeName)],
      [text("Period"), text(`${meta.range.fromDate} to ${meta.range.toDate}`)],
      [text("Time zone"), text(meta.timeZone)],
      [text("Currency"), text(meta.currency)],
      [text("Generated"), excelLocalDate(meta.generatedAt.toISOString(), meta.timeZone)],
      [],
      [text("Sales"), int(s.salesCount)],
      [text("Units sold"), int(s.unitsSold)],
      [text("Gross sales"), money(s.grossSales)],
      [text("Discounts"), money(s.discounts)],
      [text("Returns"), int(s.returnsCount)],
      [text("Refunds"), money(s.refunds)],
      [text("Net sales"), money(s.netSales)],
      [text("Tax (net of refunds)"), money(s.tax)],
      [text("Cost of sales"), money(s.costOfSales)],
      [text("Cost of restocked returns"), money(s.restockedCost)],
      [text("Write-offs (units)"), int(s.writeOffUnits)],
      [text("Write-offs (cost)"), money(s.writeOffCost)],
      [text("Gross profit"), money(s.profit)],
      [],
      [text("Returns count on the day they were made. Gross profit is net of returns and counts write-offs as a loss.")],
      [text("Sales sheet: sales made in the period, with refunds to date and profit after returns.")],
    ],
    [28, 24],
  );

  const sales = sheet(
    [
      header(["Sale #", "Date", "Cashier", "Customer", "Status", "Units", "Items subtotal", "Line discounts", "Sale discount", "Tax", "Total", "Refunded", "Net", "Payment methods", "Cost", "Profit"]),
      ...data.sales.map((r) => [
        int(r.number),
        excelLocalDate(r.createdAt, meta.timeZone),
        text(r.cashierName),
        text(r.customerName),
        text(STATUS_LABELS[r.status]),
        int(r.units),
        money(r.itemsSubtotal),
        money(r.lineDiscounts),
        money(r.saleDiscount),
        money(r.tax),
        money(r.total),
        money(r.refunded),
        money(r.net),
        text(r.paymentMethods),
        money(r.cost),
        money(r.profit),
      ]),
    ],
    [8, 17, 18, 22, 18, 7, 13, 13, 13, 10, 11, 11, 11, 18, 11, 11],
  );

  const items = sheet(
    [
      header(["Sale #", "Date", "SKU", "Product", "Category", "Qty", "Unit price", "Discount", "Line total", "Returned", "Written off", "Unit cost"]),
      ...data.lines.map((r) => [
        int(r.saleNumber),
        excelLocalDate(r.createdAt, meta.timeZone),
        text(r.sku),
        text(r.productName),
        text(r.category),
        int(r.quantity),
        money(r.unitPrice),
        money(r.discount),
        money(r.lineTotal),
        int(r.returnedQty),
        int(r.writtenOffQty),
        money(r.unitCost),
      ]),
    ],
    [8, 17, 16, 34, 14, 6, 11, 10, 11, 9, 11, 10],
  );

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  XLSX.utils.book_append_sheet(book, sales, "Sales");
  XLSX.utils.book_append_sheet(book, items, "Items");
  const out = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

export const exportFileName = (range: Pick<DateRange, "fromDate" | "toDate">) => `stocktill-sales-${range.fromDate}_${range.toDate}.xlsx`;
