import { expect, test } from "@playwright/test";
import { DEMO, signInAs } from "./auth";
import { USERS } from "../fixtures/demo";

/**
 * Billing is owner-only. The seed stores don't depend on Stripe: the demo store
 * has a complimentary active plan and Other Shop is in its free trial.
 * (The real Checkout flow needs your Stripe test keys: see docs/STRIPE.md.)
 */
test("owner: Billing shows the plan; admins and cashiers can't open it", async ({ browser }) => {
  const owner = await signInAs(browser, DEMO.owner);
  await owner.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(owner.getByTestId("billing-status")).toHaveText(/Active \(complimentary demo plan\)/);
  await expect(owner.getByTestId("billing-access")).toContainText("Full access");
  await expect(owner.getByText("This store has a complimentary demo plan: there is nothing to pay or manage.")).toBeVisible();
  await expect(owner.getByTestId("subscription-banner")).toHaveCount(0); // nothing to warn about

  for (const email of [DEMO.admin, DEMO.cashier]) {
    const page = await signInAs(browser, email);
    await expect(page.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await page.goto("/app/billing");
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByTestId("billing-status")).toHaveCount(0);
  }
});

test("a store in its free trial shows the days left and can sell", async ({ browser }) => {
  const other = await signInAs(browser, USERS.otherOwner.email);
  await other.goto("/app/billing");
  await expect(other.getByTestId("billing-status")).toHaveText(/Free trial · \d+ days? left/);
  await expect(other.getByText(/Trial ends/)).toBeVisible();
  await other.goto("/app/pos");
  await expect(other.getByLabel(/Scan or search/)).toBeVisible(); // the register is open
  await expect(other.getByTestId("pos-blocked")).toHaveCount(0);
});
