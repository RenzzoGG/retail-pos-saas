import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { deleteProductAction, updateProductAction } from "@/features/inventory/actions";
import { DeleteProductButton } from "@/features/inventory/components/delete-product-button";
import { ProductForm } from "@/features/inventory/components/product-form";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { StockBadge } from "@/features/inventory/components/stock-badge";
import { getProduct, listCategories, listProductMovements } from "@/features/inventory/service";
import { getActiveStore } from "@/features/stores/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney, formatPercent, marginInfo } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Product · Stocktill" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; created?: string }>;
};

const MOVEMENT_LABELS = { entry: "Stock entry", sale: "Sale", return: "Return" } as const;

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ id }, { page: pageParam, created }] = await Promise.all([params, searchParams]);
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const actor = { userId: user.id, storeId: store.storeId, role: store.role };
  const db = await createClient();
  const page = Math.max(1, Number(pageParam) || 1);
  const [product, movements, categories] = await Promise.all([
    getProduct(db, actor, id),
    listProductMovements(db, actor, id, page),
    listCategories(db, store.storeId),
  ]);
  if (!product.ok) return <Alert tone="error">{product.error}</Alert>;
  const p = product.data;
  if (!p) notFound();

  const money = (n: number) => formatMoney(n, settings.currency);
  const margin = marginInfo(p.salePrice, p.cost, settings.taxRate, settings.pricesIncludeTax);

  return (
    <>
      <PageHeader title={p.name} description={`SKU ${p.sku}${p.barcode ? ` · barcode ${p.barcode}` : ""}`}>
        <Link href={withQuery("/app/products/receive", { product: p.id })} className={buttonClasses("secondary")}>
          Receive stock
        </Link>
      </PageHeader>
      <ProductsTabs current="catalog" />
      {created ? (
        <div className="mb-4">
          <Alert tone="success">Product created. Add stock with “Receive stock”.</Alert>
        </div>
      ) : null}

      <dl className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Stock", value: <span data-testid="product-stock">{p.stock}<StockBadge stock={p.stock} isLowStock={p.isLowStock} /></span> },
          { label: "Sale price", value: money(p.salePrice) },
          { label: "Average cost", value: <span data-testid="product-cost">{p.cost === null ? "—" : money(p.cost)}</span> },
          {
            label: "Margin per unit",
            value: margin ? `${money(margin.margin)}${margin.marginPct === null ? "" : ` (${formatPercent(margin.marginPct)})`}` : "—",
          },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900 tabular-nums dark:text-white">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Details" description="Stock and cost change only through stock entries, sales and returns.">
          <ProductForm
            action={updateProductAction.bind(null, p.id)}
            categories={categories}
            submitLabel="Save changes"
            defaults={{
              name: p.name,
              sku: p.sku,
              barcode: p.barcode ?? "",
              category: p.category ?? "",
              salePrice: p.salePrice.toFixed(2),
              lowStockThreshold: String(p.lowStockThreshold),
              active: p.active,
            }}
          />
          <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-800">
            <DeleteProductButton action={deleteProductAction.bind(null, p.id)} productName={p.name} />
          </div>
        </Card>

        <Card title="Stock movements" description={`Times in ${settings.timezone.replaceAll("_", " ")}.`}>
          {!movements.ok ? (
            <Alert tone="error">{movements.error}</Alert>
          ) : movements.data.items.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No movements yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <caption className="sr-only">Stock movements of {p.name}</caption>
                  <thead className="text-left text-slate-600 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Change</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Stock after</th>
                      <th scope="col" className="py-2 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {movements.data.items.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(m.createdAt, settings.timezone)}</td>
                        <td className="py-2 pr-3">
                          {m.entryId ? (
                            <Link href={`/app/products/entries/${m.entryId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                              {MOVEMENT_LABELS[m.type]}
                            </Link>
                          ) : (
                            MOVEMENT_LABELS[m.type]
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${m.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{m.stockAfter}</td>
                        <td className="py-2">{m.createdBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={movements.data.page}
                pageCount={movements.data.pageCount}
                total={movements.data.total}
                hrefFor={(n) => withQuery(`/app/products/${p.id}`, { page: n === 1 ? "" : n })}
                label="movements"
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
