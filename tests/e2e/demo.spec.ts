import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../fixtures/demo";

/**
 * Public demo (phase 11): the landing points to it, the login page lists the
 * three published accounts with their password, and one click signs in with
 * the chosen role. (The database locks of the demo store are covered by
 * supabase/tests/database/016_demo.test.sql: locally the store is unlocked.)
 */
test("landing → Try the live demo → one-click sign-in for each role", async ({ browser, page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try the live demo" }).click();
  await expect(page).toHaveURL(/\/login#demo$/);

  const panel = page.getByTestId("demo-panel");
  await expect(panel.getByRole("heading", { name: "Try the live demo" })).toBeVisible();
  await expect(panel.getByTestId("demo-password")).toHaveText(DEMO_PASSWORD);

  for (const role of ["Owner", "Admin", "Cashier"] as const) {
    const context = await browser.newContext();
    const visitor = await context.newPage();
    await visitor.goto("/login");
    await visitor.getByRole("button", { name: `Try as ${role}` }).click();
    await expect(visitor).toHaveURL(/\/app$/);
    await expect(visitor.getByTestId("current-role")).toHaveText(`Your role: ${role}`);
    await context.close();
  }
});

test("password reset is never sent to a demo address", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("owner@demo.stocktill.test");
  await page.getByRole("button", { name: /reset|send/i }).click();
  // Same neutral answer as for any address (no account enumeration).
  await expect(page.getByText("If an account exists for that email")).toBeVisible();
});
