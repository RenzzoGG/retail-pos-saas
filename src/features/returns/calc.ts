/**
 * Refund preview with the same rules as public.create_return:
 *  - each line refunds its share of the sale total:
 *      total x (line_total x qty / sold) / subtotal   (rounded to the cent)
 *    so sale discounts and taxes are prorated;
 *  - the return that completes the sale refunds exactly what is left, and a
 *    return never refunds more than what is left (rounding never over-refunds).
 * The database recomputes it; the screen only previews.
 */
export type ReturnableLine = {
  saleItemId: string;
  soldQty: number;
  returnedQty: number;
  lineTotalCents: number;
};

export type ReturnPreview = {
  lines: { saleItemId: string; quantity: number; refundCents: number }[];
  totalCents: number;
  completesSale: boolean;
  errors: string[];
};

export function previewRefund(
  sale: { totalCents: number; subtotalCents: number; refundedCents: number },
  items: ReturnableLine[],
  request: { saleItemId: string; quantity: number }[],
): ReturnPreview {
  const errors: string[] = [];
  const byId = new Map(items.map((i) => [i.saleItemId, i]));
  const wanted = request.filter((r) => r.quantity > 0);
  const lines = wanted.map((r) => {
    const item = byId.get(r.saleItemId);
    if (!item) {
      errors.push("Unknown item.");
      return { saleItemId: r.saleItemId, quantity: r.quantity, refundCents: 0 };
    }
    if (!Number.isInteger(r.quantity)) errors.push("Quantities are whole units.");
    if (r.quantity > item.soldQty - item.returnedQty) {
      errors.push(`You can return at most ${item.soldQty - item.returnedQty} of an item.`);
    }
    const refund =
      sale.subtotalCents === 0
        ? 0
        : Math.round((sale.totalCents * item.lineTotalCents * r.quantity) / (item.soldQty * sale.subtotalCents));
    return { saleItemId: r.saleItemId, quantity: r.quantity, refundCents: refund };
  });

  let totalCents = lines.reduce((s, l) => s + l.refundCents, 0);
  const left = sale.totalCents - sale.refundedCents;
  const remainingUnits =
    items.reduce((s, i) => s + i.soldQty - i.returnedQty, 0) - wanted.reduce((s, r) => s + r.quantity, 0);
  const completesSale = lines.length > 0 && remainingUnits === 0;
  if (lines.length > 0 && (completesSale || totalCents > left)) {
    const last = lines[lines.length - 1] as (typeof lines)[number];
    last.refundCents = Math.max(0, last.refundCents + (left - totalCents));
    totalCents = left;
  }
  return { lines, totalCents, completesSale, errors: [...new Set(errors)] };
}
