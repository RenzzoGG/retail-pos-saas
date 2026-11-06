import type { StoreRole } from "@/lib/permissions";
import { isManager } from "@/lib/permissions";
import { type Db, type Result, fail, forbidden, ok } from "@/lib/services/result";
import { type DashboardPeriod, DASHBOARD_PERIODS, type DateRange, lastDays, periodWindow } from "./ranges";

/**
 * Reports read the SQL functions of phase 8 as the signed-in user (RLS applies).
 * The functions check the role themselves; the server checks it again here so a
 * cashier never even calls them.
 */
type Actor = { storeId: string; role: StoreRole };
type Bounds = { from: Date; to: Date };

const num = (v: unknown) => Number(v ?? 0);
const bounds = (storeId: string, b: Bounds) => ({ p_store_id: storeId, p_from: b.from.toISOString(), p_to: b.to.toISOString() });

export type Summary = {
  salesCount: number;
  unitsSold: number;
  grossSales: number;
  discounts: number;
  tax: number;
  avgTicket: number;
  returnsCount: number;
  unitsReturned: number;
  refunds: number;
  netSales: number;
  costOfSales: number;
  restockedCost: number;
  writeOffUnits: number;
  writeOffCost: number;
  profit: number;
};

export type SeriesRow = { bucket: string; salesCount: number; grossSales: number; refunds: number; netSales: number; profit: number };
export type ProductRow = { productId: string; sku: string; name: string; category: string | null; unitsSold: number; unitsReturned: number; netUnits: number; netSales: number };
export type CategoryRow = { category: string; netUnits: number; netSales: number };
export type MethodRow = { method: "cash" | "card" | "transfer"; paymentsCount: number; collected: number; refunds: number; net: number };
export type CashierRow = { cashierId: string | null; cashierName: string; salesCount: number; grossSales: number; avgTicket: number };

export async function getSummary(db: Db, actor: Actor, b: Bounds): Promise<Result<Summary>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_summary", bounds(actor.storeId, b)).single();
  if (error || !data) return fail(error);
  return ok({
    salesCount: num(data.sales_count),
    unitsSold: num(data.units_sold),
    grossSales: num(data.gross_sales),
    discounts: num(data.discounts),
    tax: num(data.tax),
    avgTicket: num(data.avg_ticket),
    returnsCount: num(data.returns_count),
    unitsReturned: num(data.units_returned),
    refunds: num(data.refunds),
    netSales: num(data.net_sales),
    costOfSales: num(data.cost_of_sales),
    restockedCost: num(data.restocked_cost),
    writeOffUnits: num(data.write_off_units),
    writeOffCost: num(data.write_off_cost),
    profit: num(data.profit),
  });
}

export async function getTimeseries(db: Db, actor: Actor, b: Bounds, bucket: "day" | "month"): Promise<Result<SeriesRow[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_timeseries", { ...bounds(actor.storeId, b), p_bucket: bucket });
  if (error) return fail(error);
  return ok(
    (data ?? []).map((r) => ({
      bucket: r.bucket,
      salesCount: num(r.sales_count),
      grossSales: num(r.gross_sales),
      refunds: num(r.refunds),
      netSales: num(r.net_sales),
      profit: num(r.profit),
    })),
  );
}

export async function getTopProducts(db: Db, actor: Actor, b: Bounds, order: "units" | "revenue", limit: number): Promise<Result<ProductRow[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_products", { ...bounds(actor.storeId, b), p_order: order, p_limit: limit });
  if (error) return fail(error);
  return ok(
    (data ?? []).map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      category: r.category,
      unitsSold: num(r.units_sold),
      unitsReturned: num(r.units_returned),
      netUnits: num(r.net_units),
      netSales: num(r.net_sales),
    })),
  );
}

export async function getCategories(db: Db, actor: Actor, b: Bounds): Promise<Result<CategoryRow[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_categories", bounds(actor.storeId, b));
  if (error) return fail(error);
  return ok((data ?? []).map((r) => ({ category: r.category, netUnits: num(r.net_units), netSales: num(r.net_sales) })));
}

export async function getPaymentMethods(db: Db, actor: Actor, b: Bounds): Promise<Result<MethodRow[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_payment_methods", bounds(actor.storeId, b));
  if (error) return fail(error);
  return ok(
    (data ?? []).map((r) => ({
      method: r.method,
      paymentsCount: num(r.payments_count),
      collected: num(r.collected),
      refunds: num(r.refunds),
      net: num(r.net),
    })),
  );
}

export async function getCashiers(db: Db, actor: Actor, b: Bounds): Promise<Result<CashierRow[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("report_cashiers", bounds(actor.storeId, b));
  if (error) return fail(error);
  return ok(
    (data ?? []).map((r) => ({
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      salesCount: num(r.sales_count),
      grossSales: num(r.gross_sales),
      avgTicket: num(r.avg_ticket),
    })),
  );
}

export type Today = { storeSalesCount: number; storeSalesTotal: number; mySalesCount: number; mySalesTotal: number };

/** Any member: today's sales of the store and of the user. No costs. */
export async function getToday(db: Db, storeId: string): Promise<Result<Today>> {
  const { data, error } = await db.rpc("dashboard_today", { p_store_id: storeId }).single();
  if (error || !data) return fail(error);
  return ok({
    storeSalesCount: num(data.store_sales_count),
    storeSalesTotal: num(data.store_sales_total),
    mySalesCount: num(data.my_sales_count),
    mySalesTotal: num(data.my_sales_total),
  });
}

export type ManagerDashboard = {
  periods: Record<DashboardPeriod, { current: Summary; previous: Summary }>;
  last30: SeriesRow[];
  topProducts: ProductRow[];
  methods: MethodRow[];
};

/** Owner/admin dashboard: 3 periods vs. previous, last 30 days, best sellers and methods of the selected period. */
export async function getManagerDashboard(
  db: Db,
  actor: Actor,
  timeZone: string,
  period: DashboardPeriod,
  now = new Date(),
): Promise<Result<ManagerDashboard>> {
  if (!isManager(actor.role)) return forbidden();
  const windows = DASHBOARD_PERIODS.map((p) => periodWindow(p, timeZone, now));
  const selected = windows[DASHBOARD_PERIODS.indexOf(period)] ?? windows[2];
  const chart: DateRange = lastDays(30, timeZone, now);
  const [summaries, last30, topProducts, methods] = await Promise.all([
    Promise.all(windows.flatMap((w) => [getSummary(db, actor, w.current), getSummary(db, actor, w.previous)])),
    getTimeseries(db, actor, chart, "day"),
    getTopProducts(db, actor, selected!.current, "units", 5),
    getPaymentMethods(db, actor, selected!.current),
  ]);
  const failed = [...summaries, last30, topProducts, methods].find((r) => !r.ok);
  if (failed && !failed.ok) return failed;
  const s = summaries.map((r) => (r as { ok: true; data: Summary }).data);
  return ok({
    periods: {
      today: { current: s[0]!, previous: s[1]! },
      week: { current: s[2]!, previous: s[3]! },
      month: { current: s[4]!, previous: s[5]! },
    },
    last30: (last30 as { ok: true; data: SeriesRow[] }).data,
    topProducts: (topProducts as { ok: true; data: ProductRow[] }).data,
    methods: (methods as { ok: true; data: MethodRow[] }).data,
  });
}

export type Report = {
  summary: Summary;
  series: SeriesRow[];
  byUnits: ProductRow[];
  byRevenue: ProductRow[];
  categories: CategoryRow[];
  methods: MethodRow[];
  cashiers: CashierRow[];
};

export async function getReport(db: Db, actor: Actor, range: DateRange): Promise<Result<Report>> {
  if (!isManager(actor.role)) return forbidden();
  const [summary, series, byUnits, byRevenue, categories, methods, cashiers] = await Promise.all([
    getSummary(db, actor, range),
    getTimeseries(db, actor, range, range.bucket),
    getTopProducts(db, actor, range, "units", 10),
    getTopProducts(db, actor, range, "revenue", 10),
    getCategories(db, actor, range),
    getPaymentMethods(db, actor, range),
    getCashiers(db, actor, range),
  ]);
  if (!summary.ok) return summary;
  if (!series.ok) return series;
  if (!byUnits.ok) return byUnits;
  if (!byRevenue.ok) return byRevenue;
  if (!categories.ok) return categories;
  if (!methods.ok) return methods;
  if (!cashiers.ok) return cashiers;
  return ok({
    summary: summary.data,
    series: series.data,
    byUnits: byUnits.data,
    byRevenue: byRevenue.data,
    categories: categories.data,
    methods: methods.data,
    cashiers: cashiers.data,
  });
}
