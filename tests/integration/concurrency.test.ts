import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, createStockEntry } from "@/features/inventory/service";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, actor, signInAs } from "./helpers";

/**
 * Real concurrency (pending since phase 2): two different sessions (owner and
 * cashier) call create_sale at the same time for the LAST unit of a product.
 * Each HTTP request runs in its own database connection, so the row lock in
 * create_sale is what decides. Repeated for 10 products at once.
 */
const run = String(Date.now()).slice(-8);
const PRODUCTS = 10;

describe("concurrent sales of the last unit", () => {
  let owner: Db;
  let cashier: Db;
  const ids: string[] = [];

  beforeAll(async () => {
    [owner, cashier] = await Promise.all([signInAs("owner"), signInAs("cashier")]);
    for (let i = 0; i < PRODUCTS; i++) {
      const created = await createProduct(owner, actor("owner", "owner"), {
        name: `Last unit ${i}`,
        sku: `RACE-${run}-${i}`,
        barcode: null,
        category: "Concurrency",
        salePrice: 10,
        lowStockThreshold: 0,
        active: true,
      });
      if (!created.ok) throw new Error(created.error);
      ids.push(created.data);
    }
    const entry = await createStockEntry(owner, actor("owner", "owner"), {
      supplier: null,
      note: "race test",
      lines: ids.map((productId) => ({ productId, quantity: 1, unitCost: 4 })),
    });
    if (!entry.ok) throw new Error(entry.error);
  });

  afterAll(async () => {
    await owner.from("products").update({ deleted_at: new Date().toISOString() }).eq("store_id", DEMO_STORE_ID).like("sku", `RACE-${run}-%`);
  });

  const sellOne = (db: Db, productId: string, key = randomUUID()) =>
    db.rpc("create_sale", {
      p_store_id: DEMO_STORE_ID,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_payments: [{ method: "card", amount: 10 }],
      p_idempotency_key: key,
    });

  it("exactly one of two simultaneous buyers gets each last unit", async () => {
    // 20 requests in flight at once: for every product, owner and cashier race.
    const attempts = ids.flatMap((id) => [sellOne(owner, id), sellOne(cashier, id)]);
    const results = await Promise.all(attempts);

    for (let i = 0; i < PRODUCTS; i++) {
      const pair = [results[i * 2], results[i * 2 + 1]];
      expect(pair.filter((r) => !r?.error)).toHaveLength(1);
      expect(pair.filter((r) => r?.error?.message === "insufficient_stock")).toHaveLength(1);
    }

    const { data: products } = await owner.from("products").select("id, stock").in("id", ids);
    expect(products?.every((p) => p.stock === 0)).toBe(true); // never negative

    const { data: movements } = await owner.from("stock_movements").select("product_id, quantity").in("product_id", ids);
    for (const id of ids) {
      const sum = (movements ?? []).filter((m) => m.product_id === id).reduce((s, m) => s + m.quantity, 0);
      expect(sum).toBe(0); // +1 entry, -1 sale: stock = sum of movements
    }
    const { count } = await owner.from("sale_items").select("id", { count: "exact", head: true }).in("product_id", ids);
    expect(count).toBe(PRODUCTS);
  });

  it("a double submit with the same key never charges twice, even in parallel", async () => {
    const created = await createProduct(owner, actor("owner", "owner"), {
      name: "Double click",
      sku: `RACE-${run}-DC`,
      barcode: null,
      category: "Concurrency",
      salePrice: 10,
      lowStockThreshold: 0,
      active: true,
    });
    if (!created.ok) throw new Error(created.error);
    await createStockEntry(owner, actor("owner", "owner"), { supplier: null, note: null, lines: [{ productId: created.data, quantity: 5, unitCost: 4 }] });

    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => sellOne(cashier, created.data, key)));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(new Set(results.map((r) => r.data)).size).toBe(1);
    const { data } = await owner.from("products").select("stock").eq("id", created.data).single();
    expect(data?.stock).toBe(4);
  });
});
