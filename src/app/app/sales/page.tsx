import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { METHOD_LABELS, STATUS_LABELS } from "@/features/pos/labels";
import { parseSalesQuery } from "@/features/pos/schemas";
import { listSales, listSellers } from "@/features/pos/service";
import { getActiveStore } from "@/features/stores/queries";
import { formatMoney } from "@/lib/money";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Sales · Stocktill" };

const CONTROL =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "block text-sm font-medium text-slate-800 dark:text-slate-200";

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseSalesQuery(await searchParams);
  const { user, store, settings } = await getActiveStore();
  const manager = isManager(store.role);
  const actor = { userId: user.id, storeId: store.storeId, role: store.role };
  const db = await createClient();
  const [sales, sellers] = await Promise.all([listSales(db, actor, query, settings.timezone), listSellers(db, actor)]);
  const money = (n: number) => formatMoney(n, settings.currency);
  const filtered = Boolean(query.number || query.from || query.to || query.method || query.cashier);
  const params = { q: query.number, from: query.from, to: query.to, method: query.method, cashier: query.cashier };

  return (
    <>
      <PageHeader title="Sales" description={`Every sale in ${store.storeName}. Times in ${settings.timezone.replaceAll("_", " ")}.`}>
        <Link href="/app/pos" className={buttonClasses("primary")}>
          New sale
        </Link>
      </PageHeader>

      <form method="get" action="/app/sales" aria-label="Filter sales" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div>
          <label htmlFor="sales-number" className={LABEL}>Sale #</label>
          <input id="sales-number" name="q" inputMode="numeric" defaultValue={query.number ?? ""} placeholder="e.g. 42" className={CONTROL} />
        </div>
        <div>
          <label htmlFor="sales-from" className={LABEL}>From</label>
          <input id="sales-from" name="from" type="date" defaultValue={query.from} className={CONTROL} />
        </div>
        <div>
          <label htmlFor="sales-to" className={LABEL}>To</label>
          <input id="sales-to" name="to" type="date" defaultValue={query.to} className={CONTROL} />
        </div>
        <div>
          <label htmlFor="sales-method" className={LABEL}>Payment</label>
          <select id="sales-method" name="method" defaultValue={query.method ?? ""} className={CONTROL}>
            <option value="">Any method</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
        <div>
          <label htmlFor="sales-cashier" className={LABEL}>Cashier</label>
          <select id="sales-cashier" name="cashier" defaultValue={query.cashier ?? ""} className={CONTROL}>
            <option value="">Everyone</option>
            {sellers.ok ? sellers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : null}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("secondary")}>Apply</button>
          {filtered ? <Link href="/app/sales" className={buttonClasses("ghost")}>Clear</Link> : null}
        </div>
      </form>

      {!sales.ok ? (
        <Alert tone="error">{sales.error}</Alert>
      ) : sales.data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {filtered ? "No sales match these filters." : "No sales yet."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <caption className="sr-only">Sales</caption>
              <thead className="bg-slate-50 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Sale</th>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Cashier</th>
                  <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-2 font-medium">Paid with</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  {manager ? <th scope="col" className="px-3 py-2 text-right font-medium">Profit</th> : null}
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sales.data.items.map((s) => (
                  <tr key={s.id} data-testid={`sale-row-${s.number}`}>
                    <td className="px-3 py-2">
                      <Link href={`/app/sales/${s.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        #{s.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.createdAt, settings.timezone)}</td>
                    <td className="px-3 py-2">{s.cashierName}</td>
                    <td className="px-3 py-2">{s.customerName ?? "—"}</td>
                    <td className="px-3 py-2">{s.methods.map((m) => METHOD_LABELS[m]).join(" + ")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(s.total)}</td>
                    {manager ? (
                      <td className={`px-3 py-2 text-right tabular-nums ${s.profit !== null && s.profit < 0 ? "text-red-600" : ""}`}>
                        {s.profit === null ? "—" : money(s.profit)}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">{STATUS_LABELS[s.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={sales.data.page}
            pageCount={sales.data.pageCount}
            total={sales.data.total}
            hrefFor={(page) => withQuery("/app/sales", { ...params, page: page === 1 ? "" : page })}
            label="sales"
          />
          {manager ? <p className="mt-2 text-xs text-slate-500">Profit = total without tax − cost of the items when sold.</p> : null}
        </>
      )}
    </>
  );
}
