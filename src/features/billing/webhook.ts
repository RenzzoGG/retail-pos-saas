import Stripe from "stripe";
import type { SubscriptionStatus } from "./access";

/**
 * Stripe webhook logic, without I/O (unit-tested with events signed by an
 * invented secret). The route verifies the signature, turns the event into a
 * "change" and hands it to the database function apply_stripe_event, which
 * records the event id (idempotency) and applies the change atomically.
 */

/** Events we act on. Anything else is acknowledged (200) and ignored. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.payment_failed",
] as const;

/** Keys as apply_stripe_event expects them; only present keys are written. */
export type SubscriptionChange = {
  store_id: string;
  customer_id?: string;
  subscription_id?: string;
  status?: SubscriptionStatus;
  price_id?: string | null;
  trial_end?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"];

const iso = (unix: number | null | undefined) => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : null);
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? undefined));
const storeIdFrom = (...candidates: (string | null | undefined)[]) => candidates.find((c) => !!c && UUID.test(c)) ?? null;

/**
 * Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.body" with
 * the endpoint secret, within a 5-minute tolerance) and parses the event.
 * Throws on a missing/invalid signature or a tampered body.
 */
export function verifyEvent(rawBody: string, signature: string | null, secret: string): Stripe.Event {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

function fromSubscription(sub: Stripe.Subscription, deleted: boolean): SubscriptionChange | null {
  const storeId = storeIdFrom(sub.metadata?.store_id);
  if (!storeId) return null;
  const item = sub.items?.data?.[0];
  const status = deleted ? "canceled" : (sub.status as SubscriptionStatus);
  return {
    store_id: storeId,
    customer_id: idOf(sub.customer),
    subscription_id: sub.id,
    status: STATUSES.includes(status) ? status : "incomplete",
    price_id: item?.price?.id ?? null,
    trial_end: iso(sub.trial_end),
    // Since API 2025-03-31 the period lives on the subscription items.
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

/** What to write for a verified event, or null when there is nothing to apply. */
export function toChange(event: Stripe.Event): SubscriptionChange | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return null;
      const storeId = storeIdFrom(session.client_reference_id, session.metadata?.store_id);
      if (!storeId) return null;
      // Only links the ids: the status comes from the subscription events.
      const change: SubscriptionChange = { store_id: storeId };
      const customer = idOf(session.customer);
      const subscription = idOf(session.subscription);
      if (customer) change.customer_id = customer;
      if (subscription) change.subscription_id = subscription;
      return change;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return fromSubscription(event.data.object, false);
    case "customer.subscription.deleted":
      return fromSubscription(event.data.object, true);
    case "invoice.payment_failed": {
      // Shows the warning right away; customer.subscription.updated confirms it.
      const details = event.data.object.parent?.subscription_details;
      const storeId = storeIdFrom(details?.metadata?.store_id ?? undefined);
      if (!storeId) return null;
      const change: SubscriptionChange = { store_id: storeId, status: "past_due" };
      const subscription = idOf(details?.subscription);
      if (subscription) change.subscription_id = subscription;
      return change;
    }
    default:
      // customer.subscription.trial_will_end (no emails yet) and anything else.
      return null;
  }
}

export type WebhookOutcome = "processed" | "duplicate" | "stale" | "ignored";
