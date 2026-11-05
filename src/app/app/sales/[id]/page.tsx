import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { METHOD_LABELS, STATUS_LABELS } from "@/features/pos/labels";
import { getSale } from "@/features/pos/service";
import { ReturnForm } from "@/features/returns/components/return-form";
import { getActiveStore } from "@/features/stores/queries";
import { formatMoney } from "@/lib/money";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";

export const metadata: Metadata = { title: "Sale · Stocktill" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, store, settings } = await getActiveStore();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const manager = isManager(store.role);
  const result = await getSale(await createClient(), { userId: user.id, storeId: store.storeId, role: store.role }, id);
  if (!result.ok) return <Alert tone="error">{result.error}</Alert>;
  const sale = result.data;
  if (!sale) notFound();
  const money = (n: number) => formatMoney(n, settings.currency);
  const canReturn = manager && sale.items.some((i) => i.quantity > i.returnedQty);

  return (
    <>
      <PageHeader
        title={`Sale #${sale.number}`}
        description={`${formatDateTime(sale.createdAt, settings.timezone)} · by ${sale.cashierName} · ${STATUS_LABELS[sale.status]}`}
      >
        <div className="flex flex-wrap gap-2">
          <a href={`/app/sales/${sale.id}/receipt`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
            Print receipt
          </a>
          <a href={`/app/sales/${sale.id}/receipt?download=1`} className={buttonClasses("secondary")}>
            Download PDF
          </a>
        </div>
      </PageHeader>
      {sale.customerName ? (
        <p className="-mt-4 mb-6 text-sm text-slate-600 dark:text-slate-400">
          Customer:{" "}
          {sale.customerId ? (
            <Link href={`/app/customers/${sale.customerId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {sale.customerName}
            </Link>
          ) : (
            sale.customerName
          )}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card title="Items">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Items sold</caption>
                <thead className="text-left text-slate-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Product</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Price</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Qty</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Discount</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Total</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Returned</th>
                    {manager ? <th scope="col" className="py-2 text-right font-medium">Unit cost</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sale.items.map((i) => (
                    <tr key={i.saleItemId} data-testid={`sale-item-${i.sku}`}>
                      <td className="py-2 pr-3">
                        {i.name}
                        <span className="block font-mono text-xs text-slate-500">{i.sku}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(i.unitPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{i.quantity}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{i.discount > 0 ? `−${money(i.discount)}` : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(i.lineTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{i.returnedQty > 0 ? i.returnedQty : "—"}</td>
                      {manager ? <td className="py-2 text-right tabular-nums">{i.unitCost === null ? "—" : money(i.unitCost)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Returns" description={sale.returns.length === 0 ? "No returns for this sale." : undefined}>
            {sale.returns.length > 0 ? (
              <ol className="space-y-4" aria-label="Returns of this sale">
                {sale.returns.map((r, index) => (
                  <li key={r.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-700" data-testid="sale-return">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          Return {index + 1} · {formatDateTime(r.createdAt, settings.timezone)} · by {r.createdBy}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Refund {money(r.refundTotal)} ({METHOD_LABELS[r.refundMethod]}){r.reason ? ` · ${r.reason}` : ""}
                        </p>
                      </div>
                      <a href={`/app/sales/${sale.id}/returns/${r.id}/receipt?download=1`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                        Return receipt (PDF)
                      </a>
                    </div>
                    <ul className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                      {r.items.map((it) => (
                        <li key={it.saleItemId}>
                          {it.quantity} × {it.name} — {money(it.refund)}
                          {it.restocked ? "" : <span className="ml-1 text-amber-700 dark:text-amber-400">(not restocked)</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>

          {canReturn ? (
            <Card title="Return items" description="The refund is the items' share of what the customer paid (discounts and tax included).">
              <ReturnForm
                saleId={sale.id}
                currency={settings.currency}
                total={sale.total}
                subtotal={sale.subtotal}
                refunded={sale.refunded}
                defaultMethod={sale.payments[0]?.method ?? "cash"}
                items={sale.items.map((i) => ({
                  saleItemId: i.saleItemId,
                  name: i.name,
                  sku: i.sku,
                  quantity: i.quantity,
                  returnedQty: i.returnedQty,
                  lineTotal: i.lineTotal,
                }))}
              />
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Totals">
            <dl className="space-y-1 text-sm" data-testid="sale-totals">
              <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(sale.subtotal + sale.lineDiscounts)}</dd></div>
              {sale.lineDiscounts + sale.saleDiscount > 0 ? (
                <div className="flex justify-between"><dt>Discounts</dt><dd className="tabular-nums">−{money(sale.lineDiscounts + sale.saleDiscount)}</dd></div>
              ) : null}
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <dt>Tax ({Math.round(sale.taxRate * 10000) / 100}%{sale.pricesIncludeTax ? ", included" : ""})</dt>
                <dd className="tabular-nums">{money(sale.taxTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold dark:border-slate-700">
                <dt>Total</dt><dd className="tabular-nums">{money(sale.total)}</dd>
              </div>
              {sale.refunded > 0 ? (
                <>
                  <div className="flex justify-between text-red-700 dark:text-red-400"><dt>Refunded</dt><dd className="tabular-nums" data-testid="sale-refunded">−{money(sale.refunded)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Net</dt><dd className="tabular-nums">{money(sale.total - sale.refunded)}</dd></div>
                </>
              ) : null}
              {manager && sale.profit !== null ? (
                <div className="flex justify-between text-green-700 dark:text-green-400" data-testid="sale-profit">
                  <dt>Profit{sale.refunded > 0 ? " (after returns)" : ""}</dt><dd className="tabular-nums">{money(sale.profit)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <Card title="Payments">
            <dl className="space-y-1 text-sm">
              {sale.payments.map((p, index) => (
                <div key={`${p.method}-${index}`} className="flex justify-between">
                  <dt>{METHOD_LABELS[p.method]}{p.tendered !== null ? ` (received ${money(p.tendered)})` : ""}</dt>
                  <dd className="tabular-nums">{money(p.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold dark:border-slate-700">
                <dt>Change</dt><dd className="tabular-nums">{money(sale.change)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
