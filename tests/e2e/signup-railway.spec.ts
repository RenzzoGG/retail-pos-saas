import { type Page, expect, test } from "@playwright/test";
import { waitForLink } from "./mailpit";

/**
 * Sign-up → email confirmation → onboarding → dashboard under the conditions of
 * the Railway container: the production build listens on 0.0.0.0:3000
 * (playwright.config.ts) and every request carries X-Forwarded-Proto: https,
 * as Railway's edge sends it. With both, Next.js reports request.url as
 * https://0.0.0.0:3000, which used to leak into redirects.
 */
test.use({ extraHTTPHeaders: { "x-forwarded-proto": "https" } });

const run = Date.now();
const PASSWORD = `e2e-${run}-Pass`; // throwaway password for throwaway local users

/** Fails the test if the browser is ever sent to the container's own address. */
function forbidInternalOrigin(page: Page) {
  const leaks: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("0.0.0.0")) leaks.push(request.url().replace(/token_hash=[^&]+/, "token_hash=…"));
  });
  return () => expect(leaks, "requests to the internal origin").toEqual([]);
}

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Railway Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

async function createStoreAndExpectDashboard(page: Page, store: string) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Store name").fill(store);
  await page.getByRole("button", { name: "Create store" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(`${store} · signed in as Owner`)).toBeVisible();
  // Stays there: no bounce back to onboarding.
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Create your store" })).toHaveCount(0);
}

test("confirmation link → onboarding → dashboard, and a second click on the link still works", async ({ page }) => {
  const checkNoLeaks = forbidInternalOrigin(page);
  const email = `railway-${run}@e2e.stocktill.test`;
  await signUp(page, email);

  const link = await waitForLink(email, "Confirm your Stocktill account", /\/auth\/confirm\?/);
  await page.goto(link);
  // /app sends a user without a store on to onboarding, on the canonical origin.
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/onboarding$/);

  // The token is single-use. Opening the link again (double click, retry)
  // must not show "invalid link": this browser already has the session.
  await page.goto(link);
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/onboarding$/);
  await expect(page.getByText("That link is invalid or has expired")).toHaveCount(0);

  await createStoreAndExpectDashboard(page, `Railway Shop ${run}`);

  // Once the store exists, the old link leads to the dashboard, not onboarding.
  await page.goto(link);
  await expect(page).toHaveURL(/\/app$/);
  checkNoLeaks();
});

test("manual sign-in → onboarding → dashboard (the path that bounced back to onboarding)", async ({ browser }) => {
  const email = `railway-login-${run}@e2e.stocktill.test`;
  // Confirm in one browser…
  const confirmContext = await browser.newContext();
  const confirmPage = await confirmContext.newPage();
  await signUp(confirmPage, email);
  await confirmPage.goto(await waitForLink(email, "Confirm your Stocktill account", /\/auth\/confirm\?/));
  await confirmContext.close();

  // …then sign in by hand in another, like after a failed confirmation redirect.
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-proto": "https" } });
  const page = await context.newPage();
  const checkNoLeaks = forbidInternalOrigin(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Sign-in goes to /app, which redirects to onboarding (no store yet): the
  // client router now holds that redirect for /app.
  await createStoreAndExpectDashboard(page, `Railway Login Shop ${run}`);
  checkNoLeaks();
  await context.close();
});
