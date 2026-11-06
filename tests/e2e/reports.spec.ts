import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { DEMO, signInAs } from "./auth";

/**
 * The owner sees the dashboard with the seed's 60 days of sales, changes the
 * range in Reports and downloads the Excel file; the cashier sees a dashboard
 * without profit and gets a 404 for reports and for the export.
 */
test("owner: dashboard with data, reports by range and Excel export", async ({ browser }) => {
  const owner = await signInAs(browser, DEMO.owner);
  await expect(owner.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(owner.getByTestId("sales-month-value")).not.toHaveText("$0.00");
  await expect(owner.getByTestId("kpi-profit")).toContainText("Gross profit");
  const chart = owner.getByTestId("chart-30-days");
  await expect(chart.getByRole("img", { name: /Sales per day, last 30 days\. 30 periods/ })).toBeVisible();
  await chart.getByText("Show data table").click();
  await expect(chart.getByRole("table").locator("tbody tr")).toHaveCount(30);
  await expect(owner.getByTestId("top-products").getByRole("listitem")).toHaveCount(5);

  // Period switch keeps the page and changes the KPIs' period.
  await owner.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Today" }).click();
  await expect(owner).toHaveURL(/period=today/);
  await expect(owner.getByRole("heading", { name: /^Today/ })).toBeVisible();

  // ------------------------------------------------------------- reports
  await owner.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Reports" })).toBeVisible();
  const gross = owner.getByTestId("report-gross-value");
  const quick = owner.getByRole("navigation", { name: "Quick ranges" });
  await quick.getByRole("link", { name: "Last month" }).click();
  await expect(owner).toHaveURL(/preset=lastMonth/);
  await expect(quick.getByRole("link", { name: "Last month" })).toHaveAttribute("aria-current", "page");
  const lastMonth = await gross.innerText();
  await quick.getByRole("link", { name: "Last 7 days" }).click();
  await expect(owner).toHaveURL(/preset=last7/);
  await expect(gross).not.toHaveText(lastMonth);
  const last7 = await gross.innerText();
  expect(last7).not.toBe("$0.00");
  await expect(owner.getByTestId("report-products").locator("tbody tr").first()).toBeVisible();
  await expect(owner.getByTestId("report-cashiers")).toContainText("Carla Cashier");

  // Custom range (in the store's time zone), then back to 7 days.
  await owner.getByLabel("From", { exact: true }).fill("2026-01-01");
  await owner.getByLabel("To", { exact: true }).fill("2026-01-31");
  await owner.getByRole("button", { name: "Apply custom range" }).click();
  await expect(owner).toHaveURL(/preset=custom&from=2026-01-01&to=2026-01-31/);
  await expect(gross).toHaveText("$0.00"); // before the demo history
  await quick.getByRole("link", { name: "Last 7 days" }).click();
  await expect(gross).toHaveText(last7);

  // ---------------------------------------------------------- Excel file
  const [download] = await Promise.all([owner.waitForEvent("download"), owner.getByRole("link", { name: "Export to Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^stocktill-sales-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const book = XLSX.read(await readFile((await download.path()) as string), { type: "buffer", cellFormula: true });
  expect(book.SheetNames).toEqual(["Summary", "Sales", "Items"]);
  const summary = XLSX.utils.sheet_to_json<[string, unknown]>(book.Sheets.Summary!, { header: 1 });
  const grossInFile = Number(summary.find((r) => r[0] === "Gross sales")?.[1]);
  expect(`$${grossInFile.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).toBe(last7);
  const salesRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Sales!);
  expect(salesRows.length).toBe(Number(summary.find((r) => r[0] === "Sales")?.[1]));
  expect(salesRows[0]).toHaveProperty("Profit");
});

test("cashier: today's sales without profit; reports and export are not found", async ({ browser }) => {
  const cashier = await signInAs(browser, DEMO.cashier);
  await expect(cashier.getByTestId("today-store")).toContainText("Store sales today");
  await expect(cashier.getByTestId("today-mine")).toContainText("My sales today");
  await expect(cashier.getByText(/profit|cost/i)).toHaveCount(0);
  await expect(cashier.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);

  await cashier.goto("/app/reports");
  await expect(cashier.getByText("This page could not be found.")).toBeVisible(); // soft 404 (no hint)
  await expect(cashier.getByTestId("report-summary")).toHaveCount(0);
  const response = await cashier.request.get("/app/reports/export?preset=last7");
  expect(response.status()).toBe(404);
});
