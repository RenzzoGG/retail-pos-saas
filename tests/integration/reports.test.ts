import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/features/customers/service";
import { createProduct, createStockEntry } from "@/features/inventory/service";
import { completeSale, getSale } from "@/features/pos/service";
import { buildSalesWorkbook, loadExport } from "@/features/reports/export";
import { lastDays, resolveRange } from "@/features/reports/ranges";
import { getPaymentMethods, getSummary, getTimeseries, getToday, type Summary } from "@/features/reports/service";
import { createReturn } from "@/features/returns/service";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, actor, signInAs } from "./helpers";

const TZ = "America/New_York"; // the demo store
const run = String(Date.now()).slice(-8);
const OWNER = { storeId: DEMO_STORE_ID, role: "owner" as const };
const CASHIER = { storeId: DEMO_STORE_ID, role: "cashier" as const };
const cents = (n: unknown) => Math.round(Number(n) * 100);
type Cost = { unit_cost: number } | { unit_cost: number }[] | null | undefined;
/** One-to-one embeds may come back as an object or a one-element array. */
const unitCost = (c: Cost) => cents((Array.isArray(c) ? c[0] : c)?.unit_cost ?? 0);

/** Every row of a query, 1,000 at a time (PostgREST's max_rows). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}

describe("reports", () => {
  let owner: Db;
  let cashier: Db;
  let otherOwner: Db;

  beforeAll(async () => {
    [owner, cashier, otherOwner] = await Promise.all([signInAs("owner"), signInAs("cashier"), signInAs("otherOwner")]);
  });

  afterAll(async () => {
    await owner.from("products").update({ deleted_at: new Date().toISOString() }).eq("store_id", DEMO_STORE_ID).like("sku", `REP-${run}%`);
  });

  it("the summary equals the sums of the raw sales, returns and write-offs (60 days of seed data)", async () => {
    const range = lastDays(70, TZ);
    const [from, to] = [range.from.toISOString(), range.to.toISOString()];
    const summary = await getSummary(owner, OWNER, range);
    if (!summary.ok) throw new Error(summary.error);

    // Raw rows, read as the owner (RLS: own store only).
    const sales = await all<{ id: string; total: number; tax_total: number }>((a, b) =>
      owner.from("sales").select("id, total, tax_total").eq("store_id", DEMO_STORE_ID).gte("created_at", from).lt("created_at", to).order("id").range(a, b),
    );
    const saleIds = new Set(sales.map((s) => s.id));
    const items = await all<{ sale_id: string; quantity: number; sale_item_costs: Cost }>((a, b) =>
      owner.from("sale_items").select("sale_id, quantity, sale_item_costs(unit_cost)").eq("store_id", DEMO_STORE_ID).order("id").range(a, b),
    );
    const returns = await all<{ refund_total: number; sales: { total: number; tax_total: number } | null; return_items: { quantity: number; restocked: boolean; sale_items: { sale_item_costs: Cost } | null }[] }>((a, b) =>
      owner
        .from("returns")
        .select("refund_total, sales(total, tax_total), return_items(quantity, restocked, sale_items(sale_item_costs(unit_cost)))")
        .eq("store_id", DEMO_STORE_ID)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("id")
        .range(a, b),
    );
    expect(sales.length).toBeGreaterThan(200); // the seed's history is there
    expect(returns.length).toBeGreaterThan(5);

    const gross = sales.reduce((s, r) => s + cents(r.total), 0);
    const tax = sales.reduce((s, r) => s + cents(r.tax_total), 0);
    const cost = items.filter((i) => saleIds.has(i.sale_id)).reduce((s, i) => s + i.quantity * unitCost(i.sale_item_costs), 0);
    const refunds = returns.reduce((s, r) => s + cents(r.refund_total), 0);
    const refundTax = returns.reduce((s, r) => s + (r.sales && Number(r.sales.total) > 0 ? (cents(r.refund_total) * Number(r.sales.tax_total)) / Number(r.sales.total) : 0), 0);
    const lineCost = (ri: (typeof returns)[number]["return_items"][number]) => ri.quantity * unitCost(ri.sale_items?.sale_item_costs);
    const restocked = returns.flatMap((r) => r.return_items).filter((ri) => ri.restocked).reduce((s, ri) => s + lineCost(ri), 0);
    const writeOff = returns.flatMap((r) => r.return_items).filter((ri) => !ri.restocked).reduce((s, ri) => s + lineCost(ri), 0);

    const s: Summary = summary.data;
    expect(s.salesCount).toBe(sales.length);
    expect(cents(s.grossSales)).toBe(gross);
    expect(cents(s.refunds)).toBe(refunds);
    expect(cents(s.netSales)).toBe(gross - refunds);
    expect(cents(s.costOfSales)).toBe(cost);
    expect(cents(s.restockedCost)).toBe(restocked);
    expect(cents(s.writeOffCost)).toBe(writeOff);
    expect(writeOff).toBeGreaterThan(0); // the seed has write-offs
    expect(cents(s.profit)).toBe(Math.round(gross - tax - cost - (refunds - refundTax) + restocked));

    // Daily series and payment methods add up to the same totals.
    const series = await getTimeseries(owner, OWNER, range, "day");
    if (!series.ok) throw new Error(series.error);
    expect(series.data).toHaveLength(70);
    expect(series.data.reduce((a, r) => a + cents(r.grossSales), 0)).toBe(gross);
    expect(series.data.reduce((a, r) => a + cents(r.refunds), 0)).toBe(refunds);
    expect(Math.abs(series.data.reduce((a, r) => a + cents(r.profit), 0) - cents(s.profit))).toBeLessThanOrEqual(70); // ≤ ½ cent per day of rounding
    const methods = await getPaymentMethods(owner, OWNER, range);
    if (!methods.ok) throw new Error(methods.error);
    expect(methods.data.reduce((a, m) => a + cents(m.net), 0)).toBe(gross - refunds);
  });

  it("a sale with a discount and a write-off moves today's numbers by exactly its amounts; the Excel is valid and safe", async () => {
    const today = resolveRange({ preset: "today" }, TZ).range;
    const before = await getSummary(owner, OWNER, today);
    const todayBefore = await getToday(cashier, DEMO_STORE_ID);
    if (!before.ok || !todayBefore.ok) throw new Error("before");

    const product = await createProduct(owner, actor("owner", "owner"), { name: `Report test ${run}`, sku: `REP-${run}`, barcode: null, category: "Report tests", salePrice: 20, lowStockThreshold: 0, active: true });
    if (!product.ok) throw new Error(product.error);
    const entry = await createStockEntry(owner, actor("owner", "owner"), { supplier: null, note: null, lines: [{ productId: product.data, quantity: 5, unitCost: 6 }] });
    if (!entry.ok) throw new Error(entry.error);
    const evil = '=HYPERLINK("http://attacker.test","Click")';
    const customer = await createCustomer(cashier, actor("cashier", "cashier"), { name: evil, documentId: null, phone: null, email: null, notes: null });
    if (!customer.ok) throw new Error(customer.error);
    // 2 x 20.00 - 2.00 sale discount = 38.00 (tax included), by the cashier.
    const sale = await completeSale(cashier, actor("cashier", "cashier"), {
      idempotencyKey: randomUUID(),
      customerId: customer.data.id,
      items: [{ productId: product.data, name: "x", quantity: 2, discount: 0 }],
      saleDiscount: 2,
      payments: [{ method: "transfer", amount: 38, tendered: null }],
    });
    if (!sale.ok) throw new Error(sale.error.message);
    const detail = await getSale(owner, actor("owner", "owner"), sale.sale.id);
    if (!detail.ok || !detail.data) throw new Error("sale");
    const ret = await createReturn(owner, OWNER, {
      saleId: sale.sale.id,
      reason: "Broken",
      refundMethod: "transfer",
      items: [{ saleItemId: detail.data.items[0]?.saleItemId as string, quantity: 1, restock: false }],
    });
    expect(ret.ok).toBe(true);

    const after = await getSummary(owner, OWNER, today);
    if (!after.ok) throw new Error(after.error);
    const d = (k: keyof Summary) => Math.round((after.data[k] - before.data[k]) * 100) / 100;
    const tax = detail.data.taxTotal;
    expect([d("salesCount"), d("grossSales"), d("discounts"), d("refunds"), d("netSales"), d("costOfSales"), d("writeOffUnits"), d("writeOffCost"), d("restockedCost")]).toEqual([
      1, 38, 2, 19, 19, 12, 1, 6, 0,
    ]);
    // Profit: (38 - tax) - 12 cost - (19 - half the tax); the written-off unit stays a loss.
    expect(d("profit")).toBeCloseTo(38 - tax - 12 - (19 - tax / 2), 2);

    const todayAfter = await getToday(cashier, DEMO_STORE_ID);
    if (!todayAfter.ok) throw new Error(todayAfter.error);
    expect(todayAfter.data.mySalesCount - todayBefore.data.mySalesCount).toBe(1);
    expect(Math.round((todayAfter.data.mySalesTotal - todayBefore.data.mySalesTotal) * 100)).toBe(3800);
    expect(Object.keys(todayAfter.data).some((k) => /cost|profit/i.test(k))).toBe(false);

    // Excel export of today's sales.
    const data = await loadExport(owner, OWNER, today);
    if (!data.ok) throw new Error(data.error);
    expect(data.data.sales.length).toBe(after.data.salesCount);
    const bytes = buildSalesWorkbook({ storeName: "Demo", timeZone: TZ, currency: "USD", range: today, generatedAt: new Date() }, data.data);
    const book = XLSX.read(bytes, { type: "array", cellFormula: true });
    expect(book.SheetNames).toEqual(["Summary", "Sales", "Items"]);
    const salesRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Sales!);
    const row = salesRows.find((r) => r["Sale #"] === detail.data?.number);
    expect(row).toMatchObject({ Customer: `'${evil}`, Status: "Partially returned", Total: 38, Refunded: 19, Net: 19, "Payment methods": "Transfer", Cost: 12 });
    const itemRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Items!);
    expect(itemRows.find((r) => r.SKU === `REP-${run}`)).toMatchObject({ Qty: 2, Returned: 1, "Written off": 1, "Unit cost": 6 });
    for (const name of book.SheetNames) {
      const ws = book.Sheets[name]!;
      expect(Object.keys(ws).filter((k) => !k.startsWith("!") && (ws[k] as XLSX.CellObject).f)).toEqual([]);
    }
    const summarySheet = XLSX.utils.sheet_to_json<[string, unknown]>(book.Sheets.Summary!, { header: 1 });
    expect(summarySheet.find((r) => r[0] === "Gross sales")?.[1]).toBe(after.data.grossSales);
  });

  it("the cashier can't read reports or export (server and database); another store can't either", async () => {
    const range = resolveRange({ preset: "last7" }, TZ).range;
    expect(await getSummary(cashier, CASHIER, range)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await loadExport(cashier, CASHIER, range)).toMatchObject({ ok: false, code: "forbidden" });
    const args = { p_store_id: DEMO_STORE_ID, p_from: range.from.toISOString(), p_to: range.to.toISOString() };
    for (const fn of ["report_summary", "report_sales_export", "report_sale_lines_export", "report_cashiers"] as const) {
      const { error } = await cashier.rpc(fn, args);
      expect(error?.message, fn).toBe("forbidden");
    }
    const { error } = await otherOwner.rpc("report_summary", args);
    expect(error?.message).toBe("forbidden");
    const { error: todayError } = await otherOwner.rpc("dashboard_today", { p_store_id: DEMO_STORE_ID });
    expect(todayError?.message).toBe("forbidden");
  });
});
