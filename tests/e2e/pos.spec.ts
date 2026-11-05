import { type Page, expect, test } from "@playwright/test";
import { DEMO, signInAs } from "./auth";

/**
 * Cashier rings up a sale with the keyboard and a (simulated) barcode scanner:
 * scans, edits a quantity, applies discounts within the cashier limit, pays
 * with card + cash, gets the change; a double click registers ONE sale; the
 * sale shows up in the history and the stock goes down.
 */
const PRODUCTS = {
  cable: { sku: "CBL-USBC-1M", barcode: "2000000000015" }, // 9.99
  charger: { sku: "CHG-20W-C", barcode: "2000000000053" }, // 19.99
  case: { sku: "CAS-IP15-CLR", barcode: "2000000000152" }, // 15.99
};

async function stockOf(page: Page, sku: string): Promise<number> {
  await page.goto(`/app/products?q=${sku}`);
  const text = await page.getByTestId(`product-${sku}`).locator("td").last().innerText();
  return Number(text.split(/\s/)[0]);
}

async function latestSaleNumber(page: Page): Promise<number> {
  await page.goto("/app/sales");
  const first = page.locator('[data-testid^="sale-row-"]').first();
  return (await first.count()) === 0 ? 0 : Number((await first.getAttribute("data-testid"))?.replace("sale-row-", ""));
}

test("cashier sells with scanner, discounts and a split payment; double click = one sale", async ({ browser }) => {
  const cashier = await signInAs(browser, DEMO.cashier);
  const before = {
    cable: await stockOf(cashier, PRODUCTS.cable.sku),
    charger: await stockOf(cashier, PRODUCTS.charger.sku),
    case: await stockOf(cashier, PRODUCTS.case.sku),
    lastSale: await latestSaleNumber(cashier),
  };

  await cashier.goto("/app/pos", { waitUntil: "networkidle" });
  const scan = cashier.getByLabel(/Scan or search/);
  await expect(scan).toBeFocused();

  // Fast consecutive scans (cable twice).
  for (const code of [PRODUCTS.cable.barcode, PRODUCTS.cable.barcode, PRODUCTS.charger.barcode, PRODUCTS.case.barcode]) {
    await cashier.keyboard.type(code, { delay: 2 });
    await cashier.keyboard.press("Enter");
  }
  await expect(cashier.getByTestId(`cart-line-${PRODUCTS.cable.sku}`).getByLabel(/^Quantity of/)).toHaveValue("2");
  await expect(cashier.getByTestId(`cart-line-${PRODUCTS.case.sku}`)).toBeVisible();
  await cashier.getByTestId(`cart-line-${PRODUCTS.case.sku}`).getByLabel(/^Quantity of/).fill("2");
  await cashier.keyboard.press("Enter"); // commits and returns focus to the scan field
  await expect(scan).toBeFocused();
  // 2 x 9.99 + 19.99 + 2 x 15.99 = 71.95
  await expect(cashier.getByTestId("pos-total")).toHaveText("$71.95");

  // A 20 % sale discount is over the cashier's 10 % limit: blocked before charging.
  await cashier.getByLabel("Discount on the whole sale: percent or amount").selectOption("percent");
  await cashier.getByLabel("Discount on the whole sale", { exact: true }).fill("20");
  await expect(cashier.getByRole("alert").filter({ hasText: "your limit is 10%" })).toBeVisible();
  await expect(cashier.getByRole("button", { name: /^Charge/ })).toBeDisabled();

  // Within the limit: 10 % off the charger line (2.00) + 3.00 off the sale = 5.00 (6.95 %).
  await cashier.getByLabel("Discount on 20 W USB-C Wall Charger: percent or amount").selectOption("percent");
  await cashier.getByLabel("Discount on 20 W USB-C Wall Charger", { exact: true }).fill("10");
  await cashier.getByLabel("Discount on the whole sale: percent or amount").selectOption("amount");
  await cashier.getByLabel("Discount on the whole sale", { exact: true }).fill("3");
  await expect(cashier.getByTestId("pos-total")).toHaveText("$66.95");

  // ---------------------------------------------------------- payment (F8)
  await cashier.keyboard.press("F8");
  const dialog = cashier.getByRole("dialog", { name: "Payment" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("checkout-total")).toHaveText("$66.95");
  await dialog.getByLabel("Method").first().selectOption("card");
  await dialog.locator("#pay-amount-0").fill("40");
  await dialog.getByRole("button", { name: "Add payment method" }).click();
  await dialog.locator("#pay-method-1").selectOption("cash");
  await expect(dialog.locator("#pay-amount-1")).toHaveValue("26.95"); // the rest, filled in
  await dialog.locator("#pay-tendered-1").fill("30");
  await expect(dialog.getByTestId("checkout-change")).toHaveText("$3.05");
  await expect(dialog.getByTestId("checkout-remaining")).toHaveText("$0.00");

  // Double click on "Complete sale": still one sale.
  await dialog.getByRole("button", { name: /Complete sale/ }).dblclick();

  await expect(cashier.getByRole("heading", { name: `Sale #${before.lastSale + 1} completed` })).toBeVisible();
  await expect(cashier.getByTestId("sale-done-total")).toHaveText("$66.95");
  await expect(cashier.getByTestId("sale-done-change")).toHaveText("$3.05");

  // ----------------------------------------------- history: exactly one sale
  expect(await latestSaleNumber(cashier)).toBe(before.lastSale + 1);
  const row = cashier.getByTestId(`sale-row-${before.lastSale + 1}`);
  await expect(row).toContainText("$66.95");
  await expect(row).toContainText("Card + Cash");
  await expect(cashier.getByRole("columnheader", { name: "Profit" })).toHaveCount(0); // cashier: no profit
  await row.getByRole("link").click();
  await expect(cashier.getByText("Cash (received $30.00)")).toBeVisible();
  await expect(cashier.getByTestId("sale-profit")).toHaveCount(0);

  // ------------------------------------------------------- stock went down
  expect(await stockOf(cashier, PRODUCTS.cable.sku)).toBe(before.cable - 2);
  expect(await stockOf(cashier, PRODUCTS.charger.sku)).toBe(before.charger - 1);
  expect(await stockOf(cashier, PRODUCTS.case.sku)).toBe(before.case - 2);
});

test("keyboard flow: new sale with Enter and the cart survives a reload", async ({ browser }) => {
  const cashier = await signInAs(browser, DEMO.cashier);
  await cashier.goto("/app/pos", { waitUntil: "networkidle" });
  await cashier.keyboard.type(PRODUCTS.cable.barcode, { delay: 2 });
  await cashier.keyboard.press("Enter");
  await expect(cashier.getByTestId(`cart-line-${PRODUCTS.cable.sku}`)).toBeVisible();

  // A scan that lands in a quantity field by mistake is treated as a scan.
  const cableQty = cashier.getByTestId(`cart-line-${PRODUCTS.cable.sku}`).getByLabel(/^Quantity of/);
  await cableQty.click();
  await cashier.keyboard.type(PRODUCTS.case.barcode, { delay: 2 });
  await cashier.keyboard.press("Enter");
  await expect(cashier.getByTestId(`cart-line-${PRODUCTS.case.sku}`)).toBeVisible();
  await expect(cableQty).toHaveValue("1");
  await cashier.getByRole("button", { name: `Remove Clear Case for iPhone 15` }).click();

  await cashier.reload({ waitUntil: "networkidle" });
  await expect(cashier.getByTestId(`cart-line-${PRODUCTS.cable.sku}`)).toBeVisible(); // kept in sessionStorage

  await cashier.keyboard.press("F8");
  await cashier.getByRole("dialog", { name: "Payment" }).locator("#pay-tendered-0").fill("10");
  await cashier.keyboard.press("F9");
  await expect(cashier.getByRole("heading", { name: /Sale #\d+ completed/ })).toBeVisible();
  await expect(cashier.getByTestId("sale-done-change")).toHaveText("$0.01");
  await cashier.keyboard.press("Enter");
  await expect(cashier.getByText("The cart is empty. Scan a product to start a sale.")).toBeVisible();
});
