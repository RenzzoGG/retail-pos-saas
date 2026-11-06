import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared";
import { subscriptionStatus } from "./enums";
import { stores } from "./stores";

/**
 * One subscription per store. Written only by the Stripe webhook (service role,
 * through apply_stripe_event) and by the local seed. stripe_customer_id null =
 * a complimentary plan not linked to Stripe (the demo store).
 */
export const subscriptions = pgTable("subscriptions", {
  storeId: uuid("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  status: subscriptionStatus("status").notNull(),
  priceId: text("price_id"),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** `created` of the last Stripe event applied: older events arriving late are ignored. */
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Processed Stripe webhook events (idempotency). Service role only. */
export const stripeEvents = pgTable("stripe_events", {
  /** Stripe event id (evt_…). */
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  /** processed | stale (older than the last applied) | ignored (unknown store or type). */
  result: text("result"),
});
