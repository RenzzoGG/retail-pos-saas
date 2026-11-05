import { isManager, type StoreRole } from "@/lib/permissions";
import { getProfileNames } from "@/lib/services/profiles";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import { zonedDayEndUtc, zonedDayStartUtc } from "@/lib/timezone";
import { type ActivityDescription, describeActivity } from "./describe";
import type { ActivityQuery } from "./schemas";

export const ACTIVITY_PAGE_SIZE = 25;

export type ActivityEntry = ActivityDescription & {
  id: number;
  createdAt: string;
  action: "insert" | "update" | "delete";
  actorName: string;
};

/**
 * Read-only audit trail for owner/admin. Date filters are whole days in the
 * store's time zone ("to" is inclusive: we filter < start of the next day).
 */
export async function listActivity(
  db: Db,
  actor: { storeId: string; role: StoreRole },
  query: ActivityQuery,
  timeZone: string,
  pageSize = ACTIVITY_PAGE_SIZE,
): Promise<Result<{ items: ActivityEntry[]; total: number; page: number; pageCount: number }>> {
  if (!isManager(actor.role)) return forbidden();

  let request = db
    .from("activity_log")
    .select("id, created_at, actor_id, table_name, action, before, after", { count: "exact" })
    .eq("store_id", actor.storeId);
  if (query.actor === "system") request = request.is("actor_id", null);
  else if (query.actor) request = request.eq("actor_id", query.actor);
  if (query.action) request = request.eq("action", query.action);
  if (query.from) request = request.gte("created_at", zonedDayStartUtc(query.from, timeZone).toISOString());
  if (query.to) request = request.lt("created_at", zonedDayEndUtc(query.to, timeZone).toISOString());

  const from = (query.page - 1) * pageSize;
  const { data, error, count } = await request.order("id", { ascending: false }).range(from, from + pageSize - 1);
  if (error) return fail(error);

  const rows = data ?? [];
  const names = await getProfileNames(db, rows.map((r) => r.actor_id));
  const total = count ?? 0;
  return ok({
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      action: r.action,
      actorName: r.actor_id ? (names.get(r.actor_id) ?? "Former member") : "System",
      ...describeActivity({
        tableName: r.table_name,
        action: r.action,
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
      }),
    })),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}
