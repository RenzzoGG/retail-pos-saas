import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { accessFor, canEdit, canSell, isCurrent, statusLabel, trialDaysLeft, type SubscriptionInfo } from "@/features/billing/access";
import { toChange, verifyEvent } from "@/features/billing/webhook";
import { getStripeConfig, getStripeWebhookSecret } from "@/lib/env";
import { navForRole } from "@/lib/permissions";

/** Invented for these tests: NOT a real webhook secret. */
const SECRET = "whsec_unit_test_invented_secret";
const STORE = "2d000000-0000-4000-8000-000000000002";

function signed(payload: object, opts: { secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret ?? SECRET, ...(opts.timestamp ? { timestamp: opts.timestamp } : {}) });
  return { body, header };
}

const event = (type: string, object: object, created = 1_793_000_000) => ({ id: `evt_${type}_${created}`, object: "event", type, created, data: { object } });

const subscription = (over: object = {}) => ({
  id: "sub_123",
  object: "subscription",
  customer: "cus_123",
  status: "trialing",
  trial_end: 1_794_000_000,
  cancel_at_period_end: false,
  metadata: { store_id: STORE },
  items: { data: [{ price: { id: "price_123" }, current_period_end: 1_794_000_000 }] },
  ...over,
});

describe("Stripe webhook: signature", () => {
  it("accepts an event signed with the endpoint secret", () => {
    const { body, header } = signed(event("customer.subscription.created", subscription()));
    expect(verifyEvent(body, header, SECRET).type).toBe("customer.subscription.created");
  });

  it("rejects a missing signature, another secret, a tampered body and an old timestamp", () => {
    const { body, header } = signed(event("customer.subscription.created", subscription()));
    expect(() => verifyEvent(body, null, SECRET)).toThrow();
    expect(() => verifyEvent(body, header, "whsec_some_other_invented_secret")).toThrow();
    expect(() => verifyEvent(body.replace("trialing", "active"), header, SECRET)).toThrow();
    const old = signed(event("customer.subscription.created", subscription()), { timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect(() => verifyEvent(old.body, old.header, SECRET)).toThrow(); // > 5 min tolerance (replay)
    expect(() => verifyEvent(body, "t=1,v1=deadbeef", SECRET)).toThrow();
  });
});

describe("Stripe webhook: event -> change", () => {
  const change = (e: object) => toChange(e as unknown as Stripe.Event);

  it("checkout.session.completed only links store, customer and subscription", () => {
    expect(change(event("checkout.session.completed", { mode: "subscription", client_reference_id: STORE, customer: "cus_1", subscription: "sub_1", metadata: {} }))).toEqual({
      store_id: STORE,
      customer_id: "cus_1",
      subscription_id: "sub_1",
    });
    expect(change(event("checkout.session.completed", { mode: "payment", client_reference_id: STORE }))).toBeNull();
    expect(change(event("checkout.session.completed", { mode: "subscription", client_reference_id: "not-a-uuid", metadata: {} }))).toBeNull();
  });

  it("subscription created/updated carry the full state (period from the item)", () => {
    expect(change(event("customer.subscription.updated", subscription({ status: "past_due", cancel_at_period_end: true })))).toEqual({
      store_id: STORE,
      customer_id: "cus_123",
      subscription_id: "sub_123",
      status: "past_due",
      price_id: "price_123",
      trial_end: new Date(1_794_000_000 * 1000).toISOString(),
      current_period_end: new Date(1_794_000_000 * 1000).toISOString(),
      cancel_at_period_end: true,
    });
    expect(change(event("customer.subscription.created", subscription({ customer: { id: "cus_obj" }, trial_end: null })))).toMatchObject({ customer_id: "cus_obj", trial_end: null, status: "trialing" });
  });

  it("subscription deleted = canceled; unknown status = incomplete; no store = ignored", () => {
    expect(change(event("customer.subscription.deleted", subscription({ status: "active" })))).toMatchObject({ status: "canceled" });
    expect(change(event("customer.subscription.updated", subscription({ status: "something_new" })))).toMatchObject({ status: "incomplete" });
    expect(change(event("customer.subscription.updated", subscription({ metadata: {} })))).toBeNull();
  });

  it("invoice.payment_failed marks past_due through the subscription metadata", () => {
    const invoice = { object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: "sub_123", metadata: { store_id: STORE } } } };
    expect(change(event("invoice.payment_failed", invoice))).toEqual({ store_id: STORE, status: "past_due", subscription_id: "sub_123" });
    expect(change(event("invoice.payment_failed", { object: "invoice", parent: null }))).toBeNull();
  });

  it("trial_will_end and other events change nothing", () => {
    expect(change(event("customer.subscription.trial_will_end", subscription()))).toBeNull();
    expect(change(event("charge.succeeded", {}))).toBeNull();
  });
});

describe("access by subscription state", () => {
  it("maps every status", () => {
    expect(accessFor(null)).toBe("setup");
    expect(accessFor("incomplete")).toBe("setup");
    for (const s of ["trialing", "active", "past_due"] as const) expect(accessFor(s)).toBe("full");
    for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"] as const) expect(accessFor(s)).toBe("read_only");
    expect([canSell("full"), canSell("setup"), canSell("read_only")]).toEqual([true, false, false]);
    expect([canEdit("full"), canEdit("setup"), canEdit("read_only")]).toEqual([true, true, false]);
  });

  it("trial days left and labels", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(trialDaysLeft("2026-11-15T12:00:00Z", now)).toBe(10);
    expect(trialDaysLeft("2026-11-05T13:00:00Z", now)).toBe(1); // rounded up
    expect(trialDaysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
    const base: SubscriptionInfo = { status: "trialing", stripeCustomerId: "cus", stripeSubscriptionId: "sub", trialEnd: "2026-11-06T12:00:00Z", currentPeriodEnd: null, cancelAtPeriodEnd: false };
    expect(statusLabel(base, now)).toBe("Free trial · 1 day left");
    expect(statusLabel({ ...base, status: "active", stripeCustomerId: null })).toBe("Active (complimentary demo plan)");
    expect(statusLabel(null)).toBe("No subscription");
    expect(isCurrent(base)).toBe(true);
    expect(isCurrent({ ...base, status: "canceled" })).toBe(false);
    expect(isCurrent(null)).toBe(false);
  });

  it("only the owner sees Billing in the menu", () => {
    expect(navForRole("owner").map((i) => i.label)).toContain("Billing");
    expect(navForRole("admin").map((i) => i.label)).not.toContain("Billing");
    expect(navForRole("cashier").map((i) => i.label)).not.toContain("Billing");
  });
});

describe("Stripe configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off without keys or with the example values (CI)", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(getStripeConfig()).toBeNull();
    process.env.STRIPE_SECRET_KEY = "sk_test_example_replace_me";
    process.env.STRIPE_PRICE_ID = "price_example_replace_me";
    expect(getStripeConfig()).toBeNull();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example_replace_me";
    expect(getStripeWebhookSecret()).toBeNull();
  });

  it("refuses live keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_invented";
    process.env.STRIPE_PRICE_ID = "price_invented";
    expect(() => getStripeConfig()).toThrow(/TEST key/);
  });
});
