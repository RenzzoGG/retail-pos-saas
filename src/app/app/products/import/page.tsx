import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { COLUMNS } from "@/features/import/columns";
import { ImportWizard } from "@/features/import/components/import-wizard";
import { listImports } from "@/features/import/service";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { getActiveStore } from "@/features/stores/queries";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";

export const metadata: Metadata = { title: "Import products · Stocktill" };

export default async function ImportProductsPage() {
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  const history = await listImports(await createClient(), { userId: user.id, storeId: store.storeId, role: store.role });

  return (
    <>
      <PageHeader
        title="Import products"
        description="Load your catalog from Excel or CSV. You'll see a preview with any errors before anything is saved."
      />
      <ProductsTabs current="import" />
      <div className="space-y-6">
        <Card title="1. Get the template" description="Fill one product per row. Columns can be in any order.">
          <div className="mb-4 flex flex-wrap gap-3">
            <a href="/app/products/import/template?format=xlsx" className={buttonClasses("secondary")} download>
              Download template (.xlsx)
            </a>
            <a href="/app/products/import/template?format=csv" className={buttonClasses("secondary")} download>
              Download template (.csv)
            </a>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {COLUMNS.map((c) => (
              <div key={c.key}>
                <dt className="font-medium text-slate-900 dark:text-white">
                  {c.header}
                  {c.required ? <span className="ml-1 text-red-600" aria-label="required">*</span> : null}
                </dt>
                <dd className="text-slate-600 dark:text-slate-400">{c.help}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="2. Upload and review" description={`Prices in ${settings.currency}. Nothing is saved until you confirm.`}>
          <ImportWizard />
        </Card>

        <Card title="Recent imports" description={`Times in ${settings.timezone.replaceAll("_", " ")}.`}>
          {!history.ok ? (
            <Alert tone="error">{history.error}</Alert>
          ) : history.data.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Recent imports</caption>
                <thead className="text-left text-slate-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                    <th scope="col" className="py-2 pr-3 font-medium">File</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Created</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Updated</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Skipped</th>
                    <th scope="col" className="py-2 pr-3 font-medium">By</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">Stock entry</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {history.data.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(b.createdAt, settings.timezone)}</td>
                      <td className="py-2 pr-3">{b.fileName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{b.created}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{b.updated}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{b.skipped}</td>
                      <td className="py-2 pr-3">{b.createdBy}</td>
                      <td className="py-2">
                        {b.stockEntryId ? (
                          <Link href={`/app/products/entries/${b.stockEntryId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            Stock entry
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
