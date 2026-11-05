import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { parseCustomerQuery } from "@/features/customers/schemas";
import { listCustomers } from "@/features/customers/service";
import { requireStoreContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Customers · Stocktill" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = parseCustomerQuery(params);
  const { store } = await requireStoreContext();
  const result = await listCustomers(await createClient(), store.storeId, query);
  const removed = params.removed;

  return (
    <>
      <PageHeader title="Customers" description="Find customers and see what they bought.">
        <Link href="/app/customers/new" className={buttonClasses("primary")}>
          New customer
        </Link>
      </PageHeader>
      {removed === "archived" || removed === "deleted" ? (
        <div className="mb-4">
          <Alert tone="success">{removed === "archived" ? "Customer archived (their purchase history is kept)." : "Customer deleted."}</Alert>
        </div>
      ) : null}
      <form method="get" action="/app/customers" role="search" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="customer-search" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Search
          </label>
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Name, phone, email or document"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("secondary")}>Search</button>
          {query.q ? <Link href="/app/customers" className={buttonClasses("ghost")}>Clear</Link> : null}
        </div>
      </form>

      {!result.ok ? (
        <Alert tone="error">{result.error}</Alert>
      ) : result.data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {query.q ? "No customers match your search." : "No customers yet."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <caption className="sr-only">Customers</caption>
              <thead className="bg-slate-50 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Phone</th>
                  <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {result.data.items.map((c) => (
                  <tr key={c.id} data-testid={`customer-row-${c.name}`}>
                    <td className="px-3 py-2">
                      <Link href={`/app/customers/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{c.phone ?? "—"}</td>
                    <td className="px-3 py-2">{c.email ?? "—"}</td>
                    <td className="px-3 py-2">{c.documentId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.page}
            pageCount={result.data.pageCount}
            total={result.data.total}
            hrefFor={(page) => withQuery("/app/customers", { q: query.q, page: page === 1 ? "" : page })}
            label="customers"
          />
        </>
      )}
    </>
  );
}
