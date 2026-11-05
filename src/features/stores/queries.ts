import "server-only";
import { cache } from "react";
import { requireStoreContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getStoreSettings } from "./service";

/** Active store context + its settings (currency, tax, time zone), once per request. */
export const getActiveStore = cache(async () => {
  const context = await requireStoreContext();
  const settings = await getStoreSettings(await createClient(), context.store.storeId);
  if (!settings.ok) throw new Error("Could not load the store settings.");
  return { ...context, settings: settings.data };
});
