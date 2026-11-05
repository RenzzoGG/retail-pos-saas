import { isManager, type StoreRole } from "@/lib/permissions";
import { escapeSearchTerm } from "@/lib/postgrest";
import { getProfileNames } from "@/lib/services/profiles";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import { zonedDayEndUtc, zonedDayStartUtc } from "@/lib/timezone";
import type { PaymentMethod } from "./calc";
import type { CheckoutInput, SalesQuery } from "./schemas";

export type PosActor = { userId: string; storeId: string; role: StoreRole };

/** What the POS needs about a product. Never includes cost. */
export type SaleProduct = { id: string; name: string; sku: string; barcode: string | null; price: number; stock: number };

const PRODUCT_COLUMNS = "id, name, sku, barcode, sale_price, stock";

type RawSaleProduct = { id: string; name: string; sku: string; barcode: string | null; sale_price: number; stock: number };
const toSaleProduct = (p: RawSaleProduct): SaleProduct => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  barcode: p.barcode,
  price: Number(p.sale_price),
  stock: p.stock,
});

/** Exact barcode or SKU (what a scanner types). Only active, non-deleted products can be sold. */
export async function lookupForSale(db: Db, storeId: string, code: string): Promise<Result<SaleProduct | null>> {
  const term = escapeSearchTerm(code);
  if (!term) return ok(null);
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .eq("active", true)
    .or(`barcode.eq."${term}",sku.eq."${term}"`)
    .limit(2);
  if (error) return fail(error);
  const rows = (data ?? []).map(toSaleProduct);
  return ok(rows.find((p) => p.barcode === term) ?? rows[0] ?? null);
}

export async function searchForSale(db: Db, storeId: string, text: string, limit = 8): Promise<Result<SaleProduct[]>> {
  const term = escapeSearchTerm(text);
  if (term.length < 2) return ok([]);
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .eq("active", true)
    .or(`name.ilike."%${term}%",sku.ilike."%${term}%",barcode.eq."${term}"`)
    .order("name")
    .limit(limit);
  if (error) return fail(error);
  return ok((data ?? []).map(toSaleProduct));
}

export type CustomerOption = { id: string; name: string; detail: string | null };

/** Existing customers only (creating customers comes in phase 7). Cashiers can read customers. */
export async function searchCustomers(db: Db, storeId: string, text: string, limit = 8): Promise<Result<CustomerOption[]>> {
  const term = escapeSearchTerm(text);
  if (term.length < 2) return ok([]);
  const { data, error } = await db
    .from("customers")
    .select("id, name, document_id, phone, email")
    .eq("store_id", storeId)
    .or(`name.ilike."%${term}%",document_id.ilike."%${term}%",phone.ilike."%${term}%",email.ilike."%${term}%"`)
    .order("name")
    .limit(limit);
  if (error) return fail(error);
  return ok(
    (data ?? []).map((c) => ({ id: c.id, name: c.name, detail: c.document_id || c.phone || c.email || null })),
  );
}

export type SalePayment = { method: PaymentMethod; amount: number; tendered: number | null; change: number };
export type SaleLine = {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  lineTotal: number;
  /** Owner/admin only. */
  unitCost: number | null;
};

export type SaleDetail = {
  id: string;
  number: number;
  createdAt: string;
  status: "completed" | "partially_returned" | "returned";
  cashierName: string;
  customerName: string | null;
  subtotal: number;
  lineDiscounts: number;
  saleDiscount: number;
  taxRate: number;
  pricesIncludeTax: boolean;
  taxTotal: number;
  total: number;
  payments: SalePayment[];
  change: number;
  items: SaleLine[];
  /** (total - tax) - cost of goods. Owner/admin only, null otherwise. */
  profit: number | null;
  note: string | null;
};

const cents = (n: number) => Math.round(n * 100);

/** Full sale. Costs and profit are requested only for owner/admin (and RLS hides them anyway). */
export async function getSale(db: Db, actor: PosActor, saleId: string): Promise<Result<SaleDetail | null>> {
  const manager = isManager(actor.role);
  const itemColumns = manager
    ? "product_id, product_name, sku, unit_price, quantity, discount, line_total, sale_item_costs(unit_cost)"
    : "product_id, product_name, sku, unit_price, quantity, discount, line_total";
  const { data, error } = await db
    .from("sales")
    .select(
      `id, number, created_at, status, cashier_id, subtotal, discount_total, tax_rate, prices_include_tax, tax_total, total, note,
       customers(name), sale_payments(method, amount, tendered), sale_items(${itemColumns})`,
    )
    .eq("id", saleId)
    .eq("store_id", actor.storeId)
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return ok(null);

  type RawItem = {
    product_id: string;
    product_name: string;
    sku: string;
    unit_price: number;
    quantity: number;
    discount: number;
    line_total: number;
    sale_item_costs?: { unit_cost: number }[] | { unit_cost: number } | null;
  };
  const raw = data as unknown as {
    id: string;
    number: number;
    created_at: string;
    status: SaleDetail["status"];
    cashier_id: string | null;
    subtotal: number;
    discount_total: number;
    tax_rate: number;
    prices_include_tax: boolean;
    tax_total: number;
    total: number;
    note: string | null;
    customers: { name: string } | null;
    sale_payments: { method: PaymentMethod; amount: number; tendered: number | null }[];
    sale_items: RawItem[];
  };
  const names = await getProfileNames(db, [raw.cashier_id]);
  const items: SaleLine[] = raw.sale_items.map((i) => {
    const cost = Array.isArray(i.sale_item_costs) ? i.sale_item_costs[0] : i.sale_item_costs;
    return {
      productId: i.product_id,
      name: i.product_name,
      sku: i.sku,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      discount: Number(i.discount),
      lineTotal: Number(i.line_total),
      unitCost: manager && cost ? Number(cost.unit_cost) : null,
    };
  });
  const payments = raw.sale_payments.map((p) => {
    const tendered = p.tendered === null ? null : Number(p.tendered);
    return {
      method: p.method,
      amount: Number(p.amount),
      tendered,
      change: tendered === null ? 0 : (cents(tendered) - cents(Number(p.amount))) / 100,
    };
  });
  const costCents = items.reduce((s, i) => s + i.quantity * cents(i.unitCost ?? 0), 0);
  const subtotal = Number(raw.subtotal);
  return ok({
    id: raw.id,
    number: raw.number,
    createdAt: raw.created_at,
    status: raw.status,
    cashierName: (raw.cashier_id && names.get(raw.cashier_id)) || "Former member",
    customerName: raw.customers?.name ?? null,
    subtotal,
    lineDiscounts: items.reduce((s, i) => s + cents(i.discount), 0) / 100,
    saleDiscount: Number(raw.discount_total),
    taxRate: Number(raw.tax_rate),
    pricesIncludeTax: raw.prices_include_tax,
    taxTotal: Number(raw.tax_total),
    total: Number(raw.total),
    payments,
    change: payments.reduce((s, p) => s + cents(p.change), 0) / 100,
    items,
    profit: manager ? (cents(Number(raw.total)) - cents(Number(raw.tax_total)) - costCents) / 100 : null,
    note: raw.note,
  });
}

/** Stable error codes from create_sale, plus the product id for stock errors. */
export type CheckoutError = { code: string; message: string; productId?: string };

const CHECKOUT_MESSAGES: Record<string, string> = {
  discount_limit_exceeded: "This discount is above the cashier limit. Lower it or ask an owner or admin to ring up the sale.",
  payments_mismatch: "Payments don't match the total. Prices may have changed: review the cart and payments.",
  invalid_discount: "A discount is larger than the amount it applies to.",
  customer_not_found: "That customer no longer exists. Remove it from the sale.",
  invalid_quantity: "Quantities must be whole numbers of at least 1.",
  forbidden: "You don't have permission to sell in this store.",
};

/**
 * Registers the sale through create_sale (prices, taxes and stock are decided
 * by the database) and returns it. Repeating the same idempotency key returns
 * the sale that was already registered instead of creating another one.
 */
export async function completeSale(
  db: Db,
  actor: PosActor,
  input: CheckoutInput,
): Promise<{ ok: true; sale: SaleDetail } | { ok: false; error: CheckoutError }> {
  const { data: saleId, error } = await db.rpc("create_sale", {
    p_store_id: actor.storeId,
    p_items: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, discount: i.discount })),
    p_payments: input.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      ...(p.method === "cash" && p.tendered !== null ? { tendered: p.tendered } : {}),
    })),
    p_idempotency_key: input.idempotencyKey,
    ...(input.customerId ? { p_customer_id: input.customerId } : {}),
    p_discount: input.saleDiscount,
  });
  if (error || !saleId) {
    const code = error?.message ?? "unknown";
    const productId = typeof error?.details === "string" ? error.details : undefined;
    const name = input.items.find((i) => i.productId === productId)?.name;
    if (code === "insufficient_stock") {
      return {
        ok: false,
        error: {
          code,
          productId,
          message: `Not enough stock for “${name ?? "a product"}”. It may have just been sold: lower the quantity or remove it.`,
        },
      };
    }
    if (code === "product_not_found") {
      return { ok: false, error: { code, productId, message: `“${name ?? "A product"}” can't be sold anymore (deleted or inactive). Remove it.` } };
    }
    return { ok: false, error: { code, message: CHECKOUT_MESSAGES[code] ?? "The sale couldn't be registered. Nothing was charged; try again." } };
  }
  const sale = await getSale(db, actor, saleId);
  if (!sale.ok || !sale.data) {
    return { ok: false, error: { code: "read_failed", message: "The sale was registered, but it couldn't be loaded. Check Sales." } };
  }
  return { ok: true, sale: sale.data };
}

export type SaleRow = {
  id: string;
  number: number;
  createdAt: string;
  status: SaleDetail["status"];
  cashierName: string;
  customerName: string | null;
  methods: PaymentMethod[];
  total: number;
  /** Owner/admin only. */
  profit: number | null;
};

export async function listSales(
  db: Db,
  actor: PosActor,
  query: SalesQuery,
  timeZone: string,
  pageSize = 25,
): Promise<Result<{ items: SaleRow[]; total: number; page: number; pageCount: number }>> {
  const manager = isManager(actor.role);
  const columns = [
    "id, number, created_at, status, cashier_id, total, tax_total",
    "customers(name)",
    "payments:sale_payments(method)",
    query.method ? "paid_with:sale_payments!inner(method)" : null,
    manager ? "sale_items(quantity, sale_item_costs(unit_cost))" : null,
  ]
    .filter(Boolean)
    .join(", ");

  let request = db.from("sales").select(columns, { count: "exact" }).eq("store_id", actor.storeId);
  if (query.number) request = request.eq("number", query.number);
  if (query.method) request = request.eq("paid_with.method", query.method);
  if (query.cashier) request = request.eq("cashier_id", query.cashier);
  if (query.from) request = request.gte("created_at", zonedDayStartUtc(query.from, timeZone).toISOString());
  if (query.to) request = request.lt("created_at", zonedDayEndUtc(query.to, timeZone).toISOString());

  const from = (query.page - 1) * pageSize;
  const { data, error, count } = await request.order("number", { ascending: false }).range(from, from + pageSize - 1);
  if (error) return fail(error);

  type Raw = {
    id: string;
    number: number;
    created_at: string;
    status: SaleDetail["status"];
    cashier_id: string | null;
    total: number;
    tax_total: number;
    customers: { name: string } | null;
    payments: { method: PaymentMethod }[];
    sale_items?: { quantity: number; sale_item_costs: { unit_cost: number }[] | { unit_cost: number } | null }[];
  };
  const rows = (data ?? []) as unknown as Raw[];
  const names = await getProfileNames(db, rows.map((r) => r.cashier_id));
  const total = count ?? 0;
  return ok({
    items: rows.map((r) => {
      let profit: number | null = null;
      if (manager && r.sale_items) {
        const costCents = r.sale_items.reduce((s, i) => {
          const c = Array.isArray(i.sale_item_costs) ? i.sale_item_costs[0] : i.sale_item_costs;
          return s + i.quantity * cents(Number(c?.unit_cost ?? 0));
        }, 0);
        profit = (cents(Number(r.total)) - cents(Number(r.tax_total)) - costCents) / 100;
      }
      return {
        id: r.id,
        number: r.number,
        createdAt: r.created_at,
        status: r.status,
        cashierName: (r.cashier_id && names.get(r.cashier_id)) || "Former member",
        customerName: r.customers?.name ?? null,
        methods: [...new Set(r.payments.map((p) => p.method))],
        total: Number(r.total),
        profit,
      };
    }),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/** Members of the store, for the cashier filter. */
export async function listSellers(db: Db, actor: PosActor): Promise<Result<{ id: string; name: string }[]>> {
  if (!actor.storeId) return forbidden();
  const { data, error } = await db.from("store_members").select("user_id").eq("store_id", actor.storeId);
  if (error) return fail(error);
  const names = await getProfileNames(db, (data ?? []).map((m) => m.user_id));
  return ok(
    (data ?? [])
      .map((m) => ({ id: m.user_id, name: names.get(m.user_id) ?? "Unknown user" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}
