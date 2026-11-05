import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { METHOD_LABELS, STATUS_LABELS } from "@/features/pos/labels";
import { getSale } from "@/features/pos/service";
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

  return (
    <>
      <PageHeader
        title={`Sale #${sale.number}`}
        description={`${formatDateTime(sale.createdAt, settings.timezone)} · by ${sale.cashierName}${sale.customerName ? ` · customer ${sale.customerName}` : ""} · ${STATUS_LABELS[sale.status]}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
                  {manager ? <th scope="col" className="py-2 text-right font-medium">Unit cost</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sale.items.map((i) => (
                  <tr key={i.productId}>
                    <td className="py-2 pr-3">
                      {i.name}
                      <span className="block font-mono text-xs text-slate-500">{i.sku}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(i.unitPrice)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.discount > 0 ? `−${money(i.discount)}` : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(i.lineTotal)}</td>
                    {manager ? <td className="py-2 text-right tabular-nums">{i.unitCost === null ? "—" : money(i.unitCost)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-6">
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
              {manager && sale.profit !== null ? (
                <div className="flex justify-between text-green-700 dark:text-green-400" data-testid="sale-profit">
                  <dt>Profit</dt><dd className="tabular-nums">{money(sale.profit)}</dd>
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
