import { z } from "zod";

const money = z
  .number()
  .min(0)
  .max(99_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimals.");

/** What the POS sends to the server. Prices are NOT included: the database reads them. */
export const checkoutSchema = z
  .object({
    idempotencyKey: z.uuid(),
    customerId: z.uuid().nullable(),
    items: z
      .array(
        z.object({
          productId: z.uuid(),
          /** Only used to name the product in error messages. */
          name: z.string().max(120),
          quantity: z.number().int().min(1).max(10_000),
          /** Line discount as an amount (percentages are converted by the POS). */
          discount: money,
        }),
      )
      .min(1, "The cart is empty.")
      .max(200),
    saleDiscount: money,
    payments: z
      .array(
        z.object({
          method: z.enum(["cash", "card", "transfer"]),
          amount: money.refine((v) => v > 0, "Payments must be greater than 0."),
          tendered: money.nullable(),
        }),
      )
      .max(6),
  })
  .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
    message: "Each product can appear only once.",
    path: ["items"],
  })
  .refine((v) => v.payments.every((p) => p.tendered === null || (p.method === "cash" && p.tendered >= p.amount)), {
    message: "Cash received must be at least the cash amount.",
    path: ["payments"],
  });

export type CheckoutInput = z.output<typeof checkoutSchema>;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .catch("");

/** Query string of /app/sales. Invalid values fall back to "no filter". */
export const salesQuerySchema = z.object({
  number: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/^#/, "").trim() : v),
    z.coerce.number().int().min(1).max(2_147_483_647).optional().catch(undefined),
  ),
  from: date,
  to: date,
  method: z.enum(["cash", "card", "transfer"]).optional().catch(undefined),
  cashier: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type SalesQuery = z.output<typeof salesQuerySchema>;

export function parseSalesQuery(params: Record<string, string | string[] | undefined>): SalesQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return salesQuerySchema.parse({
    number: first(params.q),
    from: first(params.from) ?? "",
    to: first(params.to) ?? "",
    method: first(params.method),
    cashier: first(params.cashier),
    page: first(params.page),
  });
}
