import { type Browser, type Page, expect } from "@playwright/test";
import { DEMO_PASSWORD, USERS } from "../fixtures/demo";

export const DEMO = {
  owner: USERS.owner.email,
  admin: USERS.admin.email,
  cashier: USERS.cashier.email,
} as const;

/** Signs a seed demo user in through the real login form, in a fresh browser context. */
export async function signInAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return page;
}
