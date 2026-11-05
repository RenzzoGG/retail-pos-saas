import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { listStockEntries } from "@/features/inventory/service";
import { getActiveStore } from "@/features/stores/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Stock entries · Stocktill" };

export default async function StockEntriesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  const page = Math.max(1, Number(pageParam) || 1);
  const entries = await listStockEntries(await createClient(), { userId: user.id, storeId: store.storeId, role: store.role }, page);

  return (
    <>
      <PageHeader title="Stock entries" description={`Merchandise received. Times in ${settings.timezone.replaceAll("_", " ")}.`}>
        <Link href="/app/products/receive" className={buttonClasses("primary")}>
          Receive stock
        </Link>
      </PageHeader>
      <ProductsTabs current="entries" />
      {!entries.ok ? (
        <Alert tone="error">{entries.error}</Alert>
      ) : entries.data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No stock entries yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <caption className="sr-only">Stock entries</caption>
              <thead className="bg-slate-50 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Supplier</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Products</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total cost</th>
                  <th scope="col" className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {entries.data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/app/products/entries/${e.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {formatDateTime(e.createdAt, settings.timezone)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{e.supplier ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.lineCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.units}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(e.totalCost, settings.currency)}</td>
                    <td className="px-3 py-2">{e.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={entries.data.page}
            pageCount={entries.data.pageCount}
            total={entries.data.total}
            hrefFor={(n) => withQuery("/app/products/entries", { page: n === 1 ? "" : n })}
            label="entries"
          />
        </>
      )}
    </>
  );
}
