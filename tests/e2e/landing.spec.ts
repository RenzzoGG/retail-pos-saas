import { type Page, expect, test } from "@playwright/test";

/**
 * Landing page (/): GSAP animations, reduced motion, CTAs and SEO files.
 * Runs on the production build, like the rest of the E2E suite.
 */
const SECTIONS = ["features", "pos", "inventory", "import", "receipts", "reports", "security", "pricing", "faq"];

/** Texts inside <main> that are hidden (opacity < 1 or visibility hidden). */
async function hiddenTexts(page: Page, selector = "main h1, main h2, main h3, main p, main li, main summary") {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(sel)]
        .filter((el) => !el.closest("[aria-hidden='true']"))
        .filter((el) => {
          let node: HTMLElement | null = el;
          while (node && node !== document.body) {
            const s = getComputedStyle(node);
            if (s.visibility === "hidden" || Number(s.opacity) < 0.99) return true;
            node = node.parentElement;
          }
          return false;
        })
        .map((el) => (el.textContent ?? "").trim().slice(0, 50)),
    selector,
  );
}

test("landing: no console errors, the hero plays a sale, every section reveals, CTAs lead to sign up / sign in", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Scan, sell and know your stock. All in one place." })).toBeVisible();
  // The animated register: scans fill the cart, then the sale is paid and the dashboard card appears.
  const hero = page.getByTestId("hero-demo");
  await expect(hero.getByTestId("hero-cart").locator("li")).toHaveCount(3, { timeout: 15_000 });
  await expect(hero).toHaveAttribute("data-status", "paid", { timeout: 15_000 });
  await expect(hero.getByTestId("hero-total")).toHaveText("$55.96");
  await expect(hero.getByTestId("hero-dashboard")).toBeVisible();

  // Scroll through the page like a visitor: every section ends up visible.
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    await section.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 300);
    await expect(section).toBeVisible();
  }
  // The security section is pinned and driven by the scroll: go through its pin.
  await page.locator("#security").scrollIntoViewIfNeeded();
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(80);
  }
  await expect.poll(() => hiddenTexts(page, "#security li, #security h2"), { timeout: 5_000 }).toEqual([]);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect.poll(() => hiddenTexts(page, "#pricing *, #faq summary"), { timeout: 5_000 }).toEqual([]);
  await expect(page.getByTestId("fictional-notice")).toContainText("Stocktill is a fictional brand and a portfolio project");

  expect(errors).toEqual([]);

  // CTAs
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("link", { name: "Start your 14-day free trial" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("reduced motion: everything is visible at once and the hero shows the finished sale", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("hero-demo")).toHaveAttribute("data-status", "paid"); // no waiting for an animation
  await expect(page.getByTestId("hero-dashboard")).toBeVisible();
  // Without scrolling at all: nothing in <main> is hidden (no animation set a "from" state).
  expect(await hiddenTexts(page)).toEqual([]);
  expect(await hiddenTexts(page, "main [data-reveal], main [data-split], #security li")).toEqual([]);
  await expect(page.getByRole("heading", { name: "One simple plan" })).toBeAttached();
  await expect(page.getByText("14-day free trial", { exact: true })).toBeAttached();
  await context.close();
});

test("works from 320 px wide without horizontal scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const id of SECTIONS) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

test("SEO: metadata, Open Graph image, robots.txt and sitemap.xml", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Stocktill — Point of sale and inventory for small shops");
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(ogImage).toMatch(/\/opengraph-image/);
  const image = await request.get(new URL(ogImage as string).pathname + new URL(ogImage as string).search);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/); // the site root

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /app");
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("<loc>");
  expect(sitemap).toContain("/signup</loc>");
});
