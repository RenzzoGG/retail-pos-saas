import { saleReceiptLines } from "@/features/receipts/layout";
import { renderReceiptPdf } from "@/features/receipts/pdf";
import { toSaleReceipt } from "@/features/receipts/receipt-data";
import { loadSaleForReceipt, pdfResponse } from "@/features/receipts/route-helpers";

/** GET /app/sales/:id/receipt (?download=1) — 80 mm sale receipt, any member. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadSaleForReceipt(id);
  if ("error" in loaded) return loaded.error;
  const pdf = await renderReceiptPdf(saleReceiptLines(toSaleReceipt(loaded.sale, loaded.store)), `Sale #${loaded.sale.number}`);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return pdfResponse(pdf, `receipt-sale-${loaded.sale.number}.pdf`, download);
}
