import { readFile } from "node:fs/promises";
import { type Download, type Page, expect, test } from "@playwright/test";
import { pdfPageWidth, pdfText } from "../fixtures/pdf";
import { DEMO, signInAs } from "./auth";

/**
 * The cashier creates a customer from the register, sells and downloads the
 * ticket; the admin makes a partial return (one line written off as damaged),
 * downloads the return receipt and sees the sale, the stock and the customer's
 * history updated.
 */
const CABLE = { sku: "CBL-USBC-1M", barcode: "2000000000015" }; // 9.99
const CHARGER = { sku: "CHG-20W-C", barcode: "2000000000053" }; // 19.99

async function stockOf(page: Page, sku: string): Promise<number> {
  await page.goto(`/app/products?q=${sku}`);
  const text = await page.getByTestId(`product-${sku}`).locator("td").last().innerText();
  return Number(text.split(/\s/)[0]);
}

async function pdfOf(download: Download): Promise<{ name: string; text: string; width: number | null }> {
  const pdf = await readFile((await download.path()) as string);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  return { name: download.suggestedFilename(), text: pdfText(pdf), width: pdfPageWidth(pdf) };
}

test("cashier sells to a new customer and downloads the ticket; admin returns part of it", async ({ browser }) => {
  const customerName = `E2E Customer ${Date.now().toString().slice(-6)}`;
  const cashier = await signInAs(browser, DEMO.cashier);
  const before = { cable: await stockOf(cashier, CABLE.sku), charger: await stockOf(cashier, CHARGER.sku) };

  // ------------------------------------------- register: quick-create customer
  await cashier.goto("/app/pos", { waitUntil: "networkidle" });
  for (const code of [CABLE.barcode, CABLE.barcode, CHARGER.barcode]) {
    await cashier.keyboard.type(code, { delay: 2 });
    await cashier.keyboard.press("Enter");
  }
  await expect(cashier.getByTestId("pos-total")).toHaveText("$39.97");
  await cashier.getByRole("button", { name: "+ New customer" }).click();
  const newCustomer = cashier.getByRole("dialog", { name: "New customer" });
  await newCustomer.getByLabel("Name").fill(customerName);
  await newCustomer.getByLabel("Phone (optional)").fill("+1 555 0199");
  await newCustomer.getByRole("button", { name: "Add to sale" }).click();
  await expect(newCustomer).toBeHidden();
  await expect(cashier.getByRole("button", { name: `Remove customer ${customerName}` })).toBeVisible();

  await cashier.keyboard.press("F8");
  await cashier.getByRole("dialog", { name: "Payment" }).locator("#pay-tendered-0").fill("50");
  await cashier.keyboard.press("F9");
  const heading = cashier.getByRole("heading", { name: /Sale #\d+ completed/ });
  await expect(heading).toBeVisible();
  const saleNumber = Number((await heading.innerText()).match(/#(\d+)/)?.[1]);

  // ------------------------------------------------ ticket (PDF, 80 mm, no costs)
  const [ticketDownload] = await Promise.all([cashier.waitForEvent("download"), cashier.getByRole("link", { name: "Download PDF" }).click()]);
  const ticket = await pdfOf(ticketDownload);
  expect(ticket.name).toBe(`receipt-sale-${saleNumber}.pdf`);
  expect(ticket.width).toBeCloseTo(226.77, 1);
  for (const expected of [`Sale #${saleNumber}`, `Customer: ${customerName}`, "TOTAL                               $39.97", "Change                              $10.03", "Cashier: Carla Cashier"]) {
    expect(ticket.text).toContain(expected);
  }
  expect(ticket.text).not.toMatch(/cost|profit/i);

  // --------------------------------------- admin: partial return with a write-off
  const admin = await signInAs(browser, DEMO.admin);
  await admin.goto("/app/sales");
  await admin.getByTestId(`sale-row-${saleNumber}`).getByRole("link").click();
  await expect(admin.getByRole("heading", { name: `Sale #${saleNumber}` })).toBeVisible();
  const cableLine = admin.getByTestId(`return-line-${CABLE.sku}`);
  const chargerLine = admin.getByTestId(`return-line-${CHARGER.sku}`);
  await cableLine.getByRole("spinbutton").fill("1"); // back to stock (default)
  await chargerLine.getByRole("spinbutton").fill("1");
  await chargerLine.getByRole("checkbox").uncheck(); // damaged: not restocked
  await admin.getByLabel("Reason (optional)").fill("Charger arrived broken");
  await expect(admin.getByTestId("refund-preview")).toHaveText("$29.98"); // 9.99 + 19.99
  await admin.getByRole("button", { name: "Register return" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Return registered." })).toBeVisible();

  const [returnDownload] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Download return receipt" }).click()]);
  const receipt = await pdfOf(returnDownload);
  expect(receipt.name).toBe(`return-sale-${saleNumber}-1.pdf`);
  for (const expected of ["RETURN RECEIPT", `For sale #${saleNumber}`, "Not restocked (damaged)", "Charger arrived broken", "$29.98"]) {
    expect(receipt.text).toContain(expected);
  }
  expect(receipt.text).not.toMatch(/cost|profit/i);

  // ---------------------------------------------------------- sale updated
  await admin.reload();
  await expect(admin.getByText(/· Partially returned$/)).toBeVisible();
  await expect(admin.getByTestId("sale-refunded")).toHaveText("−$29.98");
  await expect(admin.getByTestId("sale-return")).toHaveCount(1);
  await expect(admin.getByTestId("sale-return")).toContainText("(not restocked)");
  await expect(admin.getByTestId(`sale-item-${CABLE.sku}`).locator("td").nth(5)).toHaveText("1");
  await expect(admin.getByTestId("sale-profit")).toContainText("(after returns)");
  await admin.goto("/app/sales");
  await expect(admin.getByTestId(`sale-row-${saleNumber}`)).toContainText("Partially returned");

  // ----------- stock (cashier view): cable back, the damaged charger not
  expect(await stockOf(cashier, CABLE.sku)).toBe(before.cable - 1);
  expect(await stockOf(cashier, CHARGER.sku)).toBe(before.charger - 1);

  // ---------------------------------------- the customer's purchase history
  await cashier.goto(`/app/customers?q=${encodeURIComponent(customerName)}`);
  await cashier.getByTestId(`customer-row-${customerName}`).getByRole("link").first().click();
  await expect(cashier.getByRole("heading", { name: customerName })).toBeVisible();
  await expect(cashier.getByTestId("customer-purchases")).toHaveText("1");
  await expect(cashier.getByTestId("customer-spent")).toHaveText("$9.99"); // 39.97 - 29.98
  await expect(cashier.getByTestId(`customer-sale-${saleNumber}`)).toContainText("Partially returned");
});
