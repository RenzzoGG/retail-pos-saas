import { expect, test } from "@playwright/test";
import { DEMO, signInAs } from "./auth";

/**
 * Admin creates a product, receives stock by "scanning" its barcode (a USB
 * scanner types fast and presses Enter), sees stock/cost and the activity
 * log; the cashier sees the product without cost or edit buttons.
 */
const run = Date.now();
const product = {
  name: `E2E Scanner Cable ${run}`,
  sku: `E2E-${run}`,
  barcode: `8${String(run).slice(-12)}`,
};

test("admin receives stock by scanning; cashier sees no costs", async ({ browser }) => {
  // ---------------------------------------------------------- admin: create
  const admin = await signInAs(browser, DEMO.admin);
  await admin.goto("/app/products");
  await admin.getByRole("link", { name: "New product" }).click();
  await admin.getByLabel("Name").fill(product.name);
  await admin.getByLabel("SKU").fill(product.sku);
  await admin.getByLabel("Barcode (optional)").fill(product.barcode);
  await admin.getByLabel("Category (optional)").fill("E2E");
  await admin.getByLabel("Sale price").fill("19.99");
  await admin.getByLabel("Low-stock threshold").fill("2");
  await admin.getByRole("button", { name: "Create product" }).click();

  await expect(admin.getByRole("status").filter({ hasText: "Product created" })).toBeVisible();
  await expect(admin.getByTestId("product-stock")).toContainText("0");
  await expect(admin.getByTestId("product-stock")).toContainText("Out of stock");
  await expect(admin.getByTestId("product-cost")).toHaveText("—");

  // ------------------------------------------------- admin: receive by scan
  await admin.getByRole("navigation", { name: "Products section" }).getByRole("link", { name: "Receive stock" }).click();
  const scan = admin.getByLabel("Scan or search");
  await expect(scan).toBeFocused(); // ready for the scanner without clicking
  await admin.keyboard.type(product.barcode, { delay: 5 }); // scanner-like typing
  await admin.keyboard.press("Enter");
  const line = admin.getByTestId(`entry-line-${product.sku}`);
  await expect(line).toBeVisible();
  await expect(admin.getByRole("status").filter({ hasText: `Added ${product.name}` })).toBeVisible();

  // Scanning the same item again adds one more unit.
  await admin.keyboard.type(product.barcode, { delay: 5 });
  await admin.keyboard.press("Enter");
  await expect(line.getByLabel(`Quantity of ${product.name}`)).toHaveValue("2");

  // Unknown codes are reported, not added.
  await admin.keyboard.type("0000000000000", { delay: 5 });
  await admin.keyboard.press("Enter");
  await expect(admin.getByRole("alert").filter({ hasText: "No product with barcode or SKU" })).toBeVisible();

  await line.getByLabel(`Quantity of ${product.name}`).fill("12");
  await line.getByLabel(`Unit cost of ${product.name}`).fill("7.25");
  await expect(admin.getByTestId("entry-total")).toHaveText("$87.00");
  await admin.getByLabel("Supplier (optional)").fill("E2E Supplier");
  await admin.getByRole("button", { name: "Receive stock" }).click();

  await expect(admin.getByRole("status").filter({ hasText: "Stock received: 12 units of 1 product" })).toBeVisible();
  await expect(admin.getByRole("cell", { name: "$87.00" }).first()).toBeVisible();

  // ----------------------------------------- admin: stock and cost updated
  await admin.goto(`/app/products?q=${product.sku}`);
  const row = admin.getByTestId(`product-${product.sku}`);
  await expect(row).toContainText("$19.99");
  await expect(row).toContainText("$7.25"); // weighted average cost (first entry)
  await expect(row).toContainText("12");
  await row.getByRole("link", { name: `Edit ${product.name}` }).click();
  await expect(admin.getByTestId("product-stock")).toHaveText("12");
  await expect(admin.getByTestId("product-cost")).toHaveText("$7.25");
  await expect(admin.getByRole("cell", { name: "+12" })).toBeVisible(); // movement in the ledger

  // ------------------------------------------------ admin: activity log
  await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  const created = admin.getByTestId("activity-item").filter({ hasText: `Product “${product.name}” created` });
  await expect(created).toBeVisible();
  await expect(created).toContainText("Adam Admin");

  // ------------------------------------------------------ cashier: no costs
  const cashier = await signInAs(browser, DEMO.cashier);
  await cashier.goto(`/app/products?q=${product.sku}`);
  const cashierRow = cashier.getByTestId(`product-${product.sku}`);
  await expect(cashierRow).toContainText("$19.99");
  await expect(cashierRow).toContainText("12");
  await expect(cashierRow).not.toContainText("$7.25");
  await expect(cashier.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
  await expect(cashier.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);
  await expect(cashier.getByRole("link", { name: "New product" })).toHaveCount(0);
  await expect(cashierRow.getByRole("link", { name: /Edit/ })).toHaveCount(0);
  await expect(cashier.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" })).toHaveCount(0);
  await cashier.goto("/app/products/receive");
  await expect(cashier.getByText("This page could not be found.")).toBeVisible();

  // ---------------------------------------------------- cleanup (soft delete)
  await admin.goto(`/app/products?q=${product.sku}`);
  await admin.getByTestId(`product-${product.sku}`).getByRole("link", { name: `Edit ${product.name}` }).click();
  admin.once("dialog", (dialog) => dialog.accept());
  await admin.getByRole("button", { name: "Delete product" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Product deleted." })).toBeVisible();
  await expect(admin.getByTestId(`product-${product.sku}`)).toHaveCount(0);
});

test("fast consecutive scans are all counted", async ({ browser }) => {
  // Two scans typed back to back, without waiting for the first lookup.
  const admin = await signInAs(browser, DEMO.admin);
  await admin.goto("/app/products/receive", { waitUntil: "networkidle" }); // page fully interactive
  await admin.getByLabel("Scan or search").focus();
  for (const code of ["2000000000015", "2000000000022", "2000000000015"]) {
    await admin.keyboard.type(code, { delay: 2 });
    await admin.keyboard.press("Enter");
  }
  await expect(admin.getByTestId("entry-line-CBL-USBC-1M").getByLabel(/^Quantity of/)).toHaveValue("2");
  await expect(admin.getByTestId("entry-line-CBL-USBC-2M").getByLabel(/^Quantity of/)).toHaveValue("1");
  await expect(admin.getByLabel("Scan or search")).toHaveValue("");
  // Nothing is saved: the test leaves without submitting.
});
