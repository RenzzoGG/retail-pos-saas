import { z } from "zod";

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === "" ? null : v));

/** A money amount typed by the user: >= 0, at most 2 decimals. */
export const moneyInput = (label: string) =>
  z.coerce
    .number({ error: `Enter ${label}, like 9.99.` })
    .min(0, `${label[0]?.toUpperCase()}${label.slice(1)} can't be negative.`)
    .max(99_999_999.99, `${label[0]?.toUpperCase()}${label.slice(1)} is too large.`)
    // Float tolerance: 19.99 * 100 is 1998.9999999999998 in binary floating point.
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use at most 2 decimals.");

export const productSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(120, "Name is too long."),
  sku: z
    .string()
    .trim()
    .min(1, "Enter a SKU.")
    .max(64, "SKU is too long.")
    .regex(/^[^\s]+$/, "SKU can't contain spaces."),
  barcode: z
    .string()
    .trim()
    .max(64, "Barcode is too long.")
    .refine((v) => v === "" || /^[0-9A-Za-z-]{4,64}$/.test(v), "Barcode: 4–64 letters, digits or dashes.")
    .transform((v) => (v === "" ? null : v)),
  category: optionalText(60, "Category is too long."),
  salePrice: moneyInput("a sale price"),
  lowStockThreshold: z.coerce
    .number({ error: "Enter a whole number." })
    .int("Use a whole number.")
    .min(0, "Can't be negative.")
    .max(1_000_000, "Too large."),
  active: checkbox,
});

export type ProductInput = z.output<typeof productSchema>;

export const stockEntryLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int("Quantities are whole units.").min(1, "Quantity must be at least 1.").max(1_000_000),
  unitCost: moneyInput("a unit cost"),
});

export const stockEntrySchema = z
  .object({
    supplier: optionalText(120, "Supplier is too long."),
    note: optionalText(500, "Note is too long."),
    lines: z.array(stockEntryLineSchema).min(1, "Add at least one product.").max(200, "Too many lines."),
  })
  .refine((v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length, {
    path: ["lines"],
    message: "Each product can appear only once.",
  });

export type StockEntryInput = z.output<typeof stockEntrySchema>;

export const PRODUCT_SORTS = ["name", "sku", "sale_price", "stock", "updated_at"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Query string of /app/products (invalid values fall back to defaults). */
export const productListQuerySchema = z.object({
  q: z.string().trim().max(64).catch(""),
  category: z.string().trim().max(60).catch(""),
  low: z.preprocess((v) => v === "1" || v === "true", z.boolean()).catch(false),
  sort: z.enum(PRODUCT_SORTS).catch("name"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type ProductListQuery = z.output<typeof productListQuerySchema>;

export function parseProductListQuery(params: Record<string, string | string[] | undefined>): ProductListQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return productListQuerySchema.parse({
    q: first(params.q) ?? "",
    category: first(params.category) ?? "",
    low: first(params.low),
    sort: first(params.sort),
    dir: first(params.dir),
    page: first(params.page),
  });
}
