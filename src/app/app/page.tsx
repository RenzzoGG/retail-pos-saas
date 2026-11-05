import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { requireStoreContext } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dashboard · Stocktill" };

export default async function DashboardPage() {
  const { store } = await requireStoreContext();
  return (
    <>
      <PageHeader title="Dashboard" description={`${store.storeName} · signed in as ${ROLE_LABELS[store.role]}`} />
      <Card title="Welcome to Stocktill" description="Sales charts and best sellers arrive in phase 8.">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Use the menu to manage your team and store settings. Sections that are not ready yet show “Coming soon”.
        </p>
      </Card>
    </>
  );
}
