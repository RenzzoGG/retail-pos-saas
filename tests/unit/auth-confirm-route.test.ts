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

  describe("next", () => {
    const location = async (next: string, type = "email") =>
      (await confirm(`token_hash=abc&type=${type}&next=${encodeURIComponent(next)}`)).headers.get("location");

    it("empty → /app (sign-up) or /reset-password (recovery)", async () => {
      expect(await location("")).toBe(`${SITE}/app`);
      expect(await location("", "recovery")).toBe(`${SITE}/reset-password`);
    });

    it("absolute URL on the canonical origin → its path", async () => {
      expect(await location(`${SITE}/invite/tok`)).toBe(`${SITE}/invite/tok`);
    });

    it("bare Site URL (RedirectTo not in Supabase's allow-list) → default", async () => {
      expect(await location(SITE)).toBe(`${SITE}/app`);
    });

    it("relative path → kept", async () => {
      expect(await location("/reset-password", "recovery")).toBe(`${SITE}/reset-password`);
    });

    it("other origins and tricks → default, and never invalid_link", async () => {
      for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
        expect(await location(next)).toBe(`${SITE}/app`);
      }
      expect(auth.verifyOtp).toHaveBeenCalledTimes(4);
    });
  });

  describe("token already used", () => {
    beforeEach(() => {
      auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    });

    it("continues to the destination when this browser already has a valid session", async () => {
      auth.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
      const response = await confirm(`token_hash=used&type=email&next=${encodeURIComponent(`${SITE}/app`)}`);
      expect(response.headers.get("location")).toBe(`${SITE}/app`);
    });

    it("shows invalid_link when there is no session", async () => {
      const response = await confirm("token_hash=used&type=email");
      expect(response.headers.get("location")).toBe(`${SITE}/login?error=invalid_link`);
    });

    it("shows invalid_link for a missing token or an unknown type without a session", async () => {
      expect((await confirm("type=email")).headers.get("location")).toBe(`${SITE}/login?error=invalid_link`);
      expect((await confirm("token_hash=abc&type=magic")).headers.get("location")).toBe(
        `${SITE}/login?error=invalid_link`,
      );
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });
  });
});
