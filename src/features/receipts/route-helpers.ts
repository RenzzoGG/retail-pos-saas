import "server-only";
import { getSale } from "@/features/pos/service";
import { getStoreSettings } from "@/features/stores/service";
import { cookies } from "next/headers";
import { ACTIVE_STORE_COOKIE, getMemberships, getSessionUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Loads a sale for a receipt as the signed-in user (RLS applies) in their
 * active store. Returns a Response for errors.
 */
export async function loadSaleForReceipt(saleId: string) {
  const user = await getSessionUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) };
  if (!UUID.test(saleId)) return { error: new Response("Not found", { status: 404 }) };
  const memberships = await getMemberships();
  const wanted = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value;
  const membership = memberships.find((m) => m.storeId === wanted) ?? memberships[0];
  if (!membership) return { error: new Response("Not found", { status: 404 }) };

  const db = await createClient();
  const [sale, settings] = await Promise.all([
    getSale(db, { userId: user.id, storeId: membership.storeId, role: membership.role }, saleId),
    getStoreSettings(db, membership.storeId),
  ]);
  if (!sale.ok || !sale.data || !settings.ok) return { error: new Response("Not found", { status: 404 }) };
  return { sale: sale.data, store: { name: settings.data.name, settings: settings.data } };
}

export function pdfResponse(pdf: Buffer, fileName: string, download: boolean): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
