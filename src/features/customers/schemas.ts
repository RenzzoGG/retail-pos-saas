import { z } from "zod";

const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === "" ? null : v));

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name.").max(120, "Name is too long."),
  documentId: optional(40, "Document is too long."),
  phone: optional(40, "Phone is too long.").refine((v) => v === null || /^[0-9+()\-.\s]{4,40}$/.test(v), "Use digits, spaces and + ( ) - only."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address."),
  notes: optional(500, "Notes are too long."),
});

export type CustomerInput = z.output<typeof customerSchema>;

export function parseCustomerQuery(params: Record<string, string | string[] | undefined>) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.page), 10) || 1));
  return { q: first(params.q).trim().slice(0, 64), page };
}
