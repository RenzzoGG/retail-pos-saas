import { type Page, expect, test } from "@playwright/test";
import { waitForLink } from "./mailpit";

/**
 * Full flow in a real browser:
 * sign up → confirm via Mailpit → create store → invite a cashier → the invitee
 * signs up, confirms and accepts → the owner promotes them to admin.
 * Users are created by the test itself (unique emails per run).
 */
const run = Date.now();
const owner = { name: "E2E Owner", email: `owner-${run}@e2e.stocktill.test` };
const member = { name: "E2E Member", email: `member-${run}@e2e.stocktill.test` };
const PASSWORD = `e2e-${run}-Pass`; // throwaway password for a throwaway local user
const STORE = `E2E Shop ${run}`;

async function signUp(page: Page, user: { name: string; email: string }) {
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test("owner onboards, invites a cashier who accepts, then promotes them", async ({ browser }) => {
  // ---------------------------------------------------------------- owner
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  await ownerPage.goto("/app");
  await expect(ownerPage).toHaveURL(/\/login\?next=%2Fapp/); // guests are redirected
  await ownerPage.goto("/signup");
  await signUp(ownerPage, owner);

  // Not confirmed yet: sign-in is refused with a clear message.
  await ownerPage.goto("/login");
  await ownerPage.getByLabel("Email").fill(owner.email);
  await ownerPage.getByLabel("Password").fill(PASSWORD);
  await ownerPage.getByRole("button", { name: "Sign in" }).click();
  // Filter by text: Next.js also renders an empty role="alert" route announcer.
  await expect(ownerPage.getByRole("alert").filter({ hasText: "confirm your email" })).toBeVisible();

  const confirmLink = await waitForLink(owner.email, "Confirm your Stocktill account", /\/auth\/confirm\?/);
  await ownerPage.goto(confirmLink);
  await expect(ownerPage).toHaveURL(/\/onboarding$/);

  await ownerPage.getByLabel("Store name").fill(STORE);
  await ownerPage.getByLabel("Sales tax (%)").fill("8.25");
  await ownerPage.getByRole("button", { name: "Create store" }).click();
  await expect(ownerPage).toHaveURL(/\/app$/);
  await expect(ownerPage.getByTestId("current-role")).toHaveText("Your role: Owner");
  await expect(ownerPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" })).toBeVisible();

  await ownerPage.getByRole("link", { name: "Team" }).click();
  await ownerPage.getByLabel("Email", { exact: true }).fill(member.email);
  await ownerPage.getByLabel("Role", { exact: true }).selectOption("cashier");
  await ownerPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(ownerPage.getByRole("status").filter({ hasText: `Invitation sent to ${member.email}` })).toBeVisible();
  // Listed under "Pending invitations".
  await expect(ownerPage.getByRole("button", { name: `Revoke invitation for ${member.email}` })).toBeVisible();

  // --------------------------------------------------------------- invitee
  const inviteLink = await waitForLink(member.email, `join ${STORE}`, /\/invite\//);
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  await memberPage.goto(inviteLink);
  await expect(memberPage).toHaveURL(/\/login\?next=%2Finvite%2F/);
  await memberPage.getByRole("link", { name: "Create an account" }).click();
  await signUp(memberPage, member);

  const memberConfirm = await waitForLink(member.email, "Confirm your Stocktill account", /\/auth\/confirm\?/);
  await memberPage.goto(memberConfirm);
  await expect(memberPage).toHaveURL(/\/invite\//);
  await expect(memberPage.getByText(`You've been invited to join ${STORE} as Cashier`)).toBeVisible();
  await memberPage.getByRole("button", { name: "Accept invitation" }).click();

  await expect(memberPage).toHaveURL(/\/app$/);
  await expect(memberPage.getByTestId("current-role")).toHaveText("Your role: Cashier");
  const memberNav = memberPage.getByRole("navigation", { name: "Main" });
  await expect(memberNav.getByRole("link", { name: "Sales / POS" })).toBeVisible();
  await expect(memberNav.getByRole("link", { name: "Team" })).toHaveCount(0);
  await expect(memberNav.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // Hidden is not enough: the server refuses the page too. It renders the 404
  // screen; the HTTP status stays 200 because the private area streams (the
  // role check runs inside <Suspense>, after the status line was sent).
  await memberPage.goto("/app/team");
  await expect(memberPage.getByText("This page could not be found.")).toBeVisible();
  await expect(memberPage.getByRole("heading", { name: "Invite someone" })).toHaveCount(0);
  await expect(memberPage.getByText(owner.email)).toHaveCount(0);

  // ------------------------------------------------- owner changes the role
  await ownerPage.reload();
  const row = ownerPage.getByTestId(`member-${member.email}`);
  await expect(row).toBeVisible();
  await row.getByLabel(`Role for ${member.name}`, { exact: true }).selectOption("admin");
  // Wait for the Server Action to finish (the select already shows "admin"
  // locally, so checking its value alone would not prove the save happened).
  await Promise.all([
    ownerPage.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/team")),
    row.getByRole("button", { name: `Save role for ${member.name}` }).click(),
  ]);
  await expect(row.getByLabel(`Role for ${member.name}`, { exact: true })).toHaveValue("admin");
  await expect(row.getByRole("status")).toHaveText("Role updated.");

  await memberPage.goto("/app");
  await expect(memberPage.getByTestId("current-role")).toHaveText("Your role: Admin");
  await expect(memberPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" })).toBeVisible();

  // As admin they manage cashiers only: they can't invite admins.
  await memberPage.getByRole("link", { name: "Team" }).click();
  await expect(memberPage.getByLabel("Role", { exact: true }).locator("option")).toHaveText(["Cashier"]);

  // Sign out and back in with the password (session cookies set by a Server Action).
  await memberPage.getByRole("button", { name: "Sign out" }).click();
  await expect(memberPage).toHaveURL(/\/login$/);
  await memberPage.goto("/app");
  await expect(memberPage).toHaveURL(/\/login\?next=%2Fapp/);
  await memberPage.getByLabel("Email", { exact: true }).fill(member.email);
  await memberPage.getByLabel("Password").fill(PASSWORD);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(memberPage).toHaveURL(/\/app$/);
  await expect(memberPage.getByTestId("current-role")).toHaveText("Your role: Admin");

  await ownerContext.close();
  await memberContext.close();
});
