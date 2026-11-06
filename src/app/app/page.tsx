import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { countLowStock } from "@/features/inventory/service";
import { METHOD_LABELS } from "@/features/pos/labels";
import { bucketLabel, compactMoney, toSeries } from "@/features/reports/chart-data";
import { BarList } from "@/features/reports/components/bar-list";
import { ColumnChart } from "@/features/reports/components/column-chart";
import { StatCard } from "@/features/reports/components/stat-card";
import { DASHBOARD_PERIODS, type DashboardPeriod, PERIOD_LABELS } from "@/features/reports/ranges";
import { getManagerDashboard, getToday } from "@/features/reports/service";
import { getActiveStore } from "@/features/stores/queries";
import { formatMoney } from "@/lib/money";
import { ROLE_LABELS, isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard · Stocktill" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { store, settings } = await getActiveStore();
  const db = await createClient();
  const lowStock = await countLowStock(db, store.storeId);
  const money = (n: number) => formatMoney(n, settings.currency);
  const header = <PageHeader title="Dashboard" description={`${store.storeName} · signed in as ${ROLE_LABELS[store.role]}`} />;

  if (!isManager(store.role)) {
    const today = await getToday(db, store.storeId);
    return (
      <>
        {header}
        <div className="space-y-6">
          {today.ok ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Store sales today"
                value={money(today.data.storeSalesTotal)}
                hint={`${today.data.storeSalesCount} ${today.data.storeSalesCount === 1 ? "sale" : "sales"}`}
                testId="today-store"
              />
              <StatCard
                label="My sales today"
                value={money(today.data.mySalesTotal)}
                hint={`${today.data.mySalesCount} ${today.data.mySalesCount === 1 ? "sale" : "sales"}`}
                testId="today-mine"
              />
            </dl>
          ) : (
            <Alert tone="error">{today.error}</Alert>
          )}
          <LowStock count={lowStock} />
          <Link href="/app/pos" className={buttonClasses("primary")}>
            Open the register
          </Link>
        </div>
      </>
    );
  }

  const requested = (await searchParams).period;
  const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(requested ?? "") ? (requested as DashboardPeriod) : "month";
  const result = await getManagerDashboard(db, store, settings.timezone, period);
  if (!result.ok) {
    return (
      <>
        {header}
        <Alert tone="error">{result.error}</Alert>
      </>
    );
  }
  const d = result.data;
  const selected = d.periods[period];
  const compare = PERIOD_LABELS[period].previous;
  const points = toSeries(d.last30.map((r) => ({ bucket: r.bucket, value: r.grossSales })), "day").map((p, i) => ({
    ...p,
    longLabel: bucketLabel(p.key, "day", true),
    detail: `${d.last30[i]?.salesCount ?? 0} sales`,
  }));

  return (
    <>
      {header}
      <div className="space-y-6">
        <LowStock count={lowStock} />

        <section aria-labelledby="sales-heading">
          <h2 id="sales-heading" className="sr-only">Sales</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            {DASHBOARD_PERIODS.map((p) => (
              <StatCard
                key={p}
                label={`Sales · ${PERIOD_LABELS[p].title}`}
                value={money(d.periods[p].current.grossSales)}
                current={d.periods[p].current.grossSales}
                previous={d.periods[p].previous.grossSales}
                previousLabel={PERIOD_LABELS[p].previous}
                previousDisplay={money(d.periods[p].previous.grossSales)}
                testId={`sales-${p}`}
              />
            ))}
          </dl>
        </section>

        <section aria-labelledby="period-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="period-heading" className="text-lg font-semibold text-slate-900 dark:text-white">
              {PERIOD_LABELS[period].title} <span className="text-sm font-normal text-slate-500">{compare}</span>
            </h2>
            <nav aria-label="Period" className="inline-flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
              {DASHBOARD_PERIODS.map((p) => (
                <Link
                  key={p}
                  href={p === "month" ? "/app" : `/app?period=${p}`}
                  aria-current={p === period ? "page" : undefined}
                  className={`rounded px-3 py-1.5 text-sm ${p === period ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                >
                  {PERIOD_LABELS[p].title}
                </Link>
              ))}
            </nav>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Gross profit" value={money(selected.current.profit)} current={selected.current.profit} previous={selected.previous.profit} testId="kpi-profit" hint="Net of returns; write-offs count as a loss." />
            <StatCard label="Avg. ticket" value={money(selected.current.avgTicket)} current={selected.current.avgTicket} previous={selected.previous.avgTicket} testId="kpi-avg" />
            <StatCard label="Number of sales" value={String(selected.current.salesCount)} current={selected.current.salesCount} previous={selected.previous.salesCount} testId="kpi-count" />
            <StatCard
              label="Refunds"
              value={money(selected.current.refunds)}
              current={selected.current.refunds}
              previous={selected.previous.refunds}
              goodWhenUp={false}
              hint={`${selected.current.returnsCount} ${selected.current.returnsCount === 1 ? "return" : "returns"}`}
              testId="kpi-refunds"
            />
            <StatCard
              label="Write-offs"
              value={money(selected.current.writeOffCost)}
              current={selected.current.writeOffCost}
              previous={selected.previous.writeOffCost}
              goodWhenUp={false}
              hint={`${selected.current.writeOffUnits} damaged ${selected.current.writeOffUnits === 1 ? "unit" : "units"} (at cost)`}
              testId="kpi-writeoffs"
            />
          </dl>
        </section>

        <Card title="Sales per day" description={`Last 30 days, in ${settings.timezone.replaceAll("_", " ")} time.`}>
          <ColumnChart
            title="Sales per day, last 30 days"
            points={points}
            format={money}
            formatTick={(n) => compactMoney(n, settings.currency)}
            testId="chart-30-days"
            table={{
              headers: ["Day", "Sales", "Amount", "Refunds", "Net"],
              rows: d.last30.map((r) => [bucketLabel(r.bucket, "day", true), String(r.salesCount), money(r.grossSales), money(r.refunds), money(r.netSales)]),
            }}
          />
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Best sellers" description={`${PERIOD_LABELS[period].title}, by units (net of returns).`}>
            <BarList
              label="Best-selling products"
              testId="top-products"
              items={d.topProducts.map((p) => ({
                key: p.productId,
                label: p.name,
                value: p.netUnits,
                display: `${p.netUnits} ${p.netUnits === 1 ? "unit" : "units"}`,
                detail: `${p.sku} · ${money(p.netSales)}`,
              }))}
            />
            <Link href="/app/reports" className="mt-4 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
              See all reports
            </Link>
          </Card>
          <Card title="Payment methods" description={`${PERIOD_LABELS[period].title}: collected minus refunds.`}>
            <BarList
              label="Sales by payment method"
              testId="payment-methods"
              items={d.methods
                .filter((m) => m.collected > 0 || m.refunds > 0)
                .map((m) => ({
                  key: m.method,
                  label: METHOD_LABELS[m.method],
                  sublabel: `${m.paymentsCount} ${m.paymentsCount === 1 ? "payment" : "payments"}`,
                  value: m.net,
                  display: money(m.net),
                  detail: `Collected ${money(m.collected)} · refunded ${money(m.refunds)}`,
                }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function LowStock({ count }: { count: number }) {
  return count > 0 ? (
    <div
      role="status"
      data-testid="low-stock-alert"
      className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="text-sm font-medium">
        {count} {count === 1 ? "product is" : "products are"} low on stock.
      </p>
      <Link href="/app/products?low=1" className="text-sm font-semibold underline">
        View low-stock products
      </Link>
    </div>
  ) : (
    <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
      All products are above their low-stock threshold.
    </p>
  );
}
