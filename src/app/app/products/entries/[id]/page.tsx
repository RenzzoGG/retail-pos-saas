import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { getStockEntry } from "@/features/inventory/service";
import { getActiveStore } from "@/features/stores/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";

export const metadata: Metadata = { title: "Stock entry · Stocktill" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function StockEntryPage({ params, searchParams }: Props) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const entry = await getStockEntry(await createClient(), { userId: user.id, storeId: store.storeId, role: store.role }, id);
  if (!entry.ok) return <Alert tone="error">{entry.error}</Alert>;
  const e = entry.data;
  if (!e) notFound();
  const money = (n: number) => formatMoney(n, settings.currency);

  return (
    <>
      <PageHeader
        title="Stock entry"
        description={`${formatDateTime(e.createdAt, settings.timezone)} · by ${e.createdBy}${e.supplier ? ` · from ${e.supplier}` : ""}`}
      />
      <ProductsTabs current="entries" />
      {created ? (
        <div className="mb-4">
          <Alert tone="success">
            Stock received: {e.units} units of {e.lineCount} {e.lineCount === 1 ? "product" : "products"}.
          </Alert>
        </div>
      ) : null}
      {e.note ? <p className="mb-4 text-sm text-slate-700 dark:text-slate-300">Note: {e.note}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <caption className="sr-only">Products received</caption>
          <thead className="bg-slate-50 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Product</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {e.lines.map((l) => (
              <tr key={l.productId}>
                <td className="px-3 py-2">
                  <Link href={`/app/products/${l.productId}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {l.name}
                  </Link>
                  <span className="block font-mono text-xs text-slate-500">{l.sku}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.unitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.lineCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="px-3 py-2 text-right font-medium">Total cost</th>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(e.totalCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
