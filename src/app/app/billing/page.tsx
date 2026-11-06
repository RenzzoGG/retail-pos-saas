import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { accessFor, isCurrent, statusLabel, trialDaysLeft } from "@/features/billing/access";
import { BillingButtons } from "@/features/billing/components/billing-buttons";
import { getSubscription } from "@/features/billing/service";
import { TRIAL_DAYS, getStripe } from "@/features/billing/stripe";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing · Stocktill" };

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

const ACCESS_TEXT = {
  full: "Full access: selling, inventory, reports and team.",
  setup: "Setup mode: you can add products, stock, customers and your team. Selling starts with the free trial.",
  read_only: "Read-only: you can view sales, reports and exports, and manage Settings and Team. Selling and inventory changes are paused.",
} as const;

/** Owner only: the store's plan. Admins and cashiers get a 404 (requireRole). */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { store } = await requireRole(["owner"]);
  const sub = await getSubscription(await createClient(), store.storeId);
  const { checkout } = await searchParams;
  if (!sub.ok) return <Alert tone="error">{sub.error}</Alert>;
  const s = sub.data;
  const access = accessFor(s?.status);
  const configured = getStripe() !== null;
  const days = s?.status === "trialing" ? trialDaysLeft(s.trialEnd) : null;
  const canCheckout = !isCurrent(s);
  const canManage = !!s?.stripeCustomerId;
  const tone = access === "full" ? (s?.status === "past_due" ? "warning" : "ok") : access === "setup" ? "info" : "warning";
  const icon = { ok: "✓", warning: "!", info: "i" }[tone];

  return (
    <>
      <PageHeader title="Billing" description={`${store.storeName} · Stocktill Monthly, 19 USD per month with a ${TRIAL_DAYS}-day free trial. Stripe test mode: no real charges.`} />
      <div className="space-y-6">
        {checkout === "success" && !isCurrent(s) ? (
          <Alert tone="info">Payment details received. Stripe is confirming your subscription: refresh this page in a few seconds.</Alert>
        ) : null}
        {checkout === "success" && isCurrent(s) ? <Alert tone="success">Your subscription is set up. Thank you!</Alert> : null}
        {checkout === "canceled" ? <Alert tone="info">Checkout was canceled. Nothing was charged.</Alert> : null}

        <Card title="Your plan">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="sr-only">Status</dt>
              <dd className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white" data-testid="billing-status">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    tone === "ok"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                      : tone === "warning"
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                        : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                  }`}
                >
                  {icon}
                </span>
                {statusLabel(s)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700 dark:text-slate-300">What you can do</dt>
              <dd className="text-slate-600 dark:text-slate-400" data-testid="billing-access">{ACCESS_TEXT[access]}</dd>
            </div>
            {s?.status === "trialing" && s.trialEnd ? (
              <div>
                <dt className="font-medium text-slate-700 dark:text-slate-300">Trial ends</dt>
                <dd className="text-slate-600 dark:text-slate-400">
                  {DATE.format(new Date(s.trialEnd))} ({days} {days === 1 ? "day" : "days"} left). The first charge of 19 USD happens then unless you cancel.
                </dd>
              </div>
            ) : null}
            {s && (s.status === "active" || s.status === "past_due") && s.currentPeriodEnd ? (
              <div>
                <dt className="font-medium text-slate-700 dark:text-slate-300">{s.cancelAtPeriodEnd ? "Ends on" : "Renews on"}</dt>
                <dd className="text-slate-600 dark:text-slate-400">{DATE.format(new Date(s.currentPeriodEnd))}</dd>
              </div>
            ) : null}
            {s?.cancelAtPeriodEnd && s.status !== "canceled" ? (
              <div>
                <dt className="font-medium text-slate-700 dark:text-slate-300">Cancellation</dt>
                <dd className="text-slate-600 dark:text-slate-400">Canceled: access continues until the end of the current period.</dd>
              </div>
            ) : null}
            {s?.status === "past_due" ? (
              <Alert tone="warning">The last payment failed. Stripe will retry it; update your card in “Manage billing” to keep selling.</Alert>
            ) : null}
          </dl>
        </Card>

        <Card title="Manage" description="Checkout and the billing portal are hosted by Stripe. In test mode, pay with card 4242 4242 4242 4242, any future date and any CVC.">
          {configured ? (
            <BillingButtons
              canCheckout={canCheckout}
              canManage={canManage}
              checkoutLabel={s?.stripeSubscriptionId ? "Subscribe again" : `Start ${TRIAL_DAYS}-day free trial`}
            />
          ) : (
            <Alert tone="info">Stripe isn&apos;t configured on this server yet, so subscriptions can&apos;t be started here. See docs/STRIPE.md.</Alert>
          )}
          {!canCheckout && !canManage ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400" data-testid="billing-unlinked">
              This plan comes with the demo data and isn&apos;t linked to Stripe: there is nothing to pay or manage.
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
