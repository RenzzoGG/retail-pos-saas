"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { type BillingState, openPortalAction, startCheckoutAction } from "../actions";

const initial: BillingState = { message: null };

/** Owner's billing actions. Both redirect to Stripe-hosted pages. */
export function BillingButtons({ canCheckout, canManage, checkoutLabel }: { canCheckout: boolean; canManage: boolean; checkoutLabel: string }) {
  const [checkout, checkoutAction] = useActionState(startCheckoutAction, initial);
  const [portal, portalAction] = useActionState(openPortalAction, initial);
  const message = checkout.message ?? portal.message;
  return (
    <div className="space-y-3">
      {message ? <Alert tone="error">{message}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {canCheckout ? (
          <form action={checkoutAction}>
            <SubmitButton pendingText="Opening Stripe…">{checkoutLabel}</SubmitButton>
          </form>
        ) : null}
        {canManage ? (
          <form action={portalAction}>
            <SubmitButton variant="secondary" pendingText="Opening Stripe…">
              Manage billing
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
