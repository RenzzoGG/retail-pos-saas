import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl, getSiteUrl } from "@/lib/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSiteUrl", () => {
  it("returns the configured origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://stocktill.example.com");
    expect(getSiteUrl()).toBe("https://stocktill.example.com");
  });

  it("drops a trailing slash or path", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://stocktill.example.com/");
    expect(getSiteUrl()).toBe("https://stocktill.example.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://stocktill.example.com/some/path?x=1");
    expect(getSiteUrl()).toBe("https://stocktill.example.com");
  });

  it("keeps a non-default port", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:8080");
    expect(getSiteUrl()).toBe("http://localhost:8080");
  });

  it("falls back to http://localhost:3000 when unset or blank", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(getSiteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "   ");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("refuses values that are not http(s) URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "stocktill.example.com");
    expect(() => getSiteUrl()).toThrow(/absolute URL/);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "javascript:alert(1)");
    expect(() => getSiteUrl()).toThrow(/http or https/);
  });
});

describe("absoluteUrl", () => {
  it("resolves app paths against the canonical origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://stocktill.example.com");
    expect(absoluteUrl("/login?error=invalid_link").href).toBe("https://stocktill.example.com/login?error=invalid_link");
    expect(absoluteUrl("/app").href).toBe("https://stocktill.example.com/app");
  });

  it("only accepts app-relative paths", () => {
    expect(() => absoluteUrl("https://evil.example/")).toThrow();
    expect(() => absoluteUrl("//evil.example/")).toThrow();
    expect(() => absoluteUrl("/\\evil.example/")).toThrow();
    expect(() => absoluteUrl("app")).toThrow();
  });
});
