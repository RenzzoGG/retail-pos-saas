import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/timezone";

/**
 * Receipt content as plain lines for a monospace 80 mm thermal receipt.
 * The input types have NO cost fields: a receipt can never show costs or
 * profit, whoever prints it.
 */
export const COLUMNS = 42;

export type ReceiptLine = { text: string; bold?: boolean; center?: boolean; size?: "normal" | "large" };

export type SaleReceiptData = {
  storeName: string;
  footer: string | null;
  timeZone: string;
  currency: string;
  number: number;
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  items: { name: string; sku: string; quantity: number; unitPrice: number; discount: number; lineTotal: number }[];
  /** Before any discount. */
  grossSubtotal: number;
  lineDiscounts: number;
  saleDiscount: number;
  taxRate: number;
  pricesIncludeTax: boolean;
  taxTotal: number;
  total: number;
  payments: { method: "cash" | "card" | "transfer"; amount: number; tendered: number | null; change: number }[];
  change: number;
  returns: { createdAt: string; refund: number; method: "cash" | "card" | "transfer"; units: number }[];
};

export type ReturnReceiptData = {
  storeName: string;
  timeZone: string;
  currency: string;
  saleNumber: number;
  createdAt: string;
  createdBy: string;
  reason: string | null;
  refundMethod: "cash" | "card" | "transfer";
  refundTotal: number;
  items: { name: string; sku: string; quantity: number; refund: number; restocked: boolean }[];
};

const METHOD = { cash: "Cash", card: "Card", transfer: "Transfer" } as const;
const RULE: ReceiptLine = { text: "-".repeat(COLUMNS) };

/** "Label ........ value" on one line; the label is cut if needed. */
export function columns(left: string, right: string, width = COLUMNS): string {
  const room = width - right.length - 1;
  const label = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}…` : left;
  return `${label}${" ".repeat(Math.max(1, width - label.length - right.length))}${right}`;
}

/** Word wrap for long names. */
export function wrap(text: string, width = COLUMNS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const piece = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    if (!line) line = piece;
    else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
    else {
      out.push(line);
      line = piece;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

const percent = (rate: number) => `${Math.round(rate * 10000) / 100}%`;

export function saleReceiptLines(r: SaleReceiptData): ReceiptLine[] {
  const money = (n: number) => formatMoney(n, r.currency);
  const lines: ReceiptLine[] = [
    { text: r.storeName, bold: true, center: true, size: "large" },
    { text: `Sale #${r.number}`, center: true },
    { text: formatDateTime(r.createdAt, r.timeZone), center: true },
    { text: `Cashier: ${r.cashierName}`, center: true },
  ];
  if (r.customerName) lines.push({ text: `Customer: ${r.customerName}`, center: true });
  lines.push(RULE);

  for (const item of r.items) {
    for (const part of wrap(item.name)) lines.push({ text: part });
    lines.push({ text: columns(`  ${item.quantity} x ${money(item.unitPrice)}`, money(item.quantity * item.unitPrice)) });
    if (item.discount > 0) lines.push({ text: columns("  Discount", `-${money(item.discount)}`) });
  }
  lines.push(RULE);

  lines.push({ text: columns("Subtotal", money(r.grossSubtotal)) });
  if (r.lineDiscounts + r.saleDiscount > 0) lines.push({ text: columns("Discounts", `-${money(r.lineDiscounts + r.saleDiscount)}`) });
  lines.push({
    text: columns(`Tax ${percent(r.taxRate)}${r.pricesIncludeTax ? " (included)" : ""}`, money(r.taxTotal)),
  });
  lines.push({ text: columns("TOTAL", money(r.total)), bold: true, size: "large" });
  lines.push(RULE);

  for (const p of r.payments) {
    lines.push({ text: columns(METHOD[p.method], money(p.amount)) });
    if (p.tendered !== null) lines.push({ text: columns("  Cash received", money(p.tendered)) });
  }
  lines.push({ text: columns("Change", money(r.change)), bold: true });

  if (r.returns.length > 0) {
    lines.push(RULE, { text: "RETURNS", bold: true, center: true });
    let refunded = 0;
    for (const ret of r.returns) {
      refunded += Math.round(ret.refund * 100);
      lines.push({ text: formatDateTime(ret.createdAt, r.timeZone) });
      lines.push({ text: columns(`  ${ret.units} item${ret.units === 1 ? "" : "s"}, ${METHOD[ret.method]}`, `-${money(ret.refund)}`) });
    }
    lines.push({ text: columns("Net total", money((Math.round(r.total * 100) - refunded) / 100)), bold: true });
  }

  lines.push(RULE);
  if (r.footer) for (const part of wrap(r.footer)) lines.push({ text: part, center: true });
  lines.push({ text: "Thank you!", center: true });
  return lines;
}

export function returnReceiptLines(r: ReturnReceiptData): ReceiptLine[] {
  const money = (n: number) => formatMoney(n, r.currency);
  const lines: ReceiptLine[] = [
    { text: r.storeName, bold: true, center: true, size: "large" },
    { text: "RETURN RECEIPT", bold: true, center: true },
    { text: `For sale #${r.saleNumber}`, center: true },
    { text: formatDateTime(r.createdAt, r.timeZone), center: true },
    { text: `By: ${r.createdBy}`, center: true },
    RULE,
  ];
  for (const item of r.items) {
    for (const part of wrap(item.name)) lines.push({ text: part });
    lines.push({ text: columns(`  ${item.quantity} returned`, `-${money(item.refund)}`) });
    if (!item.restocked) lines.push({ text: "  Not restocked (damaged)" });
  }
  lines.push(RULE);
  if (r.reason) {
    lines.push({ text: "Reason:" });
    for (const part of wrap(r.reason)) lines.push({ text: part });
  }
  lines.push({ text: columns(`REFUND (${METHOD[r.refundMethod]})`, money(r.refundTotal)), bold: true, size: "large" });
  lines.push(RULE, { text: "Keep this receipt.", center: true });
  return lines;
}
