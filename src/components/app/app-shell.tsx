import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/features/auth/actions";
import { requireStoreContext } from "@/lib/auth/dal";
import { ROLE_LABELS, navForRole } from "@/lib/permissions";
import { SidebarNav } from "./sidebar-nav";
import { StoreSwitcher } from "./store-switcher";

/** Session-dependent chrome of the private area (rendered inside <Suspense>). */
export async function AppShell({ children }: { children: ReactNode }) {
  const { user, store, memberships } = await requireStoreContext();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white p-4 md:w-64 md:shrink-0 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between md:block">
          <Link href="/app" className="rounded text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            Stocktill
          </Link>
        </div>
        <div className="my-4 space-y-1">
          {memberships.length > 1 ? (
            <StoreSwitcher memberships={memberships} activeStoreId={store.storeId} />
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Store</p>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{store.storeName}</p>
            </>
          )}
          <p className="text-xs text-slate-500" data-testid="current-role">
            Your role: {ROLE_LABELS[store.role]}
          </p>
        </div>
        <SidebarNav items={navForRole(store.role)} />
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="truncate text-xs text-slate-500" title={user.email}>
            {user.email}
          </p>
          <form action={signOut} className="mt-2">
            <button
              type="submit"
              className="rounded text-sm font-medium text-slate-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-slate-300"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main id="main" className="flex-1 bg-slate-50 p-4 md:p-8 dark:bg-slate-950">
        {children}
      </main>
    </div>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row" aria-busy="true">
      <aside className="border-b border-slate-200 bg-white p-4 md:w-64 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-lg font-bold tracking-tight">Stocktill</p>
      </aside>
      <main className="flex-1 bg-slate-50 p-8 dark:bg-slate-950">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    </div>
  );
}
