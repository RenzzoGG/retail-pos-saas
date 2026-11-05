import { z } from "zod";

export const returnSchema = z
  .object({
    saleId: z.uuid(),
    reason: z
      .string()
      .trim()
      .max(300, "Reason is too long.")
      .transform((v) => (v === "" ? null : v)),
    refundMethod: z.enum(["cash", "card", "transfer"], { error: "Choose how the refund is paid." }),
    items: z
      .array(
        z.object({
          saleItemId: z.uuid(),
          quantity: z.number().int("Quantities are whole units.").min(0).max(10_000),
          restock: z.boolean(),
        }),
      )
      .max(200),
  })
  .transform((v) => ({ ...v, items: v.items.filter((i) => i.quantity > 0) }))
  .refine((v) => v.items.length > 0, { message: "Choose at least one item to return.", path: ["items"] });

export type ReturnInput = z.output<typeof returnSchema>;
