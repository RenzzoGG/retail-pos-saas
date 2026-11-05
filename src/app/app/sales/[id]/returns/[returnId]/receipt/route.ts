import { returnReceiptLines } from "@/features/receipts/layout";
import { renderReceiptPdf } from "@/features/receipts/pdf";
import { toReturnReceipt } from "@/features/receipts/receipt-data";
import { loadSaleForReceipt, pdfResponse } from "@/features/receipts/route-helpers";

/** GET /app/sales/:id/returns/:returnId/receipt (?download=1) — 80 mm return receipt. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; returnId: string }> }) {
  const { id, returnId } = await params;
  const loaded = await loadSaleForReceipt(id);
  if ("error" in loaded) return loaded.error;
  const data = toReturnReceipt(loaded.sale, returnId, loaded.store);
  if (!data) return new Response("Not found", { status: 404 });
  const index = loaded.sale.returns.findIndex((r) => r.id === returnId) + 1;
  const pdf = await renderReceiptPdf(returnReceiptLines(data), `Return ${index} of sale #${loaded.sale.number}`);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return pdfResponse(pdf, `return-sale-${loaded.sale.number}-${index}.pdf`, download);
}
