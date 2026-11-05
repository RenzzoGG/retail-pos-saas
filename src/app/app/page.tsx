import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { countLowStock } from "@/features/inventory/service";
import { requireStoreContext } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard · Stocktill" };

export default async function DashboardPage() {
  const { store } = await requireStoreContext();
  const lowStock = await countLowStock(await createClient(), store.storeId);
  return (
    <>
      <PageHeader title="Dashboard" description={`${store.storeName} · signed in as ${ROLE_LABELS[store.role]}`} />
      <div className="space-y-6">
        {lowStock > 0 ? (
          <div
            role="status"
            data-testid="low-stock-alert"
            className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            <p className="text-sm font-medium">
              {lowStock} {lowStock === 1 ? "product is" : "products are"} low on stock.
            </p>
            <Link href="/app/products?low=1" className="text-sm font-semibold underline">
              View low-stock products
            </Link>
          </div>
        ) : (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
            All products are above their low-stock threshold.
          </p>
        )}
        <Card title="Welcome to Stocktill" description="Sales charts and best sellers arrive in phase 8.">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Use the menu to manage products, your team and store settings. Sections that are not ready yet show “Coming soon”.
          </p>
        </Card>
      </div>
    </>
  );
}
