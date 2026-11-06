import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { updateStoreSettingsAction } from "@/features/stores/actions";
import { StoreSettingsForm } from "@/features/stores/components/store-settings-form";
import { getStoreSettings } from "@/features/stores/service";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings · Stocktill" };

export default async function SettingsPage() {
  const { store } = await requireRole(["owner", "admin"]);
  const settings = await getStoreSettings(await createClient(), store.storeId);
  return (
    <>
      <PageHeader title="Settings" description="Store name, currency, tax and receipt note. Past sales keep the settings they were made with." />
      <Card>
        {settings.ok ? (
          <StoreSettingsForm
            action={updateStoreSettingsAction}
            defaults={{
              name: settings.data.name,
              currency: settings.data.currency,
              taxRatePercent: String(Math.round(settings.data.taxRate * 10000) / 100),
              pricesIncludeTax: settings.data.pricesIncludeTax,
              timezone: settings.data.timezone,
              cashierDiscountLimit: String(settings.data.maxCashierDiscountPct),
              ticketFooter: settings.data.ticketFooter ?? "",
            }}
            submitLabel="Save settings"
            pendingText="Saving…"
          />
        ) : (
          <Alert tone="error">{settings.error}</Alert>
        )}
      </Card>
    </>
  );
}
