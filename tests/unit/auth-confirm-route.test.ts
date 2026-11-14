import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /auth/confirm route handler with a mocked Supabase client. The request URL
 * reproduces what Next.js reports inside the Railway container
 * (HOSTNAME=0.0.0.0, PORT=3000, X-Forwarded-Proto: https).
 */
const auth = {
  verifyOtp: vi.fn(),
  getClaims: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));

const { GET } = await import("@/app/auth/confirm/route");

const SITE = "https://stocktill.example.com";
const INTERNAL = "https://0.0.0.0:3000";

function confirm(query: string, origin = INTERNAL) {
  return GET(new NextRequest(`${origin}/auth/confirm?${query}`, { headers: { host: "evil.example" } }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
  auth.getClaims.mockReset().mockResolvedValue({ data: null, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /auth/confirm", () => {
  it("redirects to the canonical origin, not the container's 0.0.0.0:3000", async () => {
    const response = await confirm("token_hash=abc&type=email&next=%2Fonboarding");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${SITE}/onboarding`);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
  });

  it("uses the canonical origin for the error redirect too", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const response = await confirm("token_hash=abc&type=email");
    expect(response.headers.get("location")).toBe(`${SITE}/login?error=invalid_link`);
  });

  it("ignores the Host header and the request origin", async () => {
    const response = await confirm("token_hash=abc&type=email&next=%2Fapp", "http://evil.example");
    expect(new URL(response.headers.get("location") ?? "").origin).toBe(SITE);
  });
});
