import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { DEMO, signInAs } from "./auth";

/**
 * Admin downloads the template, uploads a file with valid and invalid rows,
 * reviews the preview, downloads the error report, confirms the import and
 * finds the products (with stock and cost) in the catalog.
 */
const run = String(Date.now()).slice(-8);
const SKU = (s: string) => `E2E-IMP-${run}-${s}`;
const FILE = `e2e-import-${run}.xlsx`;

test("admin imports products from Excel with a preview and an error report", async ({ browser }, testInfo) => {
  const admin = await signInAs(browser, DEMO.admin);
  await admin.goto("/app/products");
  await admin.getByRole("navigation", { name: "Products section" }).getByRole("link", { name: "Import" }).click();
  await expect(admin.getByRole("heading", { name: "Import products" })).toBeVisible();

  // ------------------------------------------------------------ template
  const [templateDownload] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("link", { name: "Download template (.xlsx)" }).click(),
  ]);
  expect(templateDownload.suggestedFilename()).toBe("stocktill-products-template.xlsx");
  const template = XLSX.read(readFileSync(await templateDownload.path()), { type: "buffer" });
  const templateRows = XLSX.utils.sheet_to_json<string[]>(template.Sheets[template.SheetNames[0] as string] as XLSX.WorkSheet, { header: 1 });
  expect(templateRows[0]).toEqual(["Name", "SKU", "Barcode", "Category", "Sale price", "Low stock threshold", "Initial stock", "Unit cost"]);

  // ------------------------------------------- file with valid + bad rows
  const rows = [
    templateRows[0] as string[],
    ["E2E Import Cable", SKU("A"), "", "E2E", 14.99, 3, 30, 4.5],
    ["E2E Import Charger", SKU("B"), "", "E2E", "$24.50", 2, 10, "8,25"],
    ["E2E Import Sticker", SKU("C"), "", "E2E", 1.99, "", "", ""],
    ["", SKU("D"), "", "E2E", 5, "", "", ""], // row 5: no name
    ["E2E Bad Stock", SKU("E"), "", "E2E", 5, "", 3, ""], // row 6: stock without cost
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Products");
  const filePath = testInfo.outputPath(FILE);
  writeFileSync(filePath, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));

  await admin.getByLabel("File (.xlsx or .csv)").setInputFiles(filePath);
  await admin.getByRole("button", { name: "Preview" }).click();

  // ------------------------------------------------------------- preview
  const summary = admin.getByTestId("import-summary");
  await expect(summary).toContainText("Rows5");
  await expect(summary).toContainText("New products3");
  await expect(summary).toContainText("With errors2");
  await expect(admin.getByTestId("import-row-5")).toHaveAttribute("data-status", "error");
  await expect(admin.getByTestId("import-row-5")).toContainText("Name is required.");
  await expect(admin.getByTestId("import-row-6")).toContainText("Unit cost is required when there is initial stock.");
  await expect(admin.getByTestId("import-row-2")).toContainText("Stock: +30 at 4.50 each");

  await admin.getByText("Errors (2)").click(); // filter
  await expect(admin.locator('[data-testid^="import-row-"]')).toHaveCount(2);
  await admin.getByText("All (5)").click();

  // --------------------------------------------------------- error report
  const [reportDownload] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("button", { name: "Download error report (CSV)" }).click(),
  ]);
  expect(reportDownload.suggestedFilename()).toBe(`errors-e2e-import-${run}.csv`);
  const report = readFileSync(await reportDownload.path(), "utf8").replace(/^﻿/, "").trim().split("\r\n");
  expect(report).toHaveLength(3);
  expect(report[0]).toContain("Row,Name,SKU");
  expect(report[1]).toMatch(new RegExp(`^5,,${SKU("D")},.*Name: Name is required\\.$`));
  expect(report[2]).toMatch(new RegExp(`^6,E2E Bad Stock,${SKU("E")},.*Unit cost is required when there is initial stock\\.$`));

  // -------------------------------------------------------------- confirm
  await admin.getByRole("button", { name: "Import 3 products" }).click();
  await expect(admin.getByRole("status").filter({ hasText: `Imported “${FILE}”: 3 created, 0 updated, 2 skipped.` })).toBeVisible();

  // ------------------------------------------------- catalog shows them
  await admin.getByRole("link", { name: "View catalog" }).click();
  await admin.goto(`/app/products?q=E2E-IMP-${run}`);
  await expect(admin.getByTestId(`product-${SKU("A")}`)).toContainText("$14.99");
  await expect(admin.getByTestId(`product-${SKU("A")}`)).toContainText("$4.50");
  await expect(admin.getByTestId(`product-${SKU("A")}`)).toContainText("30");
  await expect(admin.getByTestId(`product-${SKU("B")}`)).toContainText("$24.50");
  await expect(admin.getByTestId(`product-${SKU("B")}`)).toContainText("$8.25");
  await expect(admin.getByTestId(`product-${SKU("C")}`)).toContainText("Out of stock");
  await expect(admin.getByTestId(`product-${SKU("D")}`)).toHaveCount(0);

  // ------------------------------------------- history and activity log
  await admin.goto("/app/products/import");
  await expect(admin.getByRole("row", { name: new RegExp(FILE) })).toContainText("Adam Admin");
  await admin.goto("/app/activity");
  await expect(admin.getByTestId("activity-item").filter({ hasText: `Product import “${FILE}” created` })).toContainText(
    "created: 3, updated: 0, skipped: 2",
  );
});

test("the cashier has no access to imports", async ({ browser }) => {
  const cashier = await signInAs(browser, DEMO.cashier);
  await cashier.goto("/app/products/import");
  await expect(cashier.getByText("This page could not be found.")).toBeVisible();
  const template = await cashier.request.get("/app/products/import/template?format=csv");
  expect(template.status()).toBe(404);
});
