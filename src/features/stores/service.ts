import { isManager, type StoreRole } from "@/lib/permissions";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import type { StoreSettingsInput } from "./schemas";

export type StoreSettings = {
  id: string;
  name: string;
  currency: string;
  taxRate: number;
  pricesIncludeTax: boolean;
  timezone: string;
  maxCashierDiscountPct: number;
  ticketFooter: string | null;
};

/** Creates the store and makes the current user its owner (one atomic SQL call). */
export async function createStore(db: Db, input: StoreSettingsInput): Promise<Result<string>> {
  const { data, error } = await db.rpc("create_store", {
    p_name: input.name,
    p_currency: input.currency,
    p_tax_rate: input.taxRate,
    p_prices_include_tax: input.pricesIncludeTax,
    p_timezone: input.timezone,
  });
  if (error || !data) return fail(error);
  return ok(data);
}

export async function getStoreSettings(db: Db, storeId: string): Promise<Result<StoreSettings>> {
  const { data, error } = await db
    .from("stores")
    .select("id, name, currency, tax_rate, prices_include_tax, timezone, max_cashier_discount_pct, ticket_footer")
    .eq("id", storeId)
    .maybeSingle();
  if (error || !data) return fail(error, "Store not found.");
  return ok({
    id: data.id,
    name: data.name,
    currency: data.currency,
    taxRate: Number(data.tax_rate),
    pricesIncludeTax: data.prices_include_tax,
    timezone: data.timezone,
    maxCashierDiscountPct: Number(data.max_cashier_discount_pct),
    ticketFooter: data.ticket_footer,
  });
}

/** Owner/admin only. RLS and column grants enforce the same rule in the database. */
export async function updateStoreSettings(
  db: Db,
  actor: { storeId: string; role: StoreRole },
  input: StoreSettingsInput,
): Promise<Result<null>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("stores")
    .update({
      name: input.name,
      currency: input.currency,
      tax_rate: input.taxRate,
      prices_include_tax: input.pricesIncludeTax,
      timezone: input.timezone,
      ...(input.cashierDiscountLimit === undefined ? {} : { max_cashier_discount_pct: input.cashierDiscountLimit }),
    })
    .eq("id", actor.storeId)
    .select("id");
  if (error) return fail(error);
  // RLS hides rows you can't update: 0 rows means "not allowed".
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}
