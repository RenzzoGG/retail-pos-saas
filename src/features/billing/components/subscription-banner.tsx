import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { accessFor, trialDaysLeft } from "../access";
import { getSubscription } from "../service";

/**
 * Store-wide notice about the subscription, on every private page. Only the
 * owner gets the link to Billing (admins and cashiers are told to ask them).
 */
export async function SubscriptionBanner({ storeId, isOwner }: { storeId: string; isOwner: boolean }) {
  const sub = await getSubscription(await createClient(), storeId);
  if (!sub.ok) return null;
  const s = sub.data;
  const access = accessFor(s?.status);
  const days = s?.status === "trialing" ? trialDaysLeft(s.trialEnd) : null;

  let text: string | null = null;
  let warning = true;
  if (access === "setup") {
    text = "Setup mode: add your products and team. Selling starts when the owner starts the free trial.";
    warning = false;
  } else if (access === "read_only") {
    text = "This store is read-only because its subscription ended. Sales and inventory changes are paused.";
  } else if (s?.status === "past_due") {
    text = "The last subscription payment failed. Selling still works while Stripe retries; please update the card.";
  } else if (days !== null && days <= 3) {
    text = `The free trial ends in ${days} ${days === 1 ? "day" : "days"}.`;
    warning = false;
  }
  if (!text) return null;

  return (
    <div
      role="status"
      data-testid="subscription-banner"
      className={`mb-6 flex flex-col gap-2 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${
        warning
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
      }`}
    >
      <p>
        <span aria-hidden="true" className="mr-1 font-bold">{warning ? "!" : "i"}</span>
        {text}
      </p>
      {isOwner ? (
        <Link href="/app/billing" className="shrink-0 font-semibold underline">
          Go to Billing
        </Link>
      ) : (
        <span className="shrink-0">Ask the store owner.</span>
      )}
    </div>
  );
}
