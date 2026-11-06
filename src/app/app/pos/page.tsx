import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { ACCESS_MESSAGES, accessFor, canSell } from "@/features/billing/access";
import { getSubscription } from "@/features/billing/service";
import { PosTerminal } from "@/features/pos/components/pos-terminal";
import { getActiveStore } from "@/features/stores/queries";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "POS · Stocktill" };

export default async function PosPage() {
  const { store, settings } = await getActiveStore();
  const sub = await getSubscription(await createClient(), store.storeId);
  const sellable = sub.ok && canSell(accessFor(sub.data?.status));
  if (!sellable) {
    return (
      <>
        <PageHeader title="Point of sale" description={store.storeName} />
        <div role="status" data-testid="pos-blocked" className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">The register is closed.</p>
          <p className="mt-1 text-sm">{ACCESS_MESSAGES.sell}</p>
          {store.role === "owner" ? (
            <Link href="/app/billing" className="mt-3 inline-block text-sm font-semibold underline">
              Go to Billing
            </Link>
          ) : null}
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Point of sale"
        description={`${store.storeName} · prices in ${settings.currency}${settings.pricesIncludeTax ? " (tax included)" : ""}`}
      />
      <PosTerminal
        storeId={store.storeId}
        currency={settings.currency}
        taxRate={settings.taxRate}
        pricesIncludeTax={settings.pricesIncludeTax}
        discountLimitPct={isManager(store.role) ? null : settings.maxCashierDiscountPct}
      />
    </>
  );
}
