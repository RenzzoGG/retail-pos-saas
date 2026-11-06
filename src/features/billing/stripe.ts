import "server-only";
import Stripe from "stripe";
import { getStripeConfig } from "@/lib/env";

/** Pinned so a Stripe upgrade never changes the shape of objects under us. */
export const STRIPE_API_VERSION = "2026-10-28.endive" as const;
export const TRIAL_DAYS = 14;

/** Stripe client + price, or null when Stripe isn't configured on this server. */
export function getStripe(): { stripe: Stripe; priceId: string } | null {
  const config = getStripeConfig();
  if (!config) return null;
  return {
    stripe: new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, appInfo: { name: "Stocktill (portfolio demo)" } }),
    priceId: config.priceId,
  };
}

/**
 * Checkout session for the monthly plan. The store id travels in
 * client_reference_id and in the metadata of the session AND the subscription,
 * so every webhook event can be tied back to the store.
 */
export async function createCheckoutSession(input: {
  storeId: string;
  email: string;
  customerId: string | null;
  withTrial: boolean;
  siteUrl: string;
}): Promise<string> {
  const client = getStripe();
  if (!client) throw new Error("stripe_not_configured");
  const session = await client.stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: client.priceId, quantity: 1 }],
    client_reference_id: input.storeId,
    metadata: { store_id: input.storeId },
    subscription_data: {
      metadata: { store_id: input.storeId },
      ...(input.withTrial ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    payment_method_collection: "always",
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
    success_url: `${input.siteUrl}/app/billing?checkout=success`,
    cancel_url: `${input.siteUrl}/app/billing?checkout=canceled`,
  });
  if (!session.url) throw new Error("stripe_no_url");
  return session.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const client = getStripe();
  if (!client) throw new Error("stripe_not_configured");
  const portal = await client.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return portal.url;
}
