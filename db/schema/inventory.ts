import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { createdAt, id, money, updatedAt } from "./_shared";
import { stockMovementType } from "./enums";
import { stores } from "./stores";

export const products = pgTable(
  "products",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    category: text("category"),
    salePrice: numeric("sale_price", money).notNull(),
    /** Only changed by create_sale / create_return / create_stock_entry. */
    stock: integer("stock").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    /**
     * Generated: PostgREST filters cannot compare two columns, so "low stock"
     * is materialized here for filtering and counting. Out of stock counts as low.
     */
    isLowStock: boolean("is_low_stock")
      .notNull()
      .generatedAlwaysAs(sql`stock <= low_stock_threshold`),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Target for composite FKs (product_id, store_id) from child tables.
    unique("products_id_store_id_key").on(t.id, t.storeId),
    uniqueIndex("products_store_sku_key")
      .on(t.storeId, t.sku)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("products_store_barcode_key")
      .on(t.storeId, t.barcode)
      .where(sql`${t.deletedAt} is null and ${t.barcode} is not null`),
    index("products_store_name_idx").on(t.storeId, t.name),
    index("products_store_low_stock_idx").on(t.storeId, t.isLowStock),
    check("products_stock_nonneg", sql`${t.stock} >= 0`),
    check("products_sale_price_nonneg", sql`${t.salePrice} >= 0`),
    check("products_low_stock_threshold_nonneg", sql`${t.lowStockThreshold} >= 0`),
    check("products_sku_not_blank", sql`length(trim(${t.sku})) > 0`),
    check("products_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Purchase cost kept apart from products so cashiers (no access) never see it. */
export const productCosts = pgTable(
  "product_costs",
  {
    productId: uuid("product_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    /** Weighted average cost, recalculated by create_stock_entry. */
    costPrice: numeric("cost_price", money).notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "product_costs_product_fk",
      columns: [t.productId, t.storeId],
      foreignColumns: [products.id, products.storeId],
    }).onDelete("cascade"),
    index("product_costs_store_id_idx").on(t.storeId),
    check("product_costs_cost_nonneg", sql`${t.costPrice} >= 0`),
  ],
);

export const stockEntries = pgTable(
  "stock_entries",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    supplier: text("supplier"),
    note: text("note"),
    /** "manual" (Receive stock screen) or "import" (product import). */
    source: text("source").notNull().default("manual"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("stock_entries_id_store_id_key").on(t.id, t.storeId),
    index("stock_entries_store_created_idx").on(t.storeId, t.createdAt),
    check("stock_entries_source_valid", sql`${t.source} in ('manual', 'import')`),
  ],
);

export const stockEntryItems = pgTable(
  "stock_entry_items",
  {
    id: id(),
    entryId: uuid("entry_id").notNull(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", money).notNull(),
  },
  (t) => [
    foreignKey({
      name: "stock_entry_items_entry_fk",
      columns: [t.entryId, t.storeId],
      foreignColumns: [stockEntries.id, stockEntries.storeId],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_entry_items_product_fk",
      columns: [t.productId, t.storeId],
      foreignColumns: [products.id, products.storeId],
    }),
    index("stock_entry_items_entry_id_idx").on(t.entryId),
    index("stock_entry_items_store_product_idx").on(t.storeId, t.productId),
    check("stock_entry_items_quantity_pos", sql`${t.quantity} > 0`),
    check("stock_entry_items_unit_cost_nonneg", sql`${t.unitCost} >= 0`),
  ],
);

/** Ledger: for every product, stock = sum(quantity). */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    type: stockMovementType("type").notNull(),
    /** Signed: negative for sales, positive for returns and entries. */
    quantity: integer("quantity").notNull(),
    stockAfter: integer("stock_after").notNull(),
    /** Id of the stock_entry_items / sale_items / return_items row that caused it. */
    refId: uuid("ref_id").notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "stock_movements_product_fk",
      columns: [t.productId, t.storeId],
      foreignColumns: [products.id, products.storeId],
    }),
    index("stock_movements_store_created_idx").on(t.storeId, t.createdAt),
    index("stock_movements_store_product_idx").on(t.storeId, t.productId),
    check("stock_movements_quantity_nonzero", sql`${t.quantity} <> 0`),
    check("stock_movements_stock_after_nonneg", sql`${t.stockAfter} >= 0`),
    check(
      "stock_movements_sign_matches_type",
      sql`(${t.type} = 'sale' and ${t.quantity} < 0) or (${t.type} in ('return', 'entry') and ${t.quantity} > 0)`,
    ),
  ],
);

/** One row per confirmed product import (written only by public.import_products). */
export const importBatches = pgTable(
  "import_batches",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    updateExisting: boolean("update_existing").notNull().default(false),
    totalRows: integer("total_rows").notNull(),
    createdCount: integer("created_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    /** Stock entry created for the rows that brought initial stock (null if none). */
    stockEntryId: uuid("stock_entry_id"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "import_batches_stock_entry_fk",
      columns: [t.stockEntryId, t.storeId],
      foreignColumns: [stockEntries.id, stockEntries.storeId],
    }),
    index("import_batches_store_created_idx").on(t.storeId, t.createdAt),
    check(
      "import_batches_counts_valid",
      sql`${t.createdCount} >= 0 and ${t.updatedCount} >= 0 and ${t.skippedCount} >= 0
          and ${t.createdCount} + ${t.updatedCount} + ${t.skippedCount} = ${t.totalRows}`,
    ),
    check("import_batches_file_name_not_blank", sql`length(trim(${t.fileName})) > 0`),
  ],
);
