import { isManager, type StoreRole } from "@/lib/permissions";
import { escapeSearchTerm } from "@/lib/postgrest";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import type { CustomerInput } from "./schemas";

export type CustomerActor = { storeId: string; role: StoreRole };

export type Customer = {
  id: string;
  name: string;
  documentId: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  archived: boolean;
};

type Raw = {
  id: string;
  name: string;
  document_id: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
};

const COLUMNS = "id, name, document_id, phone, email, notes, created_at, deleted_at";
const toCustomer = (c: Raw): Customer => ({
  id: c.id,
  name: c.name,
  documentId: c.document_id,
  phone: c.phone,
  email: c.email,
  notes: c.notes,
  createdAt: c.created_at,
  archived: c.deleted_at !== null,
});

const columnsFor = (input: CustomerInput) => ({
  name: input.name,
  document_id: input.documentId,
  phone: input.phone,
  email: input.email,
  notes: input.notes,
});

export async function listCustomers(
  db: Db,
  storeId: string,
  query: { q: string; page: number },
  pageSize = 25,
): Promise<Result<{ items: Customer[]; total: number; page: number; pageCount: number }>> {
  let request = db.from("customers").select(COLUMNS, { count: "exact" }).eq("store_id", storeId).is("deleted_at", null);
  const term = escapeSearchTerm(query.q);
  if (term) {
    request = request.or(`name.ilike."%${term}%",phone.ilike."%${term}%",email.ilike."%${term}%",document_id.ilike."%${term}%"`);
  }
  const from = (query.page - 1) * pageSize;
  const { data, error, count } = await request.order("name").order("id").range(from, from + pageSize - 1);
  if (error) return fail(error);
  const total = count ?? 0;
  return ok({
    items: ((data ?? []) as Raw[]).map(toCustomer),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export type CustomerPurchase = {
  id: string;
  number: number;
  createdAt: string;
  total: number;
  refunded: number;
  status: "completed" | "partially_returned" | "returned";
  returns: { createdAt: string; refund: number }[];
};

export type CustomerDetail = Customer & {
  purchases: CustomerPurchase[];
  purchaseCount: number;
  /** Totals of all purchases minus refunds. */
  totalSpent: number;
  lastPurchaseAt: string | null;
};

const cents = (n: number) => Math.round(n * 100);

/** Customer with purchase history (newest first, up to 200) and stats. Archived customers can still be viewed. */
export async function getCustomer(db: Db, storeId: string, customerId: string): Promise<Result<CustomerDetail | null>> {
  const { data, error } = await db.from("customers").select(COLUMNS).eq("id", customerId).eq("store_id", storeId).maybeSingle();
  if (error) return fail(error);
  if (!data) return ok(null);
  const { data: sales, error: salesError } = await db
    .from("sales")
    .select("id, number, created_at, total, status, returns(created_at, refund_total)")
    .eq("store_id", storeId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (salesError) return fail(salesError);

  const purchases: CustomerPurchase[] = (sales ?? []).map((s) => {
    const returns = (s.returns ?? []).map((r) => ({ createdAt: r.created_at, refund: Number(r.refund_total) }));
    return {
      id: s.id,
      number: s.number,
      createdAt: s.created_at,
      total: Number(s.total),
      refunded: returns.reduce((sum, r) => sum + cents(r.refund), 0) / 100,
      status: s.status,
      returns,
    };
  });
  return ok({
    ...toCustomer(data as Raw),
    purchases,
    purchaseCount: purchases.length,
    totalSpent: purchases.reduce((s, p) => s + cents(p.total) - cents(p.refunded), 0) / 100,
    lastPurchaseAt: purchases[0]?.createdAt ?? null,
  });
}

/** Any member (cashiers register customers at the register). */
export async function createCustomer(db: Db, actor: CustomerActor, input: CustomerInput): Promise<Result<Customer>> {
  const { data, error } = await db
    .from("customers")
    .insert({ store_id: actor.storeId, ...columnsFor(input) })
    .select(COLUMNS)
    .single();
  if (error) return fail(error);
  return ok(toCustomer(data as Raw));
}

export async function updateCustomer(db: Db, actor: CustomerActor, id: string, input: CustomerInput): Promise<Result<null>> {
  const { data, error } = await db
    .from("customers")
    .update(columnsFor(input))
    .eq("id", id)
    .eq("store_id", actor.storeId)
    .is("deleted_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "Customer not found.", code: "not_found" };
  return ok(null);
}

/** Owner/admin. Customers with sales are archived; the others are deleted. */
export async function deleteCustomer(db: Db, actor: CustomerActor, id: string): Promise<Result<"deleted" | "archived">> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("delete_customer", { p_customer_id: id });
  if (error || !data) return fail(error);
  return ok(data === "archived" ? "archived" : "deleted");
}
