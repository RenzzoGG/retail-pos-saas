import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { METHOD_LABELS } from "@/features/pos/labels";
import { bucketLabel, compactMoney, toSeries } from "@/features/reports/chart-data";
import { BarList } from "@/features/reports/components/bar-list";
import { ColumnChart } from "@/features/reports/components/column-chart";
import { StatCard } from "@/features/reports/components/stat-card";
import { PRESETS, PRESET_LABELS, rangeParams, resolveRange } from "@/features/reports/ranges";
import { getReport } from "@/features/reports/service";
import { getStoreSettings } from "@/features/stores/service";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports · Stocktill" };

type Search = { preset?: string; from?: string; to?: string; top?: string };

const INPUT =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";
const CELL = "py-2 pr-3";
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { store } = await requireRole(["owner", "admin"]);
  const db = await createClient();
  const settings = await getStoreSettings(db, store.storeId);
  if (!settings.ok) return <Alert tone="error">{settings.error}</Alert>;
  const { timezone: timeZone, currency } = settings.data;
  const money = (n: number) => formatMoney(n, currency);

  const search = await searchParams;
  const resolved = resolveRange(search, timeZone);
  const range = resolved.range;
  const top = search.top === "revenue" ? "revenue" : "units";
  const keep = rangeParams(range);
  const result = await getReport(db, store, range);

  return (
    <>
      <PageHeader title="Reports" description={`${range.fromDate} to ${range.toDate} · times in ${timeZone.replaceAll("_", " ")}`}>
        <a href={`/app/reports/export?${keep}`} className={buttonClasses("primary")} download>
          Export to Excel
        </a>
      </PageHeader>

      <section aria-label="Date range" className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <nav aria-label="Quick ranges" className="flex flex-wrap gap-2">
          {PRESETS.filter((p) => p !== "custom").map((p) => (
            <Link
              key={p}
              href={`/app/reports?preset=${p}`}
              aria-current={range.preset === p ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${range.preset === p ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            >
              {PRESET_LABELS[p]}
            </Link>
          ))}
        </nav>
        <form method="get" action="/app/reports" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="preset" value="custom" />
          <div>
            <label htmlFor="report-from" className="block text-sm font-medium text-slate-800 dark:text-slate-200">From</label>
            <input id="report-from" name="from" type="date" required defaultValue={range.fromDate} className={INPUT} />
          </div>
          <div>
            <label htmlFor="report-to" className="block text-sm font-medium text-slate-800 dark:text-slate-200">To</label>
            <input id="report-to" name="to" type="date" required defaultValue={range.toDate} className={INPUT} />
          </div>
          <button type="submit" className={buttonClasses(range.preset === "custom" ? "primary" : "secondary")}>
            Apply custom range
          </button>
        </form>
        {!resolved.ok ? <Alert tone="error">{resolved.error} Showing this month instead.</Alert> : null}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Returns count on the day they were made. Gross profit is net of returns and counts write-offs (damaged returns) as a loss.
        </p>
      </section>

      {!result.ok ? (
        <Alert tone="error">{result.error}</Alert>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-summary">
            <StatCard label="Gross sales" value={money(result.data.summary.grossSales)} hint={`${count(result.data.summary.salesCount, "sale", "sales")} · ${count(result.data.summary.unitsSold, "unit", "units")}`} testId="report-gross" />
            <StatCard label="Refunds" value={money(result.data.summary.refunds)} hint={`${count(result.data.summary.returnsCount, "return", "returns")} · ${count(result.data.summary.unitsReturned, "unit", "units")}`} testId="report-refunds" />
            <StatCard label="Net sales" value={money(result.data.summary.netSales)} hint={`Discounts given: ${money(result.data.summary.discounts)}`} testId="report-net" />
            <StatCard label="Gross profit" value={money(result.data.summary.profit)} hint={`Tax ${money(result.data.summary.tax)} · cost of sales ${money(result.data.summary.costOfSales)}`} testId="report-profit" />
            <StatCard label="Avg. ticket" value={money(result.data.summary.avgTicket)} testId="report-avg" />
            <StatCard
              label="Write-offs"
              value={money(result.data.summary.writeOffCost)}
              hint={`${count(result.data.summary.writeOffUnits, "damaged unit", "damaged units")}, at cost`}
              testId="report-writeoffs"
            />
          </dl>

          <Card title={range.bucket === "day" ? "Sales by day" : "Sales by month"} description={range.bucket === "month" ? "Ranges over 62 days are grouped by month." : undefined}>
            <ColumnChart
              title={range.bucket === "day" ? "Sales by day" : "Sales by month"}
              testId="report-chart"
              points={toSeries(result.data.series.map((r) => ({ bucket: r.bucket, value: r.grossSales })), range.bucket).map((p, i) => ({
                ...p,
                longLabel: bucketLabel(p.key, range.bucket, true),
                detail: `${result.data.series[i]?.salesCount ?? 0} sales · net ${money(result.data.series[i]?.netSales ?? 0)}`,
              }))}
              format={money}
              formatTick={(n) => compactMoney(n, currency)}
              table={{
                headers: [range.bucket === "day" ? "Day" : "Month", "Sales", "Amount", "Refunds", "Net", "Profit"],
                rows: result.data.series.map((r) => [
                  bucketLabel(r.bucket, range.bucket, true),
                  String(r.salesCount),
                  money(r.grossSales),
                  money(r.refunds),
                  money(r.netSales),
                  money(r.profit),
                ]),
              }}
            />
          </Card>

          <Card title="Best sellers" description="Net of returns made in the period. Revenue is what was charged, after discounts, tax included.">
            <nav aria-label="Sort best sellers" className="mb-3 flex gap-2 text-sm">
              {(["units", "revenue"] as const).map((t) => (
                <Link
                  key={t}
                  href={`/app/reports?${keep}${t === "revenue" ? "&top=revenue" : ""}`}
                  aria-current={top === t ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 ${top === t ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                >
                  {t === "units" ? "By units" : "By revenue"}
                </Link>
              ))}
            </nav>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="report-products">
                <caption className="sr-only">Best sellers {top === "units" ? "by units" : "by revenue"}</caption>
                <thead className="text-left text-slate-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className={`${CELL} font-medium`}>#</th>
                    <th scope="col" className={`${CELL} font-medium`}>Product</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Sold</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Returned</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Net units</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Net revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(top === "units" ? result.data.byUnits : result.data.byRevenue).map((p, i) => (
                    <tr key={p.productId}>
                      <td className={`${CELL} tabular-nums text-slate-500`}>{i + 1}</td>
                      <th scope="row" className={`${CELL} text-left font-normal`}>
                        {p.name}
                        <span className="block font-mono text-xs text-slate-500">{p.sku}</span>
                      </th>
                      <td className={`${CELL} text-right tabular-nums`}>{p.unitsSold}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{p.unitsReturned || "—"}</td>
                      <td className={`${CELL} text-right tabular-nums font-medium`}>{p.netUnits}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{money(p.netSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.data.byUnits.length === 0 ? <p className="py-3 text-sm text-slate-600 dark:text-slate-400">No sales in this period.</p> : null}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="By category" description="Net revenue per category.">
              <BarList
                label="Net revenue by category"
                testId="report-categories"
                items={result.data.categories.map((c) => ({
                  key: c.category,
                  label: c.category,
                  sublabel: `${c.netUnits} ${c.netUnits === 1 ? "unit" : "units"}`,
                  value: c.netSales,
                  display: money(c.netSales),
                }))}
              />
            </Card>
            <Card title="By payment method" description="Collected at checkout minus refunds paid out.">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm" data-testid="report-methods">
                  <caption className="sr-only">Sales by payment method</caption>
                  <thead className="text-left text-slate-600 dark:text-slate-400">
                    <tr>
                      <th scope="col" className={`${CELL} font-medium`}>Method</th>
                      <th scope="col" className={`${CELL} text-right font-medium`}>Payments</th>
                      <th scope="col" className={`${CELL} text-right font-medium`}>Collected</th>
                      <th scope="col" className={`${CELL} text-right font-medium`}>Refunds</th>
                      <th scope="col" className={`${CELL} text-right font-medium`}>Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {result.data.methods.map((m) => (
                      <tr key={m.method}>
                        <th scope="row" className={`${CELL} text-left font-normal`}>{METHOD_LABELS[m.method]}</th>
                        <td className={`${CELL} text-right tabular-nums`}>{m.paymentsCount}</td>
                        <td className={`${CELL} text-right tabular-nums`}>{money(m.collected)}</td>
                        <td className={`${CELL} text-right tabular-nums`}>{m.refunds > 0 ? `−${money(m.refunds)}` : "—"}</td>
                        <td className={`${CELL} text-right tabular-nums font-medium`}>{money(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="By cashier" description="Sales rung up by each team member.">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="report-cashiers">
                <caption className="sr-only">Sales by cashier</caption>
                <thead className="text-left text-slate-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className={`${CELL} font-medium`}>Team member</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Sales</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Amount</th>
                    <th scope="col" className={`${CELL} text-right font-medium`}>Avg. ticket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {result.data.cashiers.map((c) => (
                    <tr key={c.cashierId ?? "former"}>
                      <th scope="row" className={`${CELL} text-left font-normal`}>{c.cashierName}</th>
                      <td className={`${CELL} text-right tabular-nums`}>{c.salesCount}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{money(c.grossSales)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{money(c.avgTicket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.data.cashiers.length === 0 ? <p className="py-3 text-sm text-slate-600 dark:text-slate-400">No sales in this period.</p> : null}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
