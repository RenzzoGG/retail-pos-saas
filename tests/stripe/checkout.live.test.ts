import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCheckoutSession, getStripe } from "@/features/billing/stripe";

/**
 * Real Stripe, TEST mode only. Skipped without STRIPE_SECRET_KEY=sk_test_… and
 * STRIPE_PRICE_ID (CI has neither). Nothing is charged: the Checkout session is
 * created and then expired, without paying.
 */
const key = process.env.STRIPE_SECRET_KEY ?? "";
const enabled = key.startsWith("sk_test_") && !!process.env.STRIPE_PRICE_ID && !process.env.STRIPE_PRICE_ID.includes("example");

describe.skipIf(!enabled)("Stripe test mode (live API)", () => {
  it("the configured price is the 19 USD monthly plan", async () => {
    const client = getStripe();
    if (!client) throw new Error("Stripe not configured");
    const price = await client.stripe.prices.retrieve(client.priceId);
    expect(price).toMatchObject({ currency: "usd", unit_amount: 1900, active: true, recurring: { interval: "month" } });
  });

  it("creates a subscription Checkout session for a store, with the store id attached", async () => {
    const client = getStripe();
    if (!client) throw new Error("Stripe not configured");
    const storeId = randomUUID();
    const url = await createCheckoutSession({ storeId, email: "checkout-test@example.com", customerId: null, withTrial: true, siteUrl: "http://localhost:3000" });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const sessions = await client.stripe.checkout.sessions.list({ limit: 5 });
    const session = sessions.data.find((s) => s.client_reference_id === storeId);
    expect(session).toMatchObject({ mode: "subscription", status: "open", metadata: { store_id: storeId } });
    await client.stripe.checkout.sessions.expire(session!.id); // clean up, nothing paid
  });
});
