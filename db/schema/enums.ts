import { pgEnum } from "drizzle-orm/pg-core";

export const storeRole = pgEnum("store_role", ["owner", "admin", "cashier"]);

export const stockMovementType = pgEnum("stock_movement_type", [
  "sale",
  "return",
  "entry",
]);

export const paymentMethod = pgEnum("payment_method", ["cash", "card", "transfer"]);

export const saleStatus = pgEnum("sale_status", [
  "completed",
  "partially_returned",
  "returned",
]);

export const activityAction = pgEnum("activity_action", ["insert", "update", "delete"]);

/** Mirrors Stripe's subscription.status values. */
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);
