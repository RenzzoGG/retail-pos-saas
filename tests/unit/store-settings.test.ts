import { describe, expect, it } from "vitest";
import { storeSettingsSchema } from "@/features/stores/schemas";

const base = { name: "Shop", currency: "USD", taxRatePercent: "8.25", timezone: "America/New_York" };

describe("store settings: receipt note", () => {
  it("is optional: onboarding (no field) leaves it untouched", () => {
    const parsed = storeSettingsSchema.parse(base);
    expect(parsed.ticketFooter).toBeUndefined();
  });

  it("an empty note clears it; text is trimmed and line breaks normalized", () => {
    expect(storeSettingsSchema.parse({ ...base, ticketFooter: "   " }).ticketFooter).toBeNull();
    expect(storeSettingsSchema.parse({ ...base, ticketFooter: " Thanks!\r\nSee you " }).ticketFooter).toBe("Thanks!\nSee you");
  });

  it("is at most 200 characters", () => {
    expect(storeSettingsSchema.safeParse({ ...base, ticketFooter: "x".repeat(201) }).success).toBe(false);
  });
});
