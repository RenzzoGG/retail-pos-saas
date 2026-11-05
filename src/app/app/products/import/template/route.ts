import { buildTemplate } from "@/features/import/parse";
import { getMemberships, getSessionUser } from "@/lib/auth/dal";
import { isManager } from "@/lib/permissions";

/** GET /app/products/import/template?format=xlsx|csv — owner/admin only. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const memberships = await getMemberships();
  if (!memberships.some((m) => isManager(m.role))) return new Response("Not found", { status: 404 });

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const body = buildTemplate(format);
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stocktill-products-template.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
