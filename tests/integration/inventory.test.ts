import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "@/features/activity/service";
import {
  countLowStock,
  createProduct,
  createStockEntry,
  deleteProduct,
  findProductByCode,
  getProduct,
  listProductMovements,
  listProducts,
  listStockEntries,
  updateProduct,
} from "@/features/inventory/service";
import type { ProductInput, ProductListQuery } from "@/features/inventory/schemas";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, actor, signInAs } from "./helpers";

const run = Date.now();
const ALL: ProductListQuery = { q: "", category: "", low: false, sort: "name", dir: "asc", page: 1 };
const input = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  name: `Integration Widget ${run}`,
  sku: `IT-${run}`,
  barcode: `9${String(run).slice(-12)}`,
  category: "Integration",
  salePrice: 21.65,
  lowStockThreshold: 3,
  active: true,
  ...overrides,
});

describe("inventory permissions and stock entries", () => {
  let owner: Db;
  let admin: Db;
  let cashier: Db;
  let productId = "";

  beforeAll(async () => {
    [owner, admin, cashier] = await Promise.all([signInAs("owner"), signInAs("admin"), signInAs("cashier")]);
  });

  afterAll(async () => {
    if (productId) await deleteProduct(owner, actor("owner", "owner"), productId);
  });

  it("the cashier cannot create products (server and database)", async () => {
    const result = await createProduct(cashier, actor("cashier", "cashier"), input({ sku: `CASHIER-${run}` }));
    expect(result.ok).toBe(false);
    const { error } = await cashier
      .from("products")
      .insert({ store_id: DEMO_STORE_ID, sku: `CASHIER-${run}`, name: "Nope", sale_price: 1 });
    expect(error?.code).toBe("42501");
  });

  it("the admin creates a product that starts with no stock and no cost", async () => {
    const result = await createProduct(admin, actor("admin", "admin"), input());
    expect(result.ok).toBe(true);
    if (result.ok) productId = result.data;
    const product = await getProduct(admin, actor("admin", "admin"), productId);
    expect(product.ok && product.data).toMatchObject({ stock: 0, cost: null, isLowStock: true, salePrice: 21.65 });
  });

  it("SKU and barcode are unique per store", async () => {
    const dupSku = await createProduct(admin, actor("admin", "admin"), input({ barcode: null }));
    expect(dupSku).toMatchObject({ ok: false, code: "duplicate_sku" });
    const dupBarcode = await createProduct(admin, actor("admin", "admin"), input({ sku: `IT-B-${run}` }));
    expect(dupBarcode).toMatchObject({ ok: false, code: "duplicate_barcode" });
  });

  it("the cashier cannot edit or delete products", async () => {
    expect((await updateProduct(cashier, actor("cashier", "cashier"), productId, input({ salePrice: 1 }))).ok).toBe(false);
    expect((await deleteProduct(cashier, actor("cashier", "cashier"), productId)).ok).toBe(false);
    const { data } = await cashier.from("products").update({ sale_price: 1, deleted_at: new Date().toISOString() }).eq("id", productId).select("id");
    expect(data).toEqual([]);
    const product = await getProduct(owner, actor("owner", "owner"), productId);
    expect(product.ok && product.data?.salePrice).toBe(21.65);
  });

  it("the cashier cannot register stock entries", async () => {
    const line = { productId, quantity: 5, unitCost: 1 };
    expect((await createStockEntry(cashier, actor("cashier", "cashier"), { supplier: null, note: null, lines: [line] })).ok).toBe(false);
    const { error } = await cashier.rpc("create_stock_entry", {
      p_store_id: DEMO_STORE_ID,
      p_items: [{ product_id: productId, quantity: 5, unit_cost: 1 }],
    });
    expect(error?.message).toBe("forbidden");
  });

  it("computes the weighted average cost across several entries", async () => {
    const a = actor("admin", "admin");
    // 10 @ 4.00 -> cost 4.00
    expect((await createStockEntry(admin, a, { supplier: "Supplier A", note: null, lines: [{ productId, quantity: 10, unitCost: 4 }] })).ok).toBe(true);
    // + 10 @ 6.00 -> (10*4 + 10*6) / 20 = 5.00
    expect((await createStockEntry(admin, a, { supplier: "Supplier B", note: null, lines: [{ productId, quantity: 10, unitCost: 6 }] })).ok).toBe(true);
    // + 5 @ 7.50 -> (20*5 + 5*7.5) / 25 = 5.50
    expect((await createStockEntry(owner, actor("owner", "owner"), { supplier: null, note: "top-up", lines: [{ productId, quantity: 5, unitCost: 7.5 }] })).ok).toBe(true);

    const product = await getProduct(admin, a, productId);
    expect(product.ok && product.data).toMatchObject({ stock: 25, cost: 5.5, isLowStock: false });

    const movements = await listProductMovements(admin, a, productId);
    expect(movements.ok && movements.data.items.map((m) => [m.type, m.quantity, m.stockAfter])).toEqual([
      ["entry", 5, 25],
      ["entry", 10, 20],
      ["entry", 10, 10],
    ]);
    expect(movements.ok && movements.data.items.every((m) => m.entryId)).toBe(true);

    const entries = await listStockEntries(admin, a);
    expect(entries.ok && entries.data.items.some((e) => e.supplier === "Supplier B" && e.units === 10 && e.totalCost === 60)).toBe(true);
  });

  it("owner/admin see costs; the cashier sees the product without them", async () => {
    const asCashier = await listProducts(cashier, actor("cashier", "cashier"), { ...ALL, q: `IT-${run}` });
    expect(asCashier.ok && asCashier.data.items).toHaveLength(1);
    expect(asCashier.ok && asCashier.data.items[0]).toMatchObject({ salePrice: 21.65, stock: 25, cost: null });

    // Even asking for the cost directly returns nothing to a cashier (RLS).
    const { data } = await cashier.from("products").select("id, product_costs(cost_price)").eq("id", productId).single();
    expect(data?.product_costs).toEqual([]);
    const { data: costs } = await cashier.from("product_costs").select("cost_price").eq("product_id", productId);
    expect(costs).toEqual([]);

    const asOwner = await listProducts(owner, actor("owner", "owner"), { ...ALL, q: `IT-${run}` });
    expect(asOwner.ok && asOwner.data.items[0]?.cost).toBe(5.5);
  });

  it("finds products by scanned barcode or SKU and searches safely", async () => {
    const byBarcode = await findProductByCode(admin, actor("admin", "admin"), input().barcode as string);
    expect(byBarcode.ok && byBarcode.data?.id).toBe(productId);
    const bySku = await findProductByCode(admin, actor("admin", "admin"), `IT-${run}`);
    expect(bySku.ok && bySku.data?.id).toBe(productId);
    const injection = await listProducts(admin, actor("admin", "admin"), { ...ALL, q: "x),store_id.neq.(0" });
    expect(injection.ok && injection.data.items).toEqual([]);
  });

  it("filters, sorts and paginates on the server", async () => {
    const a = actor("owner", "owner");
    const page1 = await listProducts(owner, a, { ...ALL, sort: "sale_price", dir: "desc" }, 5);
    expect(page1.ok && page1.data.items).toHaveLength(5);
    const prices = page1.ok ? page1.data.items.map((p) => p.salePrice) : [];
    expect([...prices].sort((x, y) => y - x)).toEqual(prices);
    const page2 = await listProducts(owner, a, { ...ALL, sort: "sale_price", dir: "desc", page: 2 }, 5);
    const ids1 = new Set(page1.ok ? page1.data.items.map((p) => p.id) : []);
    expect(page2.ok && page2.data.items.some((p) => ids1.has(p.id))).toBe(false);

    const low = await listProducts(owner, a, { ...ALL, low: true }, 100);
    expect(low.ok && low.data.items.every((p) => p.stock <= p.lowStockThreshold)).toBe(true);
    expect(await countLowStock(owner, DEMO_STORE_ID)).toBe(low.ok ? low.data.items.filter((p) => p.active).length : -1);

    const cables = await listProducts(owner, a, { ...ALL, category: "Cables" }, 100);
    expect(cables.ok && cables.data.items.length).toBeGreaterThan(0);
    expect(cables.ok && cables.data.items.every((p) => p.category === "Cables")).toBe(true);
  });

  it("the activity log records who created the product; cashiers can't read it", async () => {
    const log = await listActivity(owner, { storeId: DEMO_STORE_ID, role: "owner" }, { from: "", to: "", page: 1, action: "insert" }, "America/New_York");
    expect(log.ok && log.data.items.find((i) => i.title === `Product “Integration Widget ${run}” created`)?.actorName).toBe("Adam Admin");
    expect((await listActivity(cashier, { storeId: DEMO_STORE_ID, role: "cashier" }, { from: "", to: "", page: 1 }, "UTC")).ok).toBe(false);
    const { data } = await cashier.from("activity_log").select("id").limit(1);
    expect(data).toEqual([]);
  });

  it("soft-deleted products leave the catalog", async () => {
    expect((await deleteProduct(admin, actor("admin", "admin"), productId)).ok).toBe(true);
    const after = await listProducts(admin, actor("admin", "admin"), { ...ALL, q: `IT-${run}` });
    expect(after.ok && after.data.items).toEqual([]);
    productId = ""; // already deleted
  });
});
