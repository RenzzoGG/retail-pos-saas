import { toChange, verifyEvent } from "@/features/billing/webhook";
import { getStripeWebhookSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/stripe/webhook — called by Stripe (or `stripe listen` locally).
 *
 *  1. Verifies the Stripe-Signature with STRIPE_WEBHOOK_SECRET: anything not
 *     signed by Stripe gets 400 and nothing is written.
 *  2. Records and applies the event in ONE database call (apply_stripe_event):
 *     the event id is the idempotency key, so a retried/duplicated event is
 *     never applied twice, and older events can't overwrite newer state.
 *  3. Answers 200 (Stripe stops retrying) or 500 if the database failed, so
 *     Stripe retries later (the event was not recorded).
 *
 * This is the only place that uses the Supabase secret key (createAdminClient).
 */
export async function POST(request: Request) {
  const secret = getStripeWebhookSecret();
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text(); // the exact bytes Stripe signed
  let event;
  try {
    event = verifyEvent(rawBody, request.headers.get("stripe-signature"), secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const change = toChange(event);
  const { data, error } = await createAdminClient().rpc("apply_stripe_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_created: new Date(event.created * 1000).toISOString(),
    // The SQL function treats null as "nothing to apply".
    p_change: change as unknown as never,
  });
  if (error) {
    console.error("Stripe webhook: could not apply event", event.id, event.type, error.code);
    return Response.json({ error: "Could not process the event" }, { status: 500 });
  }
  return Response.json({ received: true, result: data });
}
