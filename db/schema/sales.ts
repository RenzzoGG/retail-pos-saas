import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { createdAt, id, money, updatedAt } from "./_shared";
import { paymentMethod, saleStatus } from "./enums";
import { products } from "./inventory";
import { stores } from "./stores";

export const customers = pgTable(
  "customers",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    documentId: text("document_id"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_id_store_id_key").on(t.id, t.storeId),
    index("customers_store_name_idx").on(t.storeId, t.name),
    check("customers_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Consecutive per store (1, 2, 3…), assigned by create_sale. */
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    cashierId: uuid("cashier_id").references(() => authUsers.id, { onDelete: "set null" }),
    /** Sum of line totals (after line discounts). */
    subtotal: numeric("subtotal", money).notNull(),
    /** Sale-level discount. */
    discountTotal: numeric("discount_total", money).notNull().default("0"),
    /** Snapshot of the store's tax settings at the time of the sale. */
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull(),
    pricesIncludeTax: boolean("prices_include_tax").notNull(),
    taxTotal: numeric("tax_total", money).notNull(),
    total: numeric("total", money).notNull(),
    status: saleStatus("status").notNull().default("completed"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sales_id_store_id_key").on(t.id, t.storeId),
    unique("sales_store_number_key").on(t.storeId, t.number),
    unique("sales_store_idempotency_key").on(t.storeId, t.idempotencyKey),
    foreignKey({
      name: "sales_customer_fk",
      columns: [t.customerId, t.storeId],
      foreignColumns: [customers.id, customers.storeId],
    }),
    index("sales_store_created_idx").on(t.storeId, t.createdAt),
    index("sales_store_customer_idx").on(t.storeId, t.customerId),
    check("sales_number_pos", sql`${t.number} > 0`),
    check(
      "sales_amounts_nonneg",
      sql`${t.subtotal} >= 0 and ${t.discountTotal} >= 0 and ${t.taxTotal} >= 0 and ${t.total} >= 0`,
    ),
    check("sales_discount_le_subtotal", sql`${t.discountTotal} <= ${t.subtotal}`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: uuid("sale_id").notNull(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    /** Snapshots: later product edits never change past sales. */
    productName: text("product_name").notNull(),
    sku: text("sku").notNull(),
    unitPrice: numeric("unit_price", money).notNull(),
    quantity: integer("quantity").notNull(),
    discount: numeric("discount", money).notNull().default("0"),
    lineTotal: numeric("line_total", money).notNull(),
  },
  (t) => [
    unique("sale_items_id_store_id_key").on(t.id, t.storeId),
    foreignKey({
      name: "sale_items_sale_fk",
      columns: [t.saleId, t.storeId],
      foreignColumns: [sales.id, sales.storeId],
    }).onDelete("cascade"),
    foreignKey({
      name: "sale_items_product_fk",
      columns: [t.productId, t.storeId],
      foreignColumns: [products.id, products.storeId],
    }),
    index("sale_items_sale_id_idx").on(t.saleId),
    index("sale_items_store_product_idx").on(t.storeId, t.productId),
    check("sale_items_quantity_pos", sql`${t.quantity} > 0`),
    check(
      "sale_items_amounts_nonneg",
      sql`${t.unitPrice} >= 0 and ${t.discount} >= 0 and ${t.lineTotal} >= 0`,
    ),
  ],
);

/** Cost snapshot per sold line, kept apart so cashiers cannot read profit. */
export const saleItemCosts = pgTable(
  "sale_item_costs",
  {
    saleItemId: uuid("sale_item_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    unitCost: numeric("unit_cost", money).notNull(),
  },
  (t) => [
    foreignKey({
      name: "sale_item_costs_sale_item_fk",
      columns: [t.saleItemId, t.storeId],
      foreignColumns: [saleItems.id, saleItems.storeId],
    }).onDelete("cascade"),
    index("sale_item_costs_store_id_idx").on(t.storeId),
    check("sale_item_costs_unit_cost_nonneg", sql`${t.unitCost} >= 0`),
  ],
);

export const salePayments = pgTable(
  "sale_payments",
  {
    id: id(),
    saleId: uuid("sale_id").notNull(),
    storeId: uuid("store_id").notNull(),
    method: paymentMethod("method").notNull(),
    amount: numeric("amount", money).notNull(),
    /** Cash handed over by the customer (cash only); change = tendered - amount. */
    tendered: numeric("tendered", money),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "sale_payments_sale_fk",
      columns: [t.saleId, t.storeId],
      foreignColumns: [sales.id, sales.storeId],
    }).onDelete("cascade"),
    index("sale_payments_sale_id_idx").on(t.saleId),
    index("sale_payments_store_created_idx").on(t.storeId, t.createdAt),
    check("sale_payments_amount_pos", sql`${t.amount} > 0`),
    check(
      "sale_payments_tendered_valid",
      sql`${t.tendered} is null or (${t.method} = 'cash' and ${t.tendered} >= ${t.amount})`,
    ),
  ],
);

export const returns = pgTable(
  "returns",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    reason: text("reason"),
    refundTotal: numeric("refund_total", money).notNull(),
    refundMethod: paymentMethod("refund_method").notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("returns_id_store_id_key").on(t.id, t.storeId),
    foreignKey({
      name: "returns_sale_fk",
      columns: [t.saleId, t.storeId],
      foreignColumns: [sales.id, sales.storeId],
    }),
    index("returns_store_created_idx").on(t.storeId, t.createdAt),
    index("returns_sale_id_idx").on(t.saleId),
    check("returns_refund_total_nonneg", sql`${t.refundTotal} >= 0`),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: id(),
    returnId: uuid("return_id").notNull(),
    storeId: uuid("store_id").notNull(),
    saleItemId: uuid("sale_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    refundAmount: numeric("refund_amount", money).notNull(),
  },
  (t) => [
    foreignKey({
      name: "return_items_return_fk",
      columns: [t.returnId, t.storeId],
      foreignColumns: [returns.id, returns.storeId],
    }).onDelete("cascade"),
    foreignKey({
      name: "return_items_sale_item_fk",
      columns: [t.saleItemId, t.storeId],
      foreignColumns: [saleItems.id, saleItems.storeId],
    }),
    index("return_items_return_id_idx").on(t.returnId),
    index("return_items_sale_item_id_idx").on(t.saleItemId),
    check("return_items_quantity_pos", sql`${t.quantity} > 0`),
    check("return_items_refund_nonneg", sql`${t.refundAmount} >= 0`),
  ],
);
