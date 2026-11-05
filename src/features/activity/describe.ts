/**
 * Turns an activity_log row (table, action, before/after JSON) into a short,
 * human-readable description. Pure function: easy to unit test.
 */
type Json = Record<string, unknown>;

export type ActivityInput = {
  tableName: string;
  action: "insert" | "update" | "delete";
  before: Json | null;
  after: Json | null;
};

export type ActivityDescription = { entity: string; title: string; details: string[] };

const ENTITIES: Record<string, string> = {
  products: "Product",
  product_costs: "Product cost",
  customers: "Customer",
  stores: "Store settings",
  store_members: "Team member",
  invitations: "Invitation",
  stock_entries: "Stock entry",
  sales: "Sale",
  returns: "Return",
  import_batches: "Product import",
};

/** Bookkeeping fields that are never shown as "changes". */
const HIDDEN = new Set([
  "id",
  "store_id",
  "created_at",
  "updated_at",
  "created_by",
  "invited_by",
  "stock",
  "is_low_stock",
  "last_sale_number",
  "product_id",
  "user_id",
  "slug",
]);

const LABELS: Record<string, string> = {
  sale_price: "sale price",
  low_stock_threshold: "low-stock threshold",
  cost_price: "cost",
  tax_rate: "tax rate",
  prices_include_tax: "prices include tax",
  ticket_footer: "ticket footer",
  document_id: "document",
  accepted_at: "accepted",
  expires_at: "expires",
  refund_total: "refund",
};

function label(field: string): string {
  return LABELS[field] ?? field.replaceAll("_", " ");
}

function show(value: unknown, field: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (field === "tax_rate" && typeof value === "number") return `${Math.round(value * 10000) / 100}%`;
  if (typeof value === "number" && /price|cost|total|amount|refund/.test(field)) return value.toFixed(2);
  return String(value);
}

function nameOf(row: Json | null): string | null {
  if (!row) return null;
  for (const key of ["name", "email", "sku", "file_name"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  if (typeof row.number === "number") return `#${row.number}`;
  return null;
}

export function describeActivity(input: ActivityInput): ActivityDescription {
  const entity = ENTITIES[input.tableName] ?? input.tableName.replaceAll("_", " ");
  const row = input.after ?? input.before;
  const name = nameOf(row);
  const subject = name ? `${entity} “${name}”` : entity;

  if (input.action === "insert") {
    const details: string[] = [];
    if (input.tableName === "product_costs" && row) details.push(`cost: ${show(row.cost_price, "cost_price")}`);
    if (input.tableName === "store_members" || input.tableName === "invitations") {
      if (row?.role) details.push(`role: ${String(row.role)}`);
    }
    if (input.tableName === "sales" && row?.total !== undefined) details.push(`total: ${show(row.total, "total")}`);
    if (input.tableName === "import_batches" && row) {
      details.push(
        `created: ${String(row.created_count)}, updated: ${String(row.updated_count)}, skipped: ${String(row.skipped_count)}`,
      );
    }
    return { entity, title: `${subject} created`, details };
  }

  if (input.action === "delete") {
    return { entity, title: `${subject} removed`, details: [] };
  }

  // update
  const before = input.before ?? {};
  const after = input.after ?? {};
  if (before.deleted_at == null && after.deleted_at != null) {
    return { entity, title: `${subject} deleted`, details: [] };
  }
  if (before.deleted_at != null && after.deleted_at == null) {
    return { entity, title: `${subject} restored`, details: [] };
  }
  const details = Object.keys(after)
    .filter((key) => !HIDDEN.has(key) && key !== "deleted_at")
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${label(key)}: ${show(before[key], key)} → ${show(after[key], key)}`);
  return { entity, title: `${subject} updated`, details };
}
