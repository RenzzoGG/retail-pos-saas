import { describe, expect, it } from "vitest";
import { describeActivity } from "@/features/activity/describe";
import { parseActivityQuery } from "@/features/activity/schemas";

const product = { id: "p1", store_id: "s1", name: "USB cable", sku: "CBL-1", sale_price: 9.99, stock: 10, is_low_stock: false, deleted_at: null, updated_at: "a" };

describe("describeActivity", () => {
  it("describes creations", () => {
    expect(describeActivity({ tableName: "products", action: "insert", before: null, after: product })).toEqual({
      entity: "Product",
      title: "Product “USB cable” created",
      details: [],
    });
  });

  it("lists only meaningful changes with readable labels", () => {
    const after = { ...product, sale_price: 12.5, stock: 3, is_low_stock: true, updated_at: "b", low_stock_threshold: 4 };
    const d = describeActivity({ tableName: "products", action: "update", before: { ...product, low_stock_threshold: 2 }, after });
    expect(d.title).toBe("Product “USB cable” updated");
    expect(d.details).toEqual(["sale price: 9.99 → 12.50", "low-stock threshold: 2 → 4"]);
  });

  it("recognizes soft deletes and restores", () => {
    expect(describeActivity({ tableName: "products", action: "update", before: product, after: { ...product, deleted_at: "x" } }).title).toBe(
      "Product “USB cable” deleted",
    );
    expect(describeActivity({ tableName: "products", action: "update", before: { ...product, deleted_at: "x" }, after: product }).title).toBe(
      "Product “USB cable” restored",
    );
  });

  it("formats store settings and team changes", () => {
    const store = { name: "Shop", tax_rate: 0.0825, prices_include_tax: true };
    expect(
      describeActivity({ tableName: "stores", action: "update", before: store, after: { ...store, tax_rate: 0.07, prices_include_tax: false } }).details,
    ).toEqual(["tax rate: 8.25% → 7%", "prices include tax: yes → no"]);
    expect(describeActivity({ tableName: "store_members", action: "update", before: { role: "cashier" }, after: { role: "admin" } })).toMatchObject({
      title: "Team member updated",
      details: ["role: cashier → admin"],
    });
    expect(describeActivity({ tableName: "invitations", action: "insert", before: null, after: { email: "a@b.co", role: "cashier" } })).toMatchObject({
      title: "Invitation “a@b.co” created",
      details: ["role: cashier"],
    });
  });

  it("describes product imports with their counts", () => {
    expect(
      describeActivity({
        tableName: "import_batches",
        action: "insert",
        before: null,
        after: { file_name: "catalog.xlsx", created_count: 590, updated_count: 5, skipped_count: 5 },
      }),
    ).toEqual({ entity: "Product import", title: "Product import “catalog.xlsx” created", details: ["created: 590, updated: 5, skipped: 5"] });
  });

  it("handles cost rows, sales and unknown tables", () => {
    expect(describeActivity({ tableName: "product_costs", action: "update", before: { cost_price: 3.2 }, after: { cost_price: 3.5 } }).details).toEqual([
      "cost: 3.20 → 3.50",
    ]);
    expect(describeActivity({ tableName: "sales", action: "insert", before: null, after: { number: 7, total: 39.97 } })).toMatchObject({
      title: "Sale “#7” created",
      details: ["total: 39.97"],
    });
    expect(describeActivity({ tableName: "weird_table", action: "delete", before: {}, after: null }).title).toBe("weird table removed");
  });
});


describe("activity query", () => {
  it("keeps valid filters", () => {
    expect(
      parseActivityQuery({ actor: "a0000000-0000-4000-8000-000000000001", action: "update", from: "2026-11-01", to: "2026-11-05", page: "2" }),
    ).toEqual({ actor: "a0000000-0000-4000-8000-000000000001", action: "update", from: "2026-11-01", to: "2026-11-05", page: 2 });
    expect(parseActivityQuery({ actor: "system" }).actor).toBe("system");
  });
  it("drops invalid ones", () => {
    expect(parseActivityQuery({ actor: "' or 1=1", action: "drop", from: "yesterday", page: "x" })).toEqual({
      actor: undefined,
      action: undefined,
      from: "",
      to: "",
      page: 1,
    });
  });
});
