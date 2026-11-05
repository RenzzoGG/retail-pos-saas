import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { PosTerminal } from "@/features/pos/components/pos-terminal";
import { getActiveStore } from "@/features/stores/queries";
import { isManager } from "@/lib/permissions";

export const metadata: Metadata = { title: "POS · Stocktill" };

export default async function PosPage() {
  const { store, settings } = await getActiveStore();
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
