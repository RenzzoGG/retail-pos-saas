import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_ACCOUNTS, demoAccountFor, getDemoConfig, isDemoEmail } from "@/features/demo/config";

afterEach(() => vi.unstubAllEnvs());

describe("demo accounts", () => {
  it("has one account per role, all on the reserved .test domain", () => {
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(["owner", "admin", "cashier"]);
    for (const account of DEMO_ACCOUNTS) expect(isDemoEmail(account.email)).toBe(true);
  });

  it("recognises demo emails regardless of case and spaces", () => {
    expect(isDemoEmail(" Cashier@DEMO.stocktill.test ")).toBe(true);
    expect(isDemoEmail("owner@other.stocktill.test")).toBe(false);
    expect(isDemoEmail("someone@demo.stocktill.test.evil.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });

  it("maps a submitted role to its account and rejects anything else", () => {
    expect(demoAccountFor("cashier")?.email).toBe("cashier@demo.stocktill.test");
    expect(demoAccountFor("superuser")).toBeNull();
    expect(demoAccountFor(null)).toBeNull();
  });
});

describe("getDemoConfig", () => {
  it("is off unless the deployment opts in", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_PASSWORD", "stocktill-demo");
    expect(getDemoConfig()).toBeNull();
  });

  it("needs a password of at least 8 characters", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_DEMO_PASSWORD", "short");
    expect(getDemoConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_DEMO_PASSWORD", "stocktill-demo");
    expect(getDemoConfig()).toEqual({ password: "stocktill-demo" });
  });
});
