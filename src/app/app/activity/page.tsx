import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { parseActivityQuery } from "@/features/activity/schemas";
import { listActivity } from "@/features/activity/service";
import { getActiveStore } from "@/features/stores/queries";
import { listMembers } from "@/features/team/service";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/timezone";
import { withQuery } from "@/lib/url";

export const metadata: Metadata = { title: "Activity · Stocktill" };

const CONTROL =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "block text-sm font-medium text-slate-800 dark:text-slate-200";
const ACTION_LABELS = { insert: "Created", update: "Updated", delete: "Removed" } as const;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseActivityQuery(await searchParams);
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  const db = await createClient();
  const actor = { userId: user.id, storeId: store.storeId, role: store.role };
  const [activity, members] = await Promise.all([listActivity(db, actor, query, settings.timezone), listMembers(db, actor)]);
  const filtered = Boolean(query.actor || query.action || query.from || query.to);

  return (
    <>
      <PageHeader
        title="Activity"
        description={`Who created, changed or removed what. Read-only. Times in ${settings.timezone.replaceAll("_", " ")}.`}
      />

      <form method="get" action="/app/activity" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" aria-label="Filter activity">
        <div>
          <label htmlFor="activity-actor" className={LABEL}>User</label>
          <select id="activity-actor" name="actor" defaultValue={query.actor ?? ""} className={CONTROL}>
            <option value="">Everyone</option>
            {members.ok
              ? members.data.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </option>
                ))
              : null}
            <option value="system">System</option>
          </select>
        </div>
        <div>
          <label htmlFor="activity-action" className={LABEL}>Action</label>
          <select id="activity-action" name="action" defaultValue={query.action ?? ""} className={CONTROL}>
            <option value="">All actions</option>
            <option value="insert">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Removed</option>
          </select>
        </div>
        <div>
          <label htmlFor="activity-from" className={LABEL}>From</label>
          <input id="activity-from" name="from" type="date" defaultValue={query.from} className={CONTROL} />
        </div>
        <div>
          <label htmlFor="activity-to" className={LABEL}>To</label>
          <input id="activity-to" name="to" type="date" defaultValue={query.to} className={CONTROL} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("secondary")}>Apply</button>
          {filtered ? (
            <Link href="/app/activity" className={buttonClasses("ghost")}>Clear</Link>
          ) : null}
        </div>
      </form>

      {!activity.ok ? (
        <Alert tone="error">{activity.error}</Alert>
      ) : activity.data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {filtered ? "No activity matches these filters." : "No activity yet."}
        </p>
      ) : (
        <>
          <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900" aria-label="Activity">
            {activity.data.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="activity-item">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{item.title}</p>
                  {item.details.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-sm text-slate-600 dark:text-slate-400">
                      {item.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="text-sm text-slate-600 sm:text-right dark:text-slate-400">
                  <p>
                    <span className="sr-only">{ACTION_LABELS[item.action]} by </span>
                    {item.actorName}
                  </p>
                  <p className="text-xs">
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt, settings.timezone)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <Pagination
            page={activity.data.page}
            pageCount={activity.data.pageCount}
            total={activity.data.total}
            hrefFor={(page) => withQuery("/app/activity", { ...query, page: page === 1 ? "" : page })}
            label="events"
          />
        </>
      )}
    </>
  );
}
