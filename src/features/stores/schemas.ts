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
    timezone: z
      .string()
      .trim()
      .min(1, "Choose a time zone.")
      .refine(isValidTimeZone, "Choose a valid time zone."),
  })
  .transform(({ taxRatePercent, ...rest }) => ({
    ...rest,
    taxRate: Math.round(taxRatePercent * 100) / 10000,
  }));

export type StoreSettingsInput = z.output<typeof storeSettingsSchema>;
