import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, createStockEntry } from "@/features/inventory/service";
import { cartTotals } from "@/features/pos/calc";
import type { CheckoutInput } from "@/features/pos/schemas";
import { completeSale, getSale, listSales, lookupForSale } from "@/features/pos/service";
import type { Db } from "@/lib/services/result";
import { DEMO_STORE_ID, OTHER_STORE_ID, USERS, actor, signInAs } from "./helpers";

const run = String(Date.now()).slice(-8);

async function makeProduct(db: Db, storeId: string, role: "owner", user: "owner" | "otherOwner", sku: string, price: number, stock: number, cost: number) {
  const a = actor(user, role, storeId);
  const created = await createProduct(db, a, { name: `POS ${sku}`, sku, barcode: null, category: "POS tests", salePrice: price, lowStockThreshold: 0, active: true });
  if (!created.ok) throw new Error(created.error);
  const entry = await createStockEntry(db, a, { supplier: null, note: "pos test", lines: [{ productId: created.data, quantity: stock, unitCost: cost }] });
  if (!entry.ok) throw new Error(entry.error);
  return created.data;
}

const sale = (over: Partial<CheckoutInput> & Pick<CheckoutInput, "items" | "payments">): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  customerId: null,
  saleDiscount: 0,
  ...over,
});

describe("point of sale", () => {
  let owner: Db;
  let cashier: Db;
  let otherOwner: Db;
  let cable = "";
  let charger = "";
  let euroItem = "";

  beforeAll(async () => {
    [owner, cashier, otherOwner] = await Promise.all([signInAs("owner"), signInAs("cashier"), signInAs("otherOwner")]);
    cable = await makeProduct(owner, DEMO_STORE_ID, "owner", "owner", `POS-${run}-CBL`, 9.99, 50, 3.2);
    charger = await makeProduct(owner, DEMO_STORE_ID, "owner", "owner", `POS-${run}-CHG`, 19.99, 50, 7.4);
    euroItem = await makeProduct(otherOwner, OTHER_STORE_ID, "owner", "otherOwner", `POS-${run}-EUR`, 7.5, 20, 2);
  });

  afterAll(async () => {
    const now = new Date().toISOString();
    await owner.from("products").update({ deleted_at: now }).eq("store_id", DEMO_STORE_ID).like("sku", `POS-${run}-%`);
    await otherOwner.from("products").update({ deleted_at: now }).eq("store_id", OTHER_STORE_ID).like("sku", `POS-${run}-%`);
  });

  it("a cashier sells with tax included, discounts within the limit and a split payment", async () => {
    // 2 x 9.99 (-1.00 line) + 19.99 = 38.97; sale discount 2.00 -> 36.97 (7.5 % of 39.97 gross: within 10 %)
    const expected = cartTotals(
      [
        { productId: cable, name: "", sku: "", unitPrice: 9.99, stock: 50, quantity: 2, discount: { kind: "amount", value: 1 } },
        { productId: charger, name: "", sku: "", unitPrice: 19.99, stock: 50, quantity: 1, discount: null },
      ],
      { kind: "amount", value: 2 },
      0.0825,
      true,
    );
    expect(expected.totalCents).toBe(3697);
    const result = await completeSale(
      cashier,
      actor("cashier", "cashier"),
      sale({
        items: [
          { productId: cable, name: "Cable", quantity: 2, discount: 1 },
          { productId: charger, name: "Charger", quantity: 1, discount: 0 },
        ],
        saleDiscount: 2,
        payments: [
          { method: "card", amount: 20, tendered: null },
          { method: "cash", amount: 16.97, tendered: 20 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The database computed the same numbers as the POS preview.
    expect(result.sale).toMatchObject({
      total: expected.totalCents / 100,
      taxTotal: expected.taxCents / 100,
      saleDiscount: 2,
      lineDiscounts: 1,
      change: 3.03,
      cashierName: "Carla Cashier",
    });
    expect(result.sale.payments.map((p) => [p.method, p.amount, p.change])).toEqual([
      ["card", 20, 0],
      ["cash", 16.97, 3.03],
    ]);
    const stock = await lookupForSale(cashier, DEMO_STORE_ID, `POS-${run}-CBL`);
    expect(stock.ok && stock.data?.stock).toBe(48);
  });

  it("adds the tax on top in a store whose prices exclude it", async () => {
    const result = await completeSale(
      otherOwner,
      actor("otherOwner", "owner", OTHER_STORE_ID),
      sale({ items: [{ productId: euroItem, name: "Euro", quantity: 2, discount: 0 }], payments: [{ method: "transfer", amount: 18.15, tendered: null }] }),
    );
    expect(result.ok && result.sale).toMatchObject({ subtotal: 15, taxTotal: 3.15, total: 18.15, pricesIncludeTax: false });
  });

  it("the same idempotency key registers one sale only", async () => {
    const input = sale({ items: [{ productId: cable, name: "Cable", quantity: 1, discount: 0 }], payments: [{ method: "card", amount: 9.99, tendered: null }] });
    const [first, second] = await Promise.all([completeSale(cashier, actor("cashier", "cashier"), input), completeSale(cashier, actor("cashier", "cashier"), input)]);
    const third = await completeSale(cashier, actor("cashier", "cashier"), input);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;
    expect(new Set([first.sale.id, second.sale.id, third.sale.id]).size).toBe(1);
    const { count } = await owner.from("sales").select("id", { count: "exact", head: true }).eq("idempotency_key", input.idempotencyKey);
    expect(count).toBe(1);
    const stock = await lookupForSale(cashier, DEMO_STORE_ID, `POS-${run}-CBL`);
    expect(stock.ok && stock.data?.stock).toBe(47); // decremented once
  });

  it("enforces the cashier discount limit in the database; owners have none", async () => {
    const bigDiscount = (key = randomUUID()) =>
      sale({ idempotencyKey: key, items: [{ productId: charger, name: "Charger", quantity: 1, discount: 0 }], saleDiscount: 4, payments: [{ method: "card", amount: 15.99, tendered: null }] });
    const asCashier = await completeSale(cashier, actor("cashier", "cashier"), bigDiscount());
    expect(asCashier).toMatchObject({ ok: false, error: { code: "discount_limit_exceeded" } });
    const asOwner = await completeSale(owner, actor("owner", "owner"), bigDiscount());
    expect(asOwner.ok).toBe(true);
  });

  it("explains stock problems and changes nothing", async () => {
    const result = await completeSale(
      cashier,
      actor("cashier", "cashier"),
      sale({ items: [{ productId: charger, name: "Big Charger", quantity: 999, discount: 0 }], payments: [{ method: "card", amount: 19970.01, tendered: null }] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "insufficient_stock", productId: charger } });
    expect(!result.ok && result.error.message).toContain("Not enough stock for “Big Charger”");
  });

  it("rejects payments that don't match the total computed by the database", async () => {
    const result = await completeSale(
      cashier,
      actor("cashier", "cashier"),
      sale({ items: [{ productId: cable, name: "Cable", quantity: 1, discount: 0 }], payments: [{ method: "cash", amount: 5, tendered: 5 }] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "payments_mismatch" } });
  });

  it("the cashier never sees costs or profit; owners do", async () => {
    const made = await completeSale(cashier, actor("cashier", "cashier"), sale({ items: [{ productId: charger, name: "Charger", quantity: 2, discount: 0 }], payments: [{ method: "cash", amount: 39.98, tendered: 50 }] }));
    if (!made.ok) throw new Error(made.error.message);
    const asCashier = await getSale(cashier, actor("cashier", "cashier"), made.sale.id);
    expect(asCashier.ok && asCashier.data).toMatchObject({ profit: null });
    expect(asCashier.ok && asCashier.data?.items.every((i) => i.unitCost === null)).toBe(true);
    const { data: costs } = await cashier.from("sale_item_costs").select("unit_cost");
    expect(costs).toEqual([]);

    // Owner: profit = (39.98 - tax) - 2 x 7.40. Tax = round(39.98 * 0.0825 / 1.0825, 2) = 3.05 -> 36.93 - 14.80 = 22.13
    const asOwner = await getSale(owner, actor("owner", "owner"), made.sale.id);
    expect(asOwner.ok && asOwner.data?.profit).toBe(22.13);

    const list = await listSales(cashier, actor("cashier", "cashier"), { number: made.sale.number, from: "", to: "", page: 1 }, "America/New_York");
    expect(list.ok && list.data.items).toHaveLength(1);
    expect(list.ok && list.data.items[0]?.profit).toBeNull();
    const ownerList = await listSales(owner, actor("owner", "owner"), { number: made.sale.number, from: "", to: "", page: 1 }, "America/New_York");
    expect(ownerList.ok && ownerList.data.items[0]?.profit).toBe(22.13);
  });

  it("filters the sales history by method, cashier and dates", async () => {
    const query = { from: "", to: "", page: 1 };
    const cardOnly = await listSales(owner, actor("owner", "owner"), { ...query, method: "transfer" }, "America/New_York");
    expect(cardOnly.ok && cardOnly.data.items.every((s) => s.methods.includes("transfer"))).toBe(true);
    const byCashier = await listSales(owner, actor("owner", "owner"), { ...query, cashier: USERS.cashier.id }, "America/New_York");
    expect(byCashier.ok && byCashier.data.items.length).toBeGreaterThan(0);
    expect(byCashier.ok && byCashier.data.items.every((s) => s.cashierName === "Carla Cashier")).toBe(true);
    const future = await listSales(owner, actor("owner", "owner"), { ...query, from: "2999-01-01" }, "America/New_York");
    expect(future.ok && future.data.items).toEqual([]);
  });
});
