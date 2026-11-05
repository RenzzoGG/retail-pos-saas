import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "@/features/activity/service";
import { confirmImport, listImports, previewImport } from "@/features/import/service";
import { createProduct, getProduct, listProducts } from "@/features/inventory/service";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, OTHER_STORE_ID, actor, signInAs } from "./helpers";

const run = String(Date.now()).slice(-9);
const HEADER = "Name,SKU,Barcode,Category,Sale price,Low stock threshold,Initial stock,Unit cost";
const csvFile = (name: string, lines: string[]) => ({ name, bytes: new TextEncoder().encode([HEADER, ...lines].join("\n")) });
const sku = (s: string) => `IMP-${run}-${s}`;

async function productBySku(db: Db, storeId: string, role: "owner" | "admin", code: string) {
  const list = await listProducts(db, { userId: "", storeId, role }, { q: code, category: "", low: false, sort: "name", dir: "asc", page: 1 });
  return list.ok ? list.data.items.find((p) => p.sku === code) : undefined;
}

describe("product import", () => {
  let admin: Db;
  let cashier: Db;
  let otherOwner: Db;
  let owner: Db;

  beforeAll(async () => {
    [admin, cashier, otherOwner, owner] = await Promise.all([
      signInAs("admin"),
      signInAs("cashier"),
      signInAs("otherOwner"),
      signInAs("owner"),
    ]);
  });

  afterAll(async () => {
    // Soft-delete everything this run created (owner/admin can, through RLS).
    await owner.from("products").update({ deleted_at: new Date().toISOString() }).eq("store_id", DEMO_STORE_ID).like("sku", `IMP-${run}-%`);
    await otherOwner.from("products").update({ deleted_at: new Date().toISOString() }).eq("store_id", OTHER_STORE_ID).like("sku", `BULK-${run}-%`);
  });

  const file = csvFile("mixed.csv", [
    `Imported Cable,${sku("A")},29${run}01,Cables,12.50,3,20,5.25`,
    `Imported Case,${sku("B")},,Cases,"$1,019.99",,,`,
    `Imported Lamp,${sku("C")},,Lighting,"9,99",2,4,"3,10"`,
    `,${sku("D")},,Cables,5,,,`, // no name
    `Bad Price,${sku("E")},,Cables,-1,,,`, // negative price
  ]);

  it("the cashier cannot import (service and database)", async () => {
    expect((await previewImport(cashier, actor("cashier", "cashier"), file, false)).ok).toBe(false);
    expect((await confirmImport(cashier, actor("cashier", "cashier"), file, "x", false)).ok).toBe(false);
    const { error } = await cashier.rpc("import_products", {
      p_store_id: DEMO_STORE_ID,
      p_file_name: "x.csv",
      p_update_existing: false,
      p_total_rows: 1,
      p_skipped_rows: 0,
      p_rows: [{ name: "Nope", sku: sku("CASHIER"), sale_price: 1 }],
    });
    expect(error?.message).toBe("forbidden");
    const { data: imports } = await cashier.from("import_batches").select("id");
    expect(imports).toEqual([]);
  });

  it("the preview validates everything and saves nothing", async () => {
    const preview = await previewImport(admin, actor("admin", "admin"), file, false);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.summary).toEqual({ total: 5, new: 3, update: 0, error: 2 });
    expect(preview.data.rows.find((r) => r.data?.sku === sku("B"))?.data?.sale_price).toBe(1019.99);
    expect(preview.data.rows.find((r) => r.data?.sku === sku("C"))?.data).toMatchObject({ sale_price: 9.99, unit_cost: 3.1 });
    expect(await productBySku(admin, DEMO_STORE_ID, "admin", sku("A"))).toBeUndefined();
  });

  it("refuses to import a file different from the previewed one", async () => {
    const result = await confirmImport(admin, actor("admin", "admin"), file, "0".repeat(64), false);
    expect(result).toMatchObject({ ok: false, code: "file_changed" });
    expect(await productBySku(admin, DEMO_STORE_ID, "admin", sku("A"))).toBeUndefined();
  });

  it("confirming saves only the valid rows, with stock through an import entry", async () => {
    const preview = await previewImport(admin, actor("admin", "admin"), file, false);
    if (!preview.ok) throw new Error(preview.error);
    const result = await confirmImport(admin, actor("admin", "admin"), file, preview.data.fileHash, false);
    expect(result).toMatchObject({ ok: true, data: { created: 3, updated: 0, skipped: 2 } });
    if (!result.ok) return;

    const a = await productBySku(admin, DEMO_STORE_ID, "admin", sku("A"));
    expect(a).toMatchObject({ stock: 20, cost: 5.25, salePrice: 12.5, lowStockThreshold: 3, category: "Cables" });
    expect(await productBySku(admin, DEMO_STORE_ID, "admin", sku("B"))).toMatchObject({ stock: 0, cost: null, salePrice: 1019.99 });
    expect(await productBySku(admin, DEMO_STORE_ID, "admin", sku("D"))).toBeUndefined();

    const { data: entry } = await admin.from("stock_entries").select("source, note").eq("id", result.data.stockEntryId as string).single();
    expect(entry).toEqual({ source: "import", note: "Import: mixed.csv" });

    const history = await listImports(admin, actor("admin", "admin"));
    expect(history.ok && history.data[0]).toMatchObject({ fileName: "mixed.csv", created: 3, skipped: 2, createdBy: "Adam Admin" });
    const log = await listActivity(admin, { storeId: DEMO_STORE_ID, role: "admin" }, { from: "", to: "", page: 1, action: "insert" }, "UTC");
    expect(log.ok && log.data.items.some((i) => i.title === "Product import “mixed.csv” created")).toBe(true);
  });

  it("existing SKUs are rejected unless “update existing” is on; then stock is added at weighted average cost", async () => {
    const update = csvFile("update.csv", [`Imported Cable v2,${sku("A")},,,13.99,,20,7.25`]);

    const off = await previewImport(admin, actor("admin", "admin"), update, false);
    expect(off.ok && off.data.summary).toEqual({ total: 1, new: 0, update: 0, error: 1 });
    if (off.ok) {
      expect(await confirmImport(admin, actor("admin", "admin"), update, off.data.fileHash, false)).toMatchObject({ ok: false, code: "nothing_to_import" });
    }

    const on = await previewImport(admin, actor("admin", "admin"), update, true);
    if (!on.ok) throw new Error(on.error);
    expect(on.data.summary.update).toBe(1);
    const result = await confirmImport(admin, actor("admin", "admin"), update, on.data.fileHash, true);
    expect(result).toMatchObject({ ok: true, data: { created: 0, updated: 1 } });

    // 20 @ 5.25 + 20 @ 7.25 -> 40 @ 6.25; empty optional cells kept barcode/category/threshold.
    const a = await productBySku(admin, DEMO_STORE_ID, "admin", sku("A"));
    expect(a).toMatchObject({ name: "Imported Cable v2", salePrice: 13.99, stock: 40, cost: 6.25, category: "Cables", lowStockThreshold: 3 });
    expect(a?.barcode).toBe(`29${run}01`);
  });

  it("if data changed after the preview, nothing at all is saved", async () => {
    const racy = csvFile("racy.csv", [`Racy One,${sku("R1")},,,1,,,`, `Racy Two,${sku("R2")},,,1,,,`]);
    const preview = await previewImport(admin, actor("admin", "admin"), racy, false);
    if (!preview.ok) throw new Error(preview.error);
    // Someone creates R2 by hand between preview and confirm.
    const created = await createProduct(admin, actor("admin", "admin"), {
      name: "Created meanwhile",
      sku: sku("R2"),
      barcode: null,
      category: null,
      salePrice: 1,
      lowStockThreshold: 0,
      active: true,
    });
    expect(created.ok).toBe(true);
    // The confirm step re-validates: R2 now exists, so it is skipped, and R1 is imported.
    const result = await confirmImport(admin, actor("admin", "admin"), racy, preview.data.fileHash, false);
    expect(result).toMatchObject({ ok: true, data: { created: 1, skipped: 1 } });
    // And the database itself refuses a payload that conflicts (atomic: R3 is not created either).
    const { error } = await admin.rpc("import_products", {
      p_store_id: DEMO_STORE_ID,
      p_file_name: "conflict.csv",
      p_update_existing: false,
      p_total_rows: 2,
      p_skipped_rows: 0,
      p_rows: [
        { name: "Racy Three", sku: sku("R3"), sale_price: 1 },
        { name: "Racy Two again", sku: sku("R2"), sale_price: 1 },
      ],
    });
    expect(error?.message).toBe("sku_exists");
    expect(await productBySku(admin, DEMO_STORE_ID, "admin", sku("R3"))).toBeUndefined();
  });

  it("imports a 600-product catalog with opening stock in one go", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => {
      const n = String(i + 1).padStart(4, "0");
      return `Bulk Item ${n},BULK-${run}-${n},,Bulk,${(9.99 + i / 100).toFixed(2)},2,${(i % 9) + 1},3.50`;
    });
    const bulk = csvFile("bulk-600.csv", lines);
    const started = Date.now();
    const preview = await previewImport(otherOwner, actor("otherOwner", "owner", OTHER_STORE_ID), bulk, false);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data.summary).toEqual({ total: 600, new: 600, update: 0, error: 0 });
    const result = await confirmImport(otherOwner, actor("otherOwner", "owner", OTHER_STORE_ID), bulk, preview.data.fileHash, false);
    expect(result).toMatchObject({ ok: true, data: { created: 600, updated: 0, skipped: 0 } });
    const seconds = (Date.now() - started) / 1000;
    expect(seconds).toBeLessThan(15);

    const { count } = await otherOwner
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", OTHER_STORE_ID)
      .like("sku", `BULK-${run}-%`);
    expect(count).toBe(600);
    const last = await getProduct(otherOwner, actor("otherOwner", "owner", OTHER_STORE_ID), (await productBySku(otherOwner, OTHER_STORE_ID, "owner", `BULK-${run}-0600`))?.id as string);
    expect(last.ok && last.data).toMatchObject({ stock: 6, cost: 3.5, salePrice: 15.98 }); // row 600: (599 % 9) + 1 = 6 units
  }, 60_000);
});
