import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { SortHeader } from "@/components/app/sort-header";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { StockBadge } from "@/features/inventory/components/stock-badge";
import { parseProductListQuery, type ProductListQuery } from "@/features/inventory/schemas";
import { listCategories, listProducts } from "@/features/inventory/service";
import { getActiveStore } from "@/features/stores/queries";
import { formatMoney, formatPercent, marginInfo } from "@/lib/money";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Products · Stocktill" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CONTROL =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = parseProductListQuery(params);
  const { user, store, settings } = await getActiveStore();
  const manager = isManager(store.role);
  const actor = { userId: user.id, storeId: store.storeId, role: store.role };
  const db = await createClient();
  const [result, categories] = await Promise.all([listProducts(db, actor, query), listCategories(db, store.storeId)]);

  const href = (overrides: Partial<ProductListQuery>) => {
    const q = { ...query, ...overrides };
    return withQuery("/app/products", {
      q: q.q,
      category: q.category,
      low: q.low,
      sort: q.sort === "name" ? "" : q.sort,
      dir: q.dir === "asc" ? "" : q.dir,
      page: q.page === 1 ? "" : q.page,
    });
  };
  const sortHref = (sort: string, dir: "asc" | "desc") => href({ sort: sort as ProductListQuery["sort"], dir, page: 1 });
  const money = (n: number) => formatMoney(n, settings.currency);

  return (
    <>
      <PageHeader
        title="Products"
        description={manager ? "Your catalog, stock and margins." : "Look up prices and stock."}
      >
        {manager ? (
          <Link href="/app/products/new" className={buttonClasses("primary")}>
            New product
          </Link>
        ) : null}
      </PageHeader>
      {manager ? <ProductsTabs current="catalog" /> : null}

      {params.deleted ? (
        <div className="mb-4">
          <Alert tone="success">Product deleted.</Alert>
        </div>
      ) : null}

      <form method="get" action="/app/products" className="mb-4 flex flex-col gap-3 md:flex-row md:items-end" role="search">
        <div className="flex-1">
          <label htmlFor="product-search" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Search
          </label>
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Name, SKU or barcode"
            className={`${CONTROL} mt-1 w-full`}
          />
        </div>
        <div>
          <label htmlFor="product-category" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Category
          </label>
          <select id="product-category" name="category" defaultValue={query.category} className={`${CONTROL} mt-1 w-full md:w-48`}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 md:pb-2">
          <input
            id="product-low"
            name="low"
            type="checkbox"
            value="1"
            defaultChecked={query.low}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          <label htmlFor="product-low" className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Low stock only
          </label>
        </div>
        {query.sort !== "name" ? <input type="hidden" name="sort" value={query.sort} /> : null}
        {query.dir !== "asc" ? <input type="hidden" name="dir" value={query.dir} /> : null}
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("secondary")}>
            Apply
          </button>
          {query.q || query.category || query.low ? (
            <Link href="/app/products" className={buttonClasses("ghost")}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {!result.ok ? (
        <Alert tone="error">{result.error}</Alert>
      ) : result.data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {query.q || query.category || query.low ? "No products match these filters." : "No products yet."}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <caption className="sr-only">Products</caption>
              <thead className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <SortHeader label="Name" column="name" currentSort={query.sort} currentDir={query.dir} hrefFor={sortHref} />
                  <SortHeader label="SKU" column="sku" currentSort={query.sort} currentDir={query.dir} hrefFor={sortHref} />
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Barcode
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Category
                  </th>
                  <SortHeader label="Price" column="sale_price" currentSort={query.sort} currentDir={query.dir} hrefFor={sortHref} align="right" />
                  {manager ? (
                    <>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Cost
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Margin
                      </th>
                    </>
                  ) : null}
                  <SortHeader label="Stock" column="stock" currentSort={query.sort} currentDir={query.dir} hrefFor={sortHref} align="right" />
                  {manager ? (
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {result.data.items.map((p) => {
                  const margin = manager ? marginInfo(p.salePrice, p.cost, settings.taxRate, settings.pricesIncludeTax) : null;
                  return (
                    <tr key={p.id} data-testid={`product-${p.sku}`} className={p.active ? "" : "opacity-60"}>
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                        {manager ? (
                          <Link href={`/app/products/${p.id}`} className="hover:underline">
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                        {p.active ? null : <span className="ml-2 text-xs text-slate-500">(inactive)</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.barcode ?? "—"}</td>
                      <td className="px-3 py-2">{p.category ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.salePrice)}</td>
                      {manager ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{p.cost === null ? "—" : money(p.cost)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {margin ? (
                              <span className={margin.margin < 0 ? "text-red-600 dark:text-red-400" : ""}>
                                {money(margin.margin)}
                                {margin.marginPct === null ? null : (
                                  <span className="ml-1 text-xs text-slate-500">({formatPercent(margin.marginPct)})</span>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      ) : null}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.stock}
                        <StockBadge stock={p.stock} isLowStock={p.isLowStock} />
                      </td>
                      {manager ? (
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/app/products/${p.id}`}
                            className="text-indigo-600 hover:underline dark:text-indigo-400"
                            aria-label={`Edit ${p.name}`}
                          >
                            Edit
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.page}
            pageCount={result.data.pageCount}
            total={result.data.total}
            hrefFor={(page) => href({ page })}
            label="products"
          />
          {manager && settings.pricesIncludeTax ? (
            <p className="mt-2 text-xs text-slate-500">Margins are calculated on prices without tax.</p>
          ) : null}
        </>
      )}
    </>
  );
}
