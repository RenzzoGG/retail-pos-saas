import { describe, expect, it, vi } from "vitest";

// connection() needs a live Next.js request scope. Here we unit-test the
// handler's response; the real server behaviour is checked with curl/E2E.
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const { GET } = await import("@/app/api/health/route");
const { connection } = await import("next/server");

describe("GET /api/health", () => {
  it("responds 200 with { status: 'ok' }", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("opts out of prerendering so each request hits the live server", async () => {
    await GET();
    expect(connection).toHaveBeenCalled();
  });
});
