import type { SaleDetail } from "@/features/pos/service";
import type { StoreSettings } from "@/features/stores/service";
import type { ReturnReceiptData, SaleReceiptData } from "./layout";

/**
 * Copies, field by field, only what a receipt prints. SaleDetail may carry
 * costs and profit (for owners/admins); they are never copied here.
 */
export function toSaleReceipt(sale: SaleDetail, store: { name: string; settings: StoreSettings }): SaleReceiptData {
  return {
    storeName: store.name,
    footer: store.settings.ticketFooter,
    timeZone: store.settings.timezone,
    currency: store.settings.currency,
    number: sale.number,
    createdAt: sale.createdAt,
    cashierName: sale.cashierName,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      lineTotal: i.lineTotal,
    })),
    grossSubtotal: (Math.round(sale.subtotal * 100) + Math.round(sale.lineDiscounts * 100)) / 100,
    lineDiscounts: sale.lineDiscounts,
    saleDiscount: sale.saleDiscount,
    taxRate: sale.taxRate,
    pricesIncludeTax: sale.pricesIncludeTax,
    taxTotal: sale.taxTotal,
    total: sale.total,
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, change: p.change })),
    change: sale.change,
    returns: sale.returns.map((r) => ({
      createdAt: r.createdAt,
      refund: r.refundTotal,
      method: r.refundMethod,
      units: r.items.reduce((s, i) => s + i.quantity, 0),
    })),
  };
}

export function toReturnReceipt(
  sale: SaleDetail,
  returnId: string,
  store: { name: string; settings: StoreSettings },
): ReturnReceiptData | null {
  const ret = sale.returns.find((r) => r.id === returnId);
  if (!ret) return null;
  return {
    storeName: store.name,
    timeZone: store.settings.timezone,
    currency: store.settings.currency,
    saleNumber: sale.number,
    createdAt: ret.createdAt,
    createdBy: ret.createdBy,
    reason: ret.reason,
    refundMethod: ret.refundMethod,
    refundTotal: ret.refundTotal,
    items: ret.items.map((i) => ({ name: i.name, sku: i.sku, quantity: i.quantity, refund: i.refund, restocked: i.restocked })),
  };
}
