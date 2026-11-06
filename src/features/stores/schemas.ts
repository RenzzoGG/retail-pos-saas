import { z } from "zod";
import { isValidTimeZone } from "@/lib/timezone";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "PEN", "COP", "CLP", "ARS", "BRL", "JPY"] as const;

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** Tax is entered as a percentage (8.25) and stored as a rate (0.0825). */
export const storeSettingsSchema = z
  .object({
    name: z.string().trim().min(2, "Store name must be at least 2 characters.").max(80, "Store name is too long."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Choose a currency."),
    taxRatePercent: z.coerce
      .number({ error: "Enter a number, like 8.25." })
      .min(0, "Tax can't be negative.")
      .max(99.99, "Tax must be below 100%.")
      .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimals."),
    pricesIncludeTax: checkbox,
    /** Settings only (onboarding keeps the default 10 %). */
    cashierDiscountLimit: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? undefined : v),
      z.coerce
        .number({ error: "Enter a percentage, like 10." })
        .min(0, "Can't be negative.")
        .max(100, "Can't be more than 100%.")
        .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimals.")
        .optional(),
    ),
    timezone: z
      .string()
      .trim()
      .min(1, "Choose a time zone.")
      .refine(isValidTimeZone, "Choose a valid time zone."),
    /** Settings only: free note printed at the bottom of receipts (empty = none). */
    ticketFooter: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v),
      z.string().max(200, "Keep the note under 200 characters.").optional(),
    ),
  })
  .transform(({ taxRatePercent, ticketFooter, ...rest }) => ({
    ...rest,
    taxRate: Math.round(taxRatePercent * 100) / 10000,
    /** Absent = field not in the form (onboarding); null = cleared. */
    ...(ticketFooter === undefined ? {} : { ticketFooter: ticketFooter === "" ? null : ticketFooter }),
  }));

export type StoreSettingsInput = z.output<typeof storeSettingsSchema>;
