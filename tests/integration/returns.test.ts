import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from "@/features/customers/service";
import { createProduct, createStockEntry, getProduct } from "@/features/inventory/service";
import { completeSale, getSale, listSales } from "@/features/pos/service";
import { returnReceiptLines, saleReceiptLines } from "@/features/receipts/layout";
import { renderReceiptPdf } from "@/features/receipts/pdf";
import { toReturnReceipt, toSaleReceipt } from "@/features/receipts/receipt-data";
import { createReturn } from "@/features/returns/service";
import { getStoreSettings } from "@/features/stores/service";
import type { Db } from "@/lib/services/result";
import { pdfPageWidth, pdfText } from "../fixtures/pdf";
import { DEMO_STORE_ID, actor, signInAs } from "./helpers";

const run = String(Date.now()).slice(-8);

describe("returns, receipts and customers", () => {
  let owner: Db;
  let admin: Db;
  let cashier: Db;
  let cableId = "";
  let caseId = "";
  let saleId = "";
  let customerId = "";

  beforeAll(async () => {
    [owner, admin, cashier] = await Promise.all([signInAs("owner"), signInAs("admin"), signInAs("cashier")]);
    const make = async (sku: string, price: number, cost: number) => {
      const created = await createProduct(owner, actor("owner", "owner"), { name: `Return test ${sku}`, sku, barcode: null, category: "Returns", salePrice: price, lowStockThreshold: 0, active: true });
      if (!created.ok) throw new Error(created.error);
      const entry = await createStockEntry(owner, actor("owner", "owner"), { supplier: null, note: null, lines: [{ productId: created.data, quantity: 10, unitCost: cost }] });
      if (!entry.ok) throw new Error(entry.error);
      return created.data;
    };
    cableId = await make(`RET-${run}-A`, 10, 5);
    caseId = await make(`RET-${run}-B`, 25, 12);
    const customer = await createCustomer(cashier, actor("cashier", "cashier"), { name: `Returns Customer ${run}`, documentId: null, phone: "+1 555 0100", email: null, notes: null });
    if (!customer.ok) throw new Error(customer.error);
    customerId = customer.data.id;

    // Phase-2 example: 2 x 10.00 (-1.00) + 25.00 = 44.00; sale discount 4.00 -> 40.00 (tax 8.25 % included).
    const sale = await completeSale(owner, actor("owner", "owner"), {
      idempotencyKey: randomUUID(),
      customerId,
      items: [
        { productId: cableId, name: "A", quantity: 2, discount: 1 },
        { productId: caseId, name: "B", quantity: 1, discount: 0 },
      ],
      saleDiscount: 4,
      payments: [{ method: "cash", amount: 40, tendered: 50 }],
    });
    if (!sale.ok) throw new Error(sale.error.message);
    saleId = sale.sale.id;
  });

  afterAll(async () => {
    await owner.from("products").update({ deleted_at: new Date().toISOString() }).eq("store_id", DEMO_STORE_ID).like("sku", `RET-${run}-%`);
  });

  const itemId = async (productId: string) => {
    const sale = await getSale(owner, actor("owner", "owner"), saleId);
    return (sale.ok && sale.data?.items.find((i) => i.productId === productId)?.saleItemId) as string;
  };

  it("the cashier cannot register returns (server and database)", async () => {
    const cable = await itemId(cableId);
    const viaService = await createReturn(cashier, { storeId: DEMO_STORE_ID, role: "cashier" }, { saleId, reason: null, refundMethod: "cash", items: [{ saleItemId: cable, quantity: 1, restock: true }] });
    expect(viaService.ok).toBe(false);
    const { error } = await cashier.rpc("create_return", { p_sale_id: saleId, p_items: [{ sale_item_id: cable, quantity: 1 }] });
    expect(error?.message).toBe("forbidden");
  });

  it("partial return, damaged (not restocked): proportional refund, stock unchanged, profit adjusted", async () => {
    const before = await getSale(owner, actor("owner", "owner"), saleId);
    expect(before.ok && before.data?.profit).toBe(14.95); // (40 - 3.05) - (2 x 5 + 12)
    const result = await createReturn(admin, { storeId: DEMO_STORE_ID, role: "admin" }, {
      saleId,
      reason: "Arrived broken",
      refundMethod: "cash",
      items: [{ saleItemId: await itemId(cableId), quantity: 1, restock: false }],
    });
    expect(result.ok).toBe(true);
    const after = await getSale(owner, actor("owner", "owner"), saleId);
    if (!after.ok || !after.data) throw new Error("sale");
    expect(after.data).toMatchObject({ status: "partially_returned", refunded: 8.64 });
    expect(after.data.returns[0]).toMatchObject({ reason: "Arrived broken", refundMethod: "cash", createdBy: "Adam Admin" });
    expect(after.data.returns[0]?.items[0]).toMatchObject({ quantity: 1, refund: 8.64, restocked: false });
    // Revenue 36.95 x 31.36 / 40 = 28.97; cost still 22.00 (the damaged unit is a loss) -> 6.97
    expect(after.data.profit).toBe(6.97);
    const cable = await getProduct(owner, actor("owner", "owner"), cableId);
    expect(cable.ok && cable.data?.stock).toBe(8); // 10 - 2 sold, nothing back
  });

  it("can't return more than what is left, nor the same units twice", async () => {
    const cable = await itemId(cableId);
    const tooMany = await createReturn(admin, { storeId: DEMO_STORE_ID, role: "admin" }, { saleId, reason: null, refundMethod: "cash", items: [{ saleItemId: cable, quantity: 2, restock: true }] });
    expect(tooMany).toMatchObject({ ok: false, code: "return_exceeds_sold" });
  });

  it("completing the return refunds exactly the rest and restocks", async () => {
    const result = await createReturn(admin, { storeId: DEMO_STORE_ID, role: "admin" }, {
      saleId,
      reason: null,
      refundMethod: "card",
      items: [
        { saleItemId: await itemId(cableId), quantity: 1, restock: true },
        { saleItemId: await itemId(caseId), quantity: 1, restock: true },
      ],
    });
    expect(result.ok).toBe(true);
    const sale = await getSale(owner, actor("owner", "owner"), saleId);
    expect(sale.ok && sale.data).toMatchObject({ status: "returned", refunded: 40 });
    expect(sale.ok && sale.data?.returns[1]?.refundTotal).toBe(31.36);
    // Fully refunded; one cable (5.00) was written off -> profit -5.00
    expect(sale.ok && sale.data?.profit).toBe(-5);
    const again = await createReturn(admin, { storeId: DEMO_STORE_ID, role: "admin" }, { saleId, reason: null, refundMethod: "cash", items: [{ saleItemId: await itemId(caseId), quantity: 1, restock: true }] });
    expect(again).toMatchObject({ ok: false, code: "return_exceeds_sold" });
    const cable = await getProduct(owner, actor("owner", "owner"), cableId);
    expect(cable.ok && cable.data?.stock).toBe(9);
    const list = await listSales(owner, actor("owner", "owner"), { number: sale.ok ? sale.data?.number : undefined, from: "", to: "", page: 1 }, "UTC");
    expect(list.ok && list.data.items[0]).toMatchObject({ status: "returned", refunded: 40, profit: -5 });
  });

  it("receipts are 80 mm PDFs with the sale and its returns, and never costs", async () => {
    const sale = await getSale(owner, actor("owner", "owner"), saleId); // owner: SaleDetail includes costs
    const settings = await getStoreSettings(owner, DEMO_STORE_ID);
    if (!sale.ok || !sale.data || !settings.ok) throw new Error("load");
    const store = { name: settings.data.name, settings: settings.data };

    const pdf = await renderReceiptPdf(saleReceiptLines(toSaleReceipt(sale.data, store)), "test");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageWidth(pdf)).toBeCloseTo(226.77, 1); // 80 mm wide
    const text = pdfText(pdf);
    for (const expected of [`Sale #${sale.data.number}`, "Stocktill Demo Electronics", "Customer: Returns Customer", "RETURNS", "Net total", "Tax 8.25% (included)"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/cost|profit/i);
    expect(text).not.toMatch(/(?<!-)\$5\.00/); // the cable's unit cost (-$5.00 is the discount total)
    expect(text).not.toContain("$12.00"); // the case's unit cost

    const returnPdf = await renderReceiptPdf(returnReceiptLines(toReturnReceipt(sale.data, sale.data.returns[0]?.id as string, store)!), "return");
    const returnText = pdfText(returnPdf);
    expect(returnText).toContain("RETURN RECEIPT");
    expect(returnText).toContain("Not restocked (damaged)");
    expect(returnText).toContain("Arrived broken");
    expect(returnText).toMatch(/REFUND \(Cash\)\s+\$8\.64/);
  });

  it("customers: anyone creates and edits, only managers delete; with sales they are archived", async () => {
    expect((await updateCustomer(cashier, actor("cashier", "cashier"), customerId, { name: `Returns Customer ${run}`, documentId: "ID-9", phone: "+1 555 0100", email: "rc@example.com", notes: null })).ok).toBe(true);
    const detail = await getCustomer(cashier, DEMO_STORE_ID, customerId);
    expect(detail.ok && detail.data).toMatchObject({ purchaseCount: 1, totalSpent: 0, documentId: "ID-9" }); // 40 - 40 refunded
    expect(detail.ok && detail.data?.purchases[0]?.refunded).toBe(40);

    const found = await listCustomers(cashier, DEMO_STORE_ID, { q: "rc@example", page: 1 });
    expect(found.ok && found.data.items.map((c) => c.id)).toEqual([customerId]);

    expect((await deleteCustomer(cashier, actor("cashier", "cashier"), customerId)).ok).toBe(false);
    const { error } = await cashier.rpc("delete_customer", { p_customer_id: customerId });
    expect(error?.message).toBe("forbidden");
    expect(await deleteCustomer(admin, actor("admin", "admin"), customerId)).toEqual({ ok: true, data: "archived" });
    const hidden = await listCustomers(admin, DEMO_STORE_ID, { q: `Returns Customer ${run}`, page: 1 });
    expect(hidden.ok && hidden.data.items).toEqual([]);
    const archived = await getCustomer(admin, DEMO_STORE_ID, customerId);
    expect(archived.ok && archived.data?.archived).toBe(true);

    const lonely = await createCustomer(cashier, actor("cashier", "cashier"), { name: `No sales ${run}`, documentId: null, phone: null, email: null, notes: null });
    if (!lonely.ok) throw new Error(lonely.error);
    expect(await deleteCustomer(owner, actor("owner", "owner"), lonely.data.id)).toEqual({ ok: true, data: "deleted" });
  });
});
