/**
 * Access by subscription state. Mirrors app.store_access() in the database,
 * which is what really enforces it (triggers); the server checks it first to
 * give a clear message, and the UI uses it for banners.
 */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type Access = "full" | "setup" | "read_only";

export type SubscriptionInfo = {
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function accessFor(status: SubscriptionStatus | null | undefined): Access {
  if (!status || status === "incomplete") return "setup";
  if (status === "trialing" || status === "active" || status === "past_due") return "full";
  return "read_only";
}

/** Selling (sales, returns) needs full access. */
export const canSell = (access: Access) => access === "full";
/** Catalog, stock, imports and customers: full access or setup mode. */
export const canEdit = (access: Access) => access !== "read_only";

/** Whole days left in the trial, rounded up (0 when it ended). */
export function trialDaysLeft(trialEnd: string | null, now = new Date()): number | null {
  if (!trialEnd) return null;
  const ms = new Date(trialEnd).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Short label for the status, for the Billing page and banners. */
export function statusLabel(sub: SubscriptionInfo | null, now = new Date()): string {
  if (!sub || sub.status === "incomplete") return "No subscription";
  switch (sub.status) {
    case "trialing": {
      const days = trialDaysLeft(sub.trialEnd, now);
      return days === null ? "Free trial" : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`;
    }
    case "active":
      return sub.stripeCustomerId ? "Active" : "Active (complimentary demo plan)";
    case "past_due":
      return "Payment past due";
    case "canceled":
      return "Canceled";
    case "unpaid":
      return "Unpaid";
    case "incomplete_expired":
      return "Checkout expired";
    case "paused":
      return "Paused";
  }
}

/** A subscription that is running (Checkout must not create a second one). */
export const isCurrent = (sub: SubscriptionInfo | null) =>
  !!sub && (sub.status === "trialing" || sub.status === "active" || sub.status === "past_due" || sub.status === "unpaid");

export const ACCESS_MESSAGES = {
  sell: "Selling is paused: this store needs an active subscription. The owner can start the free trial or renew it in Billing.",
  edit: "This store is read-only because its subscription ended. The owner can renew it in Billing.",
} as const;
