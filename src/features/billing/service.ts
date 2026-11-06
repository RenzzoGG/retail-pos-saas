import { type Db, type Result, fail, ok } from "@/lib/services/result";
import { ACCESS_MESSAGES, type SubscriptionInfo, accessFor, canEdit, canSell } from "./access";

/** The store's subscription, read as the user (RLS: members of the store). null = none yet. */
export async function getSubscription(db: Db, storeId: string): Promise<Result<SubscriptionInfo | null>> {
  const { data, error } = await db
    .from("subscriptions")
    .select("status, stripe_customer_id, stripe_subscription_id, trial_end, current_period_end, cancel_at_period_end")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return ok(null);
  return ok({
    status: data.status,
    stripeCustomerId: data.stripe_customer_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    trialEnd: data.trial_end,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  });
}

/**
 * Server-side check before a write (the database triggers enforce the same rule).
 * "sell": sales and returns need full access. "edit": catalog, stock, imports and
 * customers also work in setup mode, but not when read-only.
 */
export async function checkAccess(db: Db, storeId: string, need: "sell" | "edit"): Promise<Result<null>> {
  const sub = await getSubscription(db, storeId);
  if (!sub.ok) return sub;
  const access = accessFor(sub.data?.status);
  const allowed = need === "sell" ? canSell(access) : canEdit(access);
  return allowed ? ok(null) : { ok: false, error: ACCESS_MESSAGES[need], code: "subscription_inactive" };
}
