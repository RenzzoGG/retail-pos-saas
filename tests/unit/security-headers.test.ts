import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "@/lib/security-headers";

const prod = {
  supabaseUrl: "https://abcd.supabase.co",
  siteUrl: "https://stocktill.renzzogg.com",
  isDev: false,
};

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((d) => d.split(" ")[0] === name);
  return found ? found.split(" ").slice(1) : [];
}

describe("buildContentSecurityPolicy", () => {
  it("allows scripts only from this origin (inline for Next.js hydration, no eval)", () => {
    const csp = buildContentSecurityPolicy(prod);
    expect(directive(csp, "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
  });

  it("lets the browser reach Supabase over https and websockets", () => {
    const csp = buildContentSecurityPolicy(prod);
    expect(directive(csp, "connect-src")).toEqual(["'self'", "https://abcd.supabase.co", "wss://abcd.supabase.co"]);
  });

  it("uses http/ws for the local Supabase stack", () => {
    const csp = buildContentSecurityPolicy({ supabaseUrl: "http://127.0.0.1:54321", isDev: true });
    expect(directive(csp, "connect-src")).toEqual(["'self'", "http://127.0.0.1:54321", "ws://127.0.0.1:54321"]);
  });

  it("forbids framing and only posts forms to this origin and Stripe's hosted pages", () => {
    const csp = buildContentSecurityPolicy(prod);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "form-action")).toEqual([
      "'self'",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ]);
  });

  it("adds eval only for the dev server", () => {
    expect(directive(buildContentSecurityPolicy({ ...prod, isDev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests only on an https site", () => {
    expect(buildContentSecurityPolicy(prod)).toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy({ ...prod, siteUrl: "http://localhost:3000" })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("ignores a missing or malformed Supabase URL", () => {
    expect(directive(buildContentSecurityPolicy({ isDev: false }), "connect-src")).toEqual(["'self'"]);
    expect(directive(buildContentSecurityPolicy({ supabaseUrl: "nope", isDev: false }), "connect-src")).toEqual([
      "'self'",
    ]);
  });
});

describe("buildSecurityHeaders", () => {
  const byKey = (h: { key: string; value: string }[]) => Object.fromEntries(h.map((x) => [x.key, x.value]));

  it("sends the hardening headers", () => {
    const headers = byKey(buildSecurityHeaders(prod));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("sends HSTS only for an https production site", () => {
    expect(byKey(buildSecurityHeaders(prod))["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(byKey(buildSecurityHeaders({ ...prod, siteUrl: "http://localhost:3000" }))).not.toHaveProperty(
      "Strict-Transport-Security",
    );
    expect(byKey(buildSecurityHeaders({ ...prod, isDev: true }))).not.toHaveProperty("Strict-Transport-Security");
  });
});
