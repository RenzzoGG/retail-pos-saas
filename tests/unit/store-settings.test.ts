import { describe, expect, it } from "vitest";
import { idempotencyKeySchema, storeSettingsSchema } from "@/features/stores/schemas";
import { listTimeZones, preferredTimeZone } from "@/lib/timezone";

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

describe("onboarding: default time zone", () => {
  it("uses the browser's zone when it is offered", () => {
    expect(preferredTimeZone("America/Lima")).toBe("America/Lima");
    expect(preferredTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(listTimeZones()).toContain("America/Lima");
  });

  it("falls back to UTC for unknown, alias or missing zones", () => {
    expect(preferredTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(preferredTimeZone("America/Lima", ["UTC", "Europe/Madrid"])).toBe("UTC");
    expect(preferredTimeZone("")).toBe("UTC");
    expect(preferredTimeZone(undefined)).toBe("UTC");
    expect(preferredTimeZone("UTC")).toBe("UTC");
  });
});

describe("onboarding: idempotency key", () => {
  it("must be a UUID", () => {
    expect(idempotencyKeySchema.safeParse("6f1c2a43-8a8e-4e8b-9f5d-2b1b7c0f6a11").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse(null).success).toBe(false);
    expect(idempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
