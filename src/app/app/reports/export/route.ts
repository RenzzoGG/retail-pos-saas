import { cookies } from "next/headers";
import { buildSalesWorkbook, exportFileName, loadExport } from "@/features/reports/export";
import { resolveRange } from "@/features/reports/ranges";
import { getStoreSettings } from "@/features/stores/service";
import { ACTIVE_STORE_COOKIE, getMemberships, getSessionUser } from "@/lib/auth/dal";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /app/reports/export?preset=…&from=…&to=… — owner/admin only. Anyone else
 * gets a real 404 (no hint that the route exists). The SQL functions check the
 * role again, and RLS limits the rows to the active store.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const memberships = await getMemberships();
  const wanted = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value;
  const store = memberships.find((m) => m.storeId === wanted) ?? memberships[0];
  if (!store || !isManager(store.role)) return new Response("Not found", { status: 404 });

  const db = await createClient();
  const settings = await getStoreSettings(db, store.storeId);
  if (!settings.ok) return new Response("Not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const resolved = resolveRange(
    { preset: params.get("preset") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined },
    settings.data.timezone,
  );
  if (!resolved.ok) return new Response(resolved.error, { status: 400 });

  const data = await loadExport(db, store, resolved.range);
  if (!data.ok) return new Response(data.error, { status: data.code === "too_many_rows" ? 413 : 500 });

  const file = buildSalesWorkbook(
    {
      storeName: settings.data.name,
      timeZone: settings.data.timezone,
      currency: settings.data.currency,
      range: resolved.range,
      generatedAt: new Date(),
    },
    data.data,
  );
  return new Response(Buffer.from(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(resolved.range)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
