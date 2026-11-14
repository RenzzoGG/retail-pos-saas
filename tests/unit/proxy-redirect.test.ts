import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Proxy redirects (src/lib/supabase/proxy.ts) use the canonical origin. */
let claims: { sub: string } | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null }) } }),
}));

const { updateSession } = await import("@/lib/supabase/proxy");

const SITE = "https://stocktill.example.com";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_unit_test");
  claims = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy redirects", () => {
  it("sends guests to /login on the canonical origin, keeping the requested path", async () => {
    const response = await updateSession(new NextRequest("https://0.0.0.0:3000/app/sales?page=2"));
    expect(response.headers.get("location")).toBe(`${SITE}/login?next=%2Fapp%2Fsales%3Fpage%3D2`);
  });

  it("sends signed-in users away from /login on the canonical origin", async () => {
    claims = { sub: "user-1" };
    const response = await updateSession(new NextRequest("https://0.0.0.0:3000/login"));
    expect(response.headers.get("location")).toBe(`${SITE}/app`);
  });

  it("lets other requests through", async () => {
    const response = await updateSession(new NextRequest("https://0.0.0.0:3000/"));
    expect(response.headers.get("location")).toBeNull();
  });
});
