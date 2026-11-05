import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { deleteCustomerAction, updateCustomerAction } from "@/features/customers/actions";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { DeleteCustomerButton } from "@/features/customers/components/delete-customer-button";
import { getCustomer } from "@/features/customers/service";
import { STATUS_LABELS } from "@/features/pos/labels";
import { getActiveStore } from "@/features/stores/queries";
import { formatMoney } from "@/lib/money";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";

export const metadata: Metadata = { title: "Customer · Stocktill" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function CustomerPage({ params, searchParams }: Props) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const { store, settings } = await getActiveStore();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await getCustomer(await createClient(), store.storeId, id);
  if (!result.ok) return <Alert tone="error">{result.error}</Alert>;
  const c = result.data;
  if (!c) notFound();
  const money = (n: number) => formatMoney(n, settings.currency);
  const returns = c.purchases.flatMap((p) => p.returns.map((r) => ({ ...r, saleId: p.id, number: p.number })));

  return (
    <>
      <PageHeader title={c.name} description={c.archived ? "Archived customer (kept for their purchase history)." : "Customer"} />
      {created ? (
        <div className="mb-4">
          <Alert tone="success">Customer created.</Alert>
        </div>
      ) : null}

      <dl className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Purchases", value: String(c.purchaseCount), testid: "customer-purchases" },
          { label: "Total spent", value: money(c.totalSpent), testid: "customer-spent" },
          { label: "Last purchase", value: c.lastPurchaseAt ? formatDateTime(c.lastPurchaseAt, settings.timezone) : "—", testid: "customer-last" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums" data-testid={s.testid}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card title="Purchases" description={`Times in ${settings.timezone.replaceAll("_", " ")}. Total spent subtracts refunds.`}>
            {c.purchases.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <caption className="sr-only">Purchases of {c.name}</caption>
                  <thead className="text-left text-slate-600 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium">Sale</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Total</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Refunded</th>
                      <th scope="col" className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {c.purchases.map((p) => (
                      <tr key={p.id} data-testid={`customer-sale-${p.number}`}>
                        <td className="py-2 pr-3">
                          <Link href={`/app/sales/${p.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">#{p.number}</Link>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(p.createdAt, settings.timezone)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{money(p.total)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.refunded > 0 ? `−${money(p.refunded)}` : "—"}</td>
                        <td className="py-2">{STATUS_LABELS[p.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Returns">
            {returns.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">No returns.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {returns.map((r) => (
                  <li key={`${r.saleId}-${r.createdAt}`}>
                    {formatDateTime(r.createdAt, settings.timezone)} · sale{" "}
                    <Link href={`/app/sales/${r.saleId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">#{r.number}</Link> · refund {money(r.refund)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          {c.archived ? (
            <Alert tone="info">Archived customers can&apos;t be edited or used in new sales.</Alert>
          ) : (
            <Card title="Details">
              <CustomerForm
                action={updateCustomerAction.bind(null, c.id)}
                submitLabel="Save customer"
                defaults={{ name: c.name, documentId: c.documentId ?? "", phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "" }}
              />
              {isManager(store.role) ? (
                <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-800">
                  <DeleteCustomerButton action={deleteCustomerAction.bind(null, c.id)} name={c.name} hasSales={c.purchaseCount > 0} />
                </div>
              ) : null}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
