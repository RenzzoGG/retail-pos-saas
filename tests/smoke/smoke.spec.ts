import { expect, test } from "@playwright/test";

/**
 * Production smoke test (playwright.smoke.config.ts). Only reads: it never
 * signs in, so it can run against the live demo at any time.
 */
const isHttps = (process.env.SMOKE_BASE_URL ?? "").startsWith("https://");

test("health check answers from the running server", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("landing loads without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Stocktill/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("hero-demo")).toBeVisible();
  expect(errors).toEqual([]);
});

test("login page shows the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("the private area redirects guests to the login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});

test("security headers are sent", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
  if (isHttps) {
    expect(headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(headers["content-security-policy"]).toContain("upgrade-insecure-requests");
  }
});

test("robots.txt and sitemap.xml point to this site", async ({ request, baseURL }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap:");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const origin = new URL(baseURL ?? "").origin;
  expect(await sitemap.text()).toContain(origin);
});

test("http is redirected to https", async ({ request }) => {
  test.skip(!isHttps, "only for an https deployment");
  const httpUrl = (process.env.SMOKE_BASE_URL ?? "").replace(/^https:/, "http:") + "/api/health";
  const response = await request.get(httpUrl, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers()["location"]).toMatch(/^https:\/\//);
});
