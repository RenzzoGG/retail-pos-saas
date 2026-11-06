import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/features/customers/service";
import { createProduct, createStockEntry } from "@/features/inventory/service";
import { completeSale } from "@/features/pos/service";
import { createStore } from "@/features/stores/service";
import type { Db } from "@/lib/services/result";
import { localSupabaseSecretForWebhookTests } from "../../scripts/local-supabase-env.mjs";
import { USERS, signInAs } from "./helpers";

/**
 * The real webhook route against the local database. Events are signed here
 * with an INVENTED secret (never a real Stripe one). The route needs the LOCAL
 * Supabase secret key to write the Stripe tables: it is read at runtime, only
 * from the local stack, and never printed (CLAUDE.md, exception of phase 9).
 * The user-facing checks below use normal user sessions (RLS).
 */
const WEBHOOK_SECRET = "whsec_integration_test_invented_secret";
const run = String(Date.now()).slice(-8);

type Admin = ReturnType<typeof createClient>;

describe("Stripe webhook route", () => {
  let POST: (request: Request) => Promise<Response>;
  let admin: Admin;
  let owner: Db;
  let storeId = "";
  let productId = "";
  let created = 1_793_000_000;

  const actor = () => ({ userId: USERS.otherOwner.id, storeId, role: "owner" as const });
  const send = async (event: object, opts: { secret?: string; header?: string | null } = {}) => {
    const body = JSON.stringify(event);
    const header = opts.header === undefined ? Stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret ?? WEBHOOK_SECRET }) : opts.header;
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: header === null ? {} : { "stripe-signature": header },
      }),
    );
    return { status: response.status, json: (await response.json()) as { result?: string } };
  };
  const evt = (type: string, object: object) => ({ id: `evt_${run}_${++created}`, object: "event", type, created, data: { object } });
  const sub = (status: string, over: object = {}) => ({
    id: `sub_${run}`,
    object: "subscription",
    customer: `cus_${run}`,
    status,
    trial_end: status === "trialing" ? Math.floor(Date.now() / 1000) + 14 * 86400 : null,
    cancel_at_period_end: false,
    metadata: { store_id: storeId },
    items: { data: [{ price: { id: "price_invented" }, current_period_end: Math.floor(Date.now() / 1000) + 14 * 86400 }] },
    ...over,
  });
  const subscriptionRow = async () =>
    (await admin.from("subscriptions").select("status, stripe_customer_id, stripe_subscription_id, last_event_at").eq("store_id", storeId).maybeSingle()).data as {
      status: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
    } | null;

  /** A one-unit sale as the owner, through the normal service (server + database checks). */
  const sell = () =>
    completeSale(owner, actor(), {
      idempotencyKey: randomUUID(),
      customerId: null,
      items: [{ productId, name: "Hook item", quantity: 1, discount: 0 }],
      saleDiscount: 0,
      payments: [{ method: "card", amount: 10, tendered: null }],
    });

  beforeAll(async () => {
    const local = localSupabaseSecretForWebhookTests(); // throws unless it is the local stack
    process.env.NEXT_PUBLIC_SUPABASE_URL = local.url;
    process.env.SUPABASE_SECRET_KEY = local.secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    admin = createClient(local.url, local.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ({ POST } = await import("@/app/api/stripe/webhook/route"));

    // A brand-new store (no subscription yet), owned by a seed user.
    owner = await signInAs("otherOwner");
    const store = await createStore(owner, { name: `Hook Shop ${run}`, currency: "USD", taxRate: 0, pricesIncludeTax: true, timezone: "UTC" });
    if (!store.ok) throw new Error(store.error);
    storeId = store.data;
  });

  it("setup mode: the new store can add products and stock, but can't sell (server and database)", async () => {
    const product = await createProduct(owner, actor(), { name: "Hook item", sku: `HOOK-${run}`, barcode: null, category: null, salePrice: 10, lowStockThreshold: 0, active: true });
    if (!product.ok) throw new Error(product.error);
    productId = product.data;
    expect((await createStockEntry(owner, actor(), { supplier: null, note: null, lines: [{ productId, quantity: 20, unitCost: 4 }] })).ok).toBe(true);
    expect(await sell()).toMatchObject({ ok: false, error: { code: "subscription_inactive" } });
    // Bypassing the server check, the database refuses too.
    const { error } = await owner.rpc("create_sale", {
      p_store_id: storeId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_payments: [{ method: "card", amount: 10 }],
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toBe("subscription_inactive");
  });

  it("rejects events without a valid signature and writes nothing", async () => {
    const forged = evt("customer.subscription.created", sub("active"));
    expect((await send(forged, { header: null })).status).toBe(400);
    expect((await send(forged, { secret: "whsec_attacker_invented" })).status).toBe(400);
    expect((await send(forged, { header: "t=1,v1=deadbeef" })).status).toBe(400);
    const { count } = await admin.from("stripe_events").select("id", { count: "exact", head: true }).eq("id", forged.id);
    expect(count).toBe(0);
    expect(await subscriptionRow()).toBeNull();
  });

  it("checkout completed links the store; the trial gives full access; a repeated event is applied once", async () => {
    const checkout = evt("checkout.session.completed", { object: "checkout.session", mode: "subscription", client_reference_id: storeId, customer: `cus_${run}`, subscription: `sub_${run}`, metadata: { store_id: storeId } });
    expect(await send(checkout)).toMatchObject({ status: 200, json: { result: "processed" } });
    expect(await subscriptionRow()).toMatchObject({ status: "incomplete", stripe_customer_id: `cus_${run}`, stripe_subscription_id: `sub_${run}` });
    expect((await sell()).ok).toBe(false); // still setup mode

    const trial = evt("customer.subscription.created", sub("trialing"));
    expect(await send(trial)).toMatchObject({ status: 200, json: { result: "processed" } });
    expect(await send(trial)).toMatchObject({ status: 200, json: { result: "duplicate" } }); // Stripe retry
    const { count } = await admin.from("stripe_events").select("id", { count: "exact", head: true }).eq("id", trial.id);
    expect(count).toBe(1);
    expect((await subscriptionRow())?.status).toBe("trialing");
    expect((await sell()).ok).toBe(true);
  });

  it("payment failed = past_due (still sells); deleted = read-only; a late older event is stale; reactivation restores access", async () => {
    const failed = evt("invoice.payment_failed", { object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: `sub_${run}`, metadata: { store_id: storeId } } } });
    expect(await send(failed)).toMatchObject({ status: 200, json: { result: "processed" } });
    expect((await subscriptionRow())?.status).toBe("past_due");
    expect((await sell()).ok).toBe(true);

    const olderActive = evt("customer.subscription.updated", sub("active"));
    const deleted = evt("customer.subscription.deleted", sub("canceled"));
    expect(await send(deleted)).toMatchObject({ status: 200, json: { result: "processed" } });
    expect((await subscriptionRow())?.status).toBe("canceled");
    expect(await sell()).toMatchObject({ ok: false, error: { code: "subscription_inactive" } });
    expect(await createProduct(owner, actor(), { name: "Late", sku: `HOOK-${run}-2`, barcode: null, category: null, salePrice: 1, lowStockThreshold: 0, active: true })).toMatchObject({ ok: false, code: "subscription_inactive" });
    expect(await createCustomer(owner, actor(), { name: "Late customer", documentId: null, phone: null, email: null, notes: null })).toMatchObject({ ok: false, code: "subscription_inactive" });
    const { error } = await owner.from("products").insert({ store_id: storeId, sku: `HOOK-${run}-3`, name: "Direct", sale_price: 1 });
    expect(error?.message).toBe("subscription_inactive"); // the database blocks direct writes too
    // Reading still works.
    expect((await owner.from("sales").select("id").eq("store_id", storeId)).data?.length).toBe(2);

    // The "active" update was created BEFORE the deletion but arrives after it.
    expect(await send(olderActive)).toMatchObject({ status: 200, json: { result: "stale" } });
    expect((await subscriptionRow())?.status).toBe("canceled");

    const renewed = evt("customer.subscription.updated", sub("active"));
    expect(await send(renewed)).toMatchObject({ status: 200, json: { result: "processed" } });
    expect((await subscriptionRow())?.status).toBe("active");
    expect((await sell()).ok).toBe(true);
  });

  it("events for unknown stores or with nothing to apply are acknowledged and recorded", async () => {
    const stranger = evt("customer.subscription.updated", { ...sub("active"), metadata: { store_id: randomUUID() } });
    expect(await send(stranger)).toMatchObject({ status: 200, json: { result: "ignored" } });
    const reminder = evt("customer.subscription.trial_will_end", sub("trialing"));
    expect(await send(reminder)).toMatchObject({ status: 200, json: { result: "ignored" } });
    const { data } = await admin.from("stripe_events").select("result").eq("id", reminder.id).single();
    expect((data as unknown as { result: string }).result).toBe("ignored");
  });

  it("regular users can't read Stripe events nor write subscriptions", async () => {
    const { data } = await owner.from("stripe_events").select("id").limit(1);
    expect(data ?? []).toEqual([]);
    const { error } = await owner.from("subscriptions").update({ status: "active" }).eq("store_id", storeId);
    expect(error).not.toBeNull();
  });
});
