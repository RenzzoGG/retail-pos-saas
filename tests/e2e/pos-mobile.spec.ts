import { type Page, expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../fixtures/demo";
import { DEMO } from "./auth";

/**
 * POS on a phone (390 px): with 4 products in the cart the page never scrolls
 * sideways, each cart line is a stacked card (the table header is hidden), the
 * inputs keep their labels and the keyboard flow still works.
 */
const CODES = ["2000000000015", "2000000000015", "2000000000053", "2000000000152", "2000000000107"];
const SKUS = ["CBL-USBC-1M", "CHG-20W-C", "CAS-IP15-CLR", "PWB-20K"];

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openPosAsCashier(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(DEMO.cashier);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/pos", { waitUntil: "networkidle" });
}

test("POS cart with 4 products has no horizontal scroll at 390 px", async ({ page }) => {
  await openPosAsCashier(page);
  const scan = page.getByLabel(/Scan or search/);
  await expect(scan).toBeFocused();
  for (const code of CODES) {
    await page.keyboard.type(code, { delay: 2 });
    await page.keyboard.press("Enter");
  }
  for (const sku of SKUS) await expect(page.getByTestId(`cart-line-${sku}`)).toBeVisible();
  await expect(page.getByTestId("cart-line-CBL-USBC-1M").getByLabel(/^Quantity of/)).toHaveValue("2");

  // No horizontal scroll, and every cart line fits inside the viewport.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  for (const sku of SKUS) {
    const box = await page.getByTestId(`cart-line-${sku}`).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }

  // Card layout: no table header; the name stays on one line above the inputs.
  await expect(page.getByRole("columnheader", { name: "Discount" })).toBeHidden();
  const line = page.getByTestId("cart-line-CHG-20W-C");
  const name = await line.getByText("20 W USB-C Wall Charger", { exact: true }).boundingBox();
  const qty = await line.getByLabel("Quantity of 20 W USB-C Wall Charger").boundingBox();
  expect(name!.height).toBeLessThan(30);
  expect(qty!.y).toBeGreaterThan(name!.y + name!.height);

  // Labels and keyboard flow are unchanged: edit a quantity, Enter goes back to scanning.
  await line.getByLabel("Quantity of 20 W USB-C Wall Charger").fill("2");
  await page.keyboard.press("Enter");
  await expect(scan).toBeFocused();
  await line.getByLabel("Discount on 20 W USB-C Wall Charger", { exact: true }).fill("1");
  await expect(line.getByLabel("Discount on 20 W USB-C Wall Charger: percent or amount")).toBeVisible();
  // 2 x 9.99 + 2 x 19.99 + 15.99 + 49.99 - 1.00 = 124.94
  await expect(page.getByTestId("pos-total")).toHaveText("$124.94");
  await expect(page.getByRole("button", { name: "Remove Power Bank 20,000 mAh" })).toBeVisible();
});

test("sale discount: disabled with an empty cart, never larger than the subtotal", async ({ page }) => {
  await openPosAsCashier(page);
  const saleDiscount = page.getByLabel("Discount on the whole sale", { exact: true });
  const charge = page.getByRole("button", { name: /^Charge/ });

  // Empty cart: nothing to discount, nothing to charge, and no contradictory error.
  await expect(saleDiscount).toBeDisabled();
  await expect(page.getByText("Add products to the cart to give a discount.")).toBeVisible();
  for (const button of await charge.all()) await expect(button).toBeDisabled();
  await expect(page.getByTestId("pos-total")).toHaveText("$0.00");
  await expect(page.getByRole("alert").filter({ hasText: /discount/i })).toHaveCount(0);

  // One cable (9.99): a 20.00 discount is larger than the subtotal.
  await page.getByLabel(/Scan or search/).fill("2000000000015");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cart-line-CBL-USBC-1M")).toBeVisible();
  await expect(saleDiscount).toBeEnabled();
  await saleDiscount.fill("20");
  await expect(page.getByRole("alert").filter({ hasText: "The discount can't be larger than the subtotal." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "your limit" })).toHaveCount(0);
  await expect(page.getByTestId("pos-totals")).not.toContainText("Discounts");
  await expect(page.getByTestId("pos-total")).toHaveText("$9.99");
  for (const button of await charge.all()) await expect(button).toBeDisabled();

  // Removing the last product empties the cart and drops the sale discount.
  await page.getByRole("button", { name: "Remove USB-C to USB-C Cable 1 m" }).click();
  await expect(saleDiscount).toBeDisabled();
  await expect(saleDiscount).toHaveValue("");
  await expect(page.getByRole("alert").filter({ hasText: /discount/i })).toHaveCount(0);
});

test("keyboard shortcut hints are hidden on a touch phone", async ({ page }) => {
  await openPosAsCashier(page);
  await page.getByLabel(/Scan or search/).fill("2000000000015");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cart-line-CBL-USBC-1M")).toBeVisible();
  await expect(page.getByRole("region", { name: "Keyboard shortcuts" })).toBeHidden();
  const kbds = page.locator("kbd");
  expect(await kbds.count()).toBeGreaterThan(0);
  for (const kbd of await kbds.all()) await expect(kbd).toBeHidden();
  // The labels and buttons read cleanly without the key names.
  await expect(page.getByRole("button", { name: "Charge $9.99", exact: true })).toBeVisible();
  // Accessible name (hidden <kbd> excluded), not the raw label text.
  await expect(page.getByRole("searchbox", { name: "Customer (optional)", exact: true })).toBeVisible();
});

test("search field: Enter with a name adds the only match or lists several; scanner codes unchanged", async ({ page }) => {
  await openPosAsCashier(page);
  const scan = page.getByLabel(/Scan or search/);
  // No auto-capitals, autocorrect or spellcheck on a phone; the Enter key reads "search".
  await expect(scan).toHaveAttribute("autocapitalize", "off");
  await expect(scan).toHaveAttribute("autocorrect", "off");
  await expect(scan).toHaveAttribute("spellcheck", "false");
  await expect(scan).toHaveAttribute("enterkeyhint", "search");

  // One product matches "speaker": added straight away.
  await scan.fill("speaker");
  await scan.press("Enter");
  await expect(page.getByTestId("cart-line-AUD-SPK-MINI")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No product" })).toHaveCount(0);

  // Several match "Cable": the list is shown instead of an error, and a tap adds one.
  await scan.fill("Cable");
  await scan.press("Enter");
  const list = page.getByRole("list", { name: "Product suggestions" });
  await expect(list).toBeVisible();
  expect(await list.getByRole("button").count()).toBeGreaterThan(1);
  await expect(page.getByText(/products match “Cable”\. Pick one\./)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No product" })).toHaveCount(0);
  await list.getByRole("button", { name: /HDMI 2\.1 Cable 2 m/ }).click();
  await expect(page.getByTestId("cart-line-CBL-HDMI-2M")).toBeVisible();
  await expect(list).toBeHidden();

  // An unknown scanned barcode is still an error (never a name/SKU search).
  await scan.fill("2000000000999");
  await scan.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "No product with barcode or SKU “2000000000999”." })).toBeVisible();
});

test("name matches stay visible above an open on-screen keyboard", async ({ page }) => {
  await openPosAsCashier(page);
  // Android resizes the viewport for the keyboard (iOS shrinks the visual viewport,
  // which the list also follows): 390 x 420 is a 390 x 844 phone with the keyboard open.
  await page.setViewportSize({ width: 390, height: 420 });
  const scan = page.getByLabel(/Scan or search/);
  await scan.fill("Cable");
  await scan.press("Enter");
  const list = page.getByRole("list", { name: "Product suggestions" });
  await expect(list).toBeVisible();
  await expect(scan).toBeInViewport();
  const box = (await list.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  // Capped to the visible area above the fixed total/Charge bar; it scrolls inside.
  const bar = (await page.locator("[data-pos-bottom-bar]").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await expect(list.getByRole("button").first()).toBeInViewport({ ratio: 1 });
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/pos-mobile-keyboard-open.png" });
});
