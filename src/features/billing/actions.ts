"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { isCurrent } from "./access";
import { getSubscription } from "./service";
import { createCheckoutSession, createPortalSession, getStripe } from "./stripe";

export type BillingState = { message: string | null };

/** Owner only: starts Stripe Checkout (14-day trial the first time). */
export async function startCheckoutAction(): Promise<BillingState> {
  const { user, store } = await requireRole(["owner"]);
  if (!getStripe()) return { message: "Stripe isn't configured on this server yet (see docs/STRIPE.md)." };
  const sub = await getSubscription(await createClient(), store.storeId);
  if (!sub.ok) return { message: sub.error };
  if (isCurrent(sub.data)) {
    return {
      message: sub.data?.stripeCustomerId
        ? "This store already has a subscription. Use “Manage billing” to change it."
        : "This store has a complimentary demo plan; there is nothing to pay.",
    };
  }
  let url: string;
  try {
    url = await createCheckoutSession({
      storeId: store.storeId,
      email: user.email,
      customerId: sub.data?.stripeCustomerId ?? null,
      // One free trial per store: none if it ever had a Stripe subscription.
      withTrial: !sub.data?.stripeSubscriptionId,
      siteUrl: getSiteUrl(),
    });
  } catch (error) {
    console.error("Stripe Checkout failed:", error instanceof Error ? error.message : error);
    return { message: "Stripe Checkout couldn't be started. Try again in a moment." };
  }
  redirect(url);
}

/** Owner only: opens the Stripe Billing Portal (card, cancel, invoices). */
export async function openPortalAction(): Promise<BillingState> {
  const { store } = await requireRole(["owner"]);
  if (!getStripe()) return { message: "Stripe isn't configured on this server yet (see docs/STRIPE.md)." };
  const sub = await getSubscription(await createClient(), store.storeId);
  if (!sub.ok) return { message: sub.error };
  const customerId = sub.data?.stripeCustomerId;
  if (!customerId) return { message: "This store has no Stripe customer yet. Start the free trial first." };
  let url: string;
  try {
    url = await createPortalSession(customerId, `${getSiteUrl()}/app/billing`);
  } catch (error) {
    console.error("Stripe Portal failed:", error instanceof Error ? error.message : error);
    return { message: "The billing portal couldn't be opened. Try again in a moment." };
  }
  redirect(url);
}
