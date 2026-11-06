#!/usr/bin/env node
/**
 * Creates (or finds) the Stocktill plan in YOUR Stripe account, in TEST mode:
 *   product "Stocktill Monthly" + price 19.00 USD / month (lookup_key stocktill_monthly).
 *
 * Run it yourself (it reads your key from .env.local; nothing is printed or saved):
 *   node --env-file=.env.local scripts/stripe-setup.mjs
 *
 * It is idempotent: running it again reuses the same price. It prints only the
 * price id (price_…), which is not a secret: put it in .env.local as STRIPE_PRICE_ID.
 * The 14-day trial is set by Checkout (subscription_data.trial_period_days), not here.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key || key.includes("example")) {
  console.error("STRIPE_SECRET_KEY is not set. Run: node --env-file=.env.local scripts/stripe-setup.mjs");
  process.exit(1);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY is not a TEST key (sk_test_…). This project only uses Stripe test mode.");
  process.exit(1);
}

const LOOKUP_KEY = "stocktill_monthly";
const stripe = new Stripe(key, { apiVersion: "2026-10-28.endive" });

const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
let price = existing.data[0];
if (price) {
  console.log("The Stocktill Monthly price already exists.");
} else {
  const product = await stripe.products.create({
    name: "Stocktill Monthly",
    description: "Stocktill POS & inventory (fictional portfolio project) — monthly plan",
  });
  price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: 1900,
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
    nickname: "Stocktill Monthly · 19 USD",
  });
  console.log("Created product and price in test mode.");
}
console.log(`\nAdd this line to .env.local:\nSTRIPE_PRICE_ID=${price.id}\n`);
