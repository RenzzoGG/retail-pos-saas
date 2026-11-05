import { isManager, type StoreRole } from "@/lib/permissions";
import { escapeSearchTerm } from "@/lib/postgrest";
import { getProfileNames } from "@/lib/services/profiles";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import type { ProductInput, ProductListQuery, StockEntryInput } from "./schemas";

export type InventoryActor = { userId: string; storeId: string; role: StoreRole };

export const PAGE_SIZE = 20;

export type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  salePrice: number;
  stock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  active: boolean;
  updatedAt: string;
  /** Weighted average cost. Only loaded for owner/admin; null if no stock entry yet. */
  cost: number | null;
};

export type Page<T> = { items: T[]; total: number; page: number; pageCount: number };

const BASE_COLUMNS =
  "id, sku, barcode, name, category, sale_price, stock, low_stock_threshold, is_low_stock, active, updated_at";

type RawProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  sale_price: number;
  stock: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  active: boolean;
  updated_at: string;
  product_costs?: { cost_price: number }[] | { cost_price: number } | null;
};

function toProduct(row: RawProduct): ProductRow {
  const costs = row.product_costs;
  const costRow = Array.isArray(costs) ? costs[0] : costs;
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    category: row.category,
    salePrice: Number(row.sale_price),
    stock: row.stock,
    lowStockThreshold: row.low_stock_threshold,
    isLowStock: row.is_low_stock,
    active: row.active,
    updatedAt: row.updated_at,
    cost: costRow ? Number(costRow.cost_price) : null,
  };
}

/** Cashiers never request costs (and RLS would return none anyway). */
function columnsFor(role: StoreRole): string {
  return isManager(role) ? `${BASE_COLUMNS}, product_costs(cost_price)` : BASE_COLUMNS;
}

function duplicateError(error: { code?: string; message?: string }): Result<never> | null {
  if (error.code !== "23505") return null;
  if (error.message?.includes("barcode")) {
    return { ok: false, error: "That barcode is already used by another product in this store.", code: "duplicate_barcode" };
  }
  return { ok: false, error: "That SKU is already used by another product in this store.", code: "duplicate_sku" };
}

/** Server-side search, filters, sorting and pagination (never loads the whole catalog). */
export async function listProducts(
  db: Db,
  actor: InventoryActor,
  query: ProductListQuery,
  pageSize = PAGE_SIZE,
): Promise<Result<Page<ProductRow>>> {
  let request = db
    .from("products")
    .select(columnsFor(actor.role), { count: "exact" })
    .eq("store_id", actor.storeId)
    .is("deleted_at", null);

  const term = escapeSearchTerm(query.q);
  if (term) {
    request = request.or(`name.ilike."%${term}%",sku.ilike."%${term}%",barcode.eq."${term}"`);
  }
  if (query.category) request = request.eq("category", query.category);
  if (query.low) request = request.eq("is_low_stock", true);

  const from = (query.page - 1) * pageSize;
  const { data, error, count } = await request
    .order(query.sort, { ascending: query.dir === "asc" })
    .order("id") // stable order between pages
    .range(from, from + pageSize - 1);
  if (error) return fail(error);

  const total = count ?? 0;
  return ok({
    items: ((data ?? []) as unknown as RawProduct[]).map(toProduct),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function listCategories(db: Db, storeId: string): Promise<string[]> {
  const { data } = await db
    .from("products")
    .select("category")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .not("category", "is", null)
    .limit(1000);
  return [...new Set((data ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b));
}

export async function getProduct(db: Db, actor: InventoryActor, productId: string): Promise<Result<ProductRow | null>> {
  const { data, error } = await db
    .from("products")
    .select(columnsFor(actor.role))
    .eq("id", productId)
    .eq("store_id", actor.storeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return fail(error);
  return ok(data ? toProduct(data as unknown as RawProduct) : null);
}

function productColumns(input: ProductInput) {
  return {
    name: input.name,
    sku: input.sku,
    barcode: input.barcode,
    category: input.category,
    sale_price: input.salePrice,
    low_stock_threshold: input.lowStockThreshold,
    active: input.active,
  };
}

/** Owner/admin. Stock is not part of the input: new products start at 0. */
export async function createProduct(db: Db, actor: InventoryActor, input: ProductInput): Promise<Result<string>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("products")
    .insert({ store_id: actor.storeId, ...productColumns(input) })
    .select("id")
    .single();
  if (error) return duplicateError(error) ?? fail(error);
  return ok(data.id);
}

export async function updateProduct(
  db: Db,
  actor: InventoryActor,
  productId: string,
  input: ProductInput,
): Promise<Result<null>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("products")
    .update(productColumns(input))
    .eq("id", productId)
    .eq("store_id", actor.storeId)
    .is("deleted_at", null)
    .select("id");
  if (error) return duplicateError(error) ?? fail(error);
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}

/** Soft delete: past sales and stock movements keep pointing at the product. */
export async function deleteProduct(db: Db, actor: InventoryActor, productId: string): Promise<Result<null>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("products")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("store_id", actor.storeId)
    .is("deleted_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return forbidden();
  return ok(null);
}

/** Active products at or below their low-stock threshold. */
export async function countLowStock(db: Db, storeId: string): Promise<number> {
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .eq("active", true)
    .eq("is_low_stock", true);
  return count ?? 0;
}

/** Exact barcode (what a USB scanner types) or SKU match. Barcode wins if both exist. */
export async function findProductByCode(db: Db, actor: InventoryActor, code: string): Promise<Result<ProductRow | null>> {
  const term = escapeSearchTerm(code);
  if (!term) return ok(null);
  const { data, error } = await db
    .from("products")
    .select(columnsFor(actor.role))
    .eq("store_id", actor.storeId)
    .is("deleted_at", null)
    .or(`barcode.eq."${term}",sku.eq."${term}"`)
    .limit(2);
  if (error) return fail(error);
  const rows = ((data ?? []) as unknown as RawProduct[]).map(toProduct);
  return ok(rows.find((p) => p.barcode === term) ?? rows[0] ?? null);
}

export async function searchProducts(db: Db, actor: InventoryActor, text: string, limit = 8): Promise<Result<ProductRow[]>> {
  const page = await listProducts(db, actor, { q: text, category: "", low: false, sort: "name", dir: "asc", page: 1 }, limit);
  return page.ok ? ok(page.data.items) : page;
}

/** Receives merchandise through the SQL function (stock + weighted average cost, atomically). */
export async function createStockEntry(db: Db, actor: InventoryActor, input: StockEntryInput): Promise<Result<string>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("create_stock_entry", {
    p_store_id: actor.storeId,
    p_items: input.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost })),
    ...(input.supplier ? { p_supplier: input.supplier } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error || !data) {
    if (error?.message === "product_not_found") {
      return { ok: false, error: "One of the products no longer exists. Remove it and try again.", code: "product_not_found" };
    }
    return fail(error);
  }
  return ok(data);
}

export type StockEntrySummary = {
  id: string;
  createdAt: string;
  supplier: string | null;
  note: string | null;
  source: "manual" | "import";
  createdBy: string;
  lineCount: number;
  units: number;
  totalCost: number;
};

export async function listStockEntries(
  db: Db,
  actor: InventoryActor,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Result<Page<StockEntrySummary>>> {
  if (!isManager(actor.role)) return forbidden();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await db
    .from("stock_entries")
    .select("id, created_at, supplier, note, source, created_by, stock_entry_items(quantity, unit_cost)", { count: "exact" })
    .eq("store_id", actor.storeId)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + pageSize - 1);
  if (error) return fail(error);
  const names = await getProfileNames(db, (data ?? []).map((e) => e.created_by));
  const total = count ?? 0;
  return ok({
    items: (data ?? []).map((e) => {
      const items = e.stock_entry_items ?? [];
      return {
        id: e.id,
        createdAt: e.created_at,
        supplier: e.supplier,
        note: e.note,
        source: e.source === "import" ? "import" : "manual",
        createdBy: (e.created_by && names.get(e.created_by)) || "Former member",
        lineCount: items.length,
        units: items.reduce((sum, i) => sum + i.quantity, 0),
        totalCost: items.reduce((sum, i) => sum + Math.round(i.quantity * Number(i.unit_cost) * 100), 0) / 100,
      };
    }),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export type StockEntryDetail = StockEntrySummary & {
  lines: { productId: string; name: string; sku: string; quantity: number; unitCost: number; lineCost: number }[];
};

export async function getStockEntry(db: Db, actor: InventoryActor, entryId: string): Promise<Result<StockEntryDetail | null>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("stock_entries")
    .select("id, created_at, supplier, note, source, created_by, stock_entry_items(product_id, quantity, unit_cost, products(name, sku))")
    .eq("id", entryId)
    .eq("store_id", actor.storeId)
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return ok(null);
  const names = await getProfileNames(db, [data.created_by]);
  const lines = (data.stock_entry_items ?? []).map((i) => ({
    productId: i.product_id,
    name: i.products?.name ?? "Deleted product",
    sku: i.products?.sku ?? "",
    quantity: i.quantity,
    unitCost: Number(i.unit_cost),
    lineCost: Math.round(i.quantity * Number(i.unit_cost) * 100) / 100,
  }));
  return ok({
    id: data.id,
    createdAt: data.created_at,
    supplier: data.supplier,
    note: data.note,
    source: data.source === "import" ? "import" : "manual",
    createdBy: (data.created_by && names.get(data.created_by)) || "Former member",
    lineCount: lines.length,
    units: lines.reduce((s, l) => s + l.quantity, 0),
    totalCost: Math.round(lines.reduce((s, l) => s + l.lineCost * 100, 0)) / 100,
    lines,
  });
}

export type Movement = {
  id: number;
  type: "sale" | "return" | "entry";
  quantity: number;
  stockAfter: number;
  createdAt: string;
  createdBy: string;
  /** For entries: the stock entry it came from. */
  entryId: string | null;
};

/** Stock ledger of one product (owner/admin): entries, sales and returns with the resulting stock. */
export async function listProductMovements(
  db: Db,
  actor: InventoryActor,
  productId: string,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Result<Page<Movement>>> {
  if (!isManager(actor.role)) return forbidden();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await db
    .from("stock_movements")
    .select("id, type, quantity, stock_after, ref_id, created_at, created_by", { count: "exact" })
    .eq("store_id", actor.storeId)
    .eq("product_id", productId)
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return fail(error);

  const rows = data ?? [];
  const entryRefs = rows.filter((m) => m.type === "entry").map((m) => m.ref_id);
  const entryByItem = new Map<string, string>();
  if (entryRefs.length) {
    const { data: items } = await db.from("stock_entry_items").select("id, entry_id").in("id", entryRefs);
    for (const i of items ?? []) entryByItem.set(i.id, i.entry_id);
  }
  const names = await getProfileNames(db, rows.map((m) => m.created_by));
  const total = count ?? 0;
  return ok({
    items: rows.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      stockAfter: m.stock_after,
      createdAt: m.created_at,
      createdBy: (m.created_by && names.get(m.created_by)) || "System",
      entryId: m.type === "entry" ? (entryByItem.get(m.ref_id) ?? null) : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}
