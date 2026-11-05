import { describe, expect, it } from "vitest";
import { signUpSchema } from "@/features/auth/schemas";
import { storeSettingsSchema } from "@/features/stores/schemas";
import { inviteSchema } from "@/features/team/schemas";
import { productSchema } from "@/features/inventory/schemas";

describe("store settings schema", () => {
  it("converts a percentage into a rate and reads the checkbox", () => {
    const parsed = storeSettingsSchema.parse({
      name: " My Shop ",
      currency: "usd",
      taxRatePercent: "8.25",
      pricesIncludeTax: "on",
      timezone: "America/Lima",
    });
    expect(parsed).toEqual({ name: "My Shop", currency: "USD", taxRate: 0.0825, pricesIncludeTax: true, timezone: "America/Lima" });
  });
  it("treats a missing checkbox as false", () => {
    const parsed = storeSettingsSchema.parse({ name: "Shop", currency: "EUR", taxRatePercent: "21", timezone: "UTC" });
    expect(parsed.pricesIncludeTax).toBe(false);
  });
  it("rejects invalid values", () => {
    expect(storeSettingsSchema.safeParse({ name: "S", currency: "USD", taxRatePercent: "5" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ name: "Shop", currency: "US", taxRatePercent: "5" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ name: "Shop", currency: "USD", taxRatePercent: "100" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ name: "Shop", currency: "USD", taxRatePercent: "8.255" }).success).toBe(false);
    expect(
      storeSettingsSchema.safeParse({ name: "Shop", currency: "USD", taxRatePercent: "5", timezone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});

describe("auth and invite schemas", () => {
  it("normalizes emails", () => {
    expect(inviteSchema.parse({ email: "  Ana@Example.COM ", role: "cashier" }).email).toBe("ana@example.com");
  });
  it("never allows inviting an owner", () => {
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
  });
  it("requires 8+ character passwords", () => {
    expect(signUpSchema.safeParse({ fullName: "Ana", email: "a@b.co", password: "short" }).success).toBe(false);
  });
});

describe("product schema", () => {
  const base = { name: "Cable", barcode: "", category: "", salePrice: "9.99", lowStockThreshold: "2" };
  it("accepts normal SKUs and rejects formula-like or spaced ones", () => {
    expect(productSchema.safeParse({ ...base, sku: "CBL-USBC-1M" }).success).toBe(true);
    for (const sku of ["=1+1", "+SUM", "@x", "-5", "A 1"]) {
      expect(productSchema.safeParse({ ...base, sku }).success).toBe(false);
    }
  });
});
