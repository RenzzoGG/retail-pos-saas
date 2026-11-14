import { describe, expect, it } from "vitest";
import { confirmDestination } from "@/features/auth/confirm";
import { safeNextPath } from "@/lib/safe-redirect";

const SITE = "https://stocktill.example.com";

describe("safeNextPath", () => {
  it("uses the fallback when empty", () => {
    expect(safeNextPath(undefined, "/onboarding", SITE)).toBe("/onboarding");
    expect(safeNextPath(null, "/app", SITE)).toBe("/app");
    expect(safeNextPath("", "/app", SITE)).toBe("/app");
    expect(safeNextPath("   ", "/app", SITE)).toBe("/app");
  });

  it("keeps relative paths with their query and hash", () => {
    expect(safeNextPath("/invite/abc?x=1", "/app", SITE)).toBe("/invite/abc?x=1");
    expect(safeNextPath("/app/sales#top", "/app", SITE)).toBe("/app/sales#top");
  });

  it("accepts absolute URLs of our own origin, reduced to the path", () => {
    expect(safeNextPath(`${SITE}/onboarding`, "/app", SITE)).toBe("/onboarding");
    expect(safeNextPath(`${SITE}/invite/abc?x=1`, "/app", SITE)).toBe("/invite/abc?x=1");
    expect(safeNextPath("HTTPS://STOCKTILL.EXAMPLE.COM/app", "/x", SITE)).toBe("/app");
  });

  it("ignores other origins (scheme, host or port differ)", () => {
    expect(safeNextPath("https://evil.example/steal", "/app", SITE)).toBe("/app");
    expect(safeNextPath("http://stocktill.example.com/app", "/x", SITE)).toBe("/x");
    expect(safeNextPath("https://stocktill.example.com:8443/app", "/x", SITE)).toBe("/x");
    expect(safeNextPath("https://stocktill.example.com.evil.example/app", "/x", SITE)).toBe("/x");
    expect(safeNextPath("https://user@evil.example/app", "/x", SITE)).toBe("/x");
  });

  it("blocks protocol-relative and backslash tricks", () => {
    expect(safeNextPath("//evil.example", "/app", SITE)).toBe("/app");
    expect(safeNextPath("//evil.example/app", "/app", SITE)).toBe("/app");
    expect(safeNextPath("/\\evil.example", "/app", SITE)).toBe("/app");
    expect(safeNextPath("/\t/evil.example", "/app", SITE)).toBe("/app");
    expect(safeNextPath("\\\\evil.example", "/app", SITE)).toBe("/app");
  });

  it("blocks other schemes and bare hosts", () => {
    expect(safeNextPath("javascript:alert(1)", "/app", SITE)).toBe("/app");
    expect(safeNextPath("JavaScript:alert(1)", "/app", SITE)).toBe("/app");
    expect(safeNextPath("data:text/html,hi", "/app", SITE)).toBe("/app");
    expect(safeNextPath("evil.example", "/app", SITE)).toBe("/app");
    expect(safeNextPath("app", "/app", SITE)).toBe("/app");
  });

  it("defaults to the canonical origin from NEXT_PUBLIC_SITE_URL", () => {
    // Unset in unit tests: http://localhost:3000.
    expect(safeNextPath("http://localhost:3000/onboarding")).toBe("/onboarding");
    expect(safeNextPath("http://localhost:4000/onboarding")).toBe("/app");
  });
});

describe("confirmDestination", () => {
  it("defaults to /app for account confirmation and /reset-password for recovery", () => {
    expect(confirmDestination("", "email")).toBe("/app");
    expect(confirmDestination(null, "signup")).toBe("/app");
    expect(confirmDestination("", "recovery")).toBe("/reset-password");
    expect(confirmDestination(null, null)).toBe("/app");
  });

  it("keeps a safe next", () => {
    expect(confirmDestination("/reset-password", "recovery")).toBe("/reset-password");
    expect(confirmDestination("http://localhost:3000/invite/tok", "email")).toBe("/invite/tok");
  });

  it("treats the bare Site URL (Supabase's fallback for RedirectTo) as empty", () => {
    expect(confirmDestination("http://localhost:3000", "email")).toBe("/app");
    expect(confirmDestination("http://localhost:3000/", "email")).toBe("/app");
    expect(confirmDestination("/", "recovery")).toBe("/reset-password");
  });

  it("ignores foreign or unsafe values instead of failing", () => {
    expect(confirmDestination("https://evil.example/x", "email")).toBe("/app");
    expect(confirmDestination("//evil.example", "email")).toBe("/app");
    expect(confirmDestination("javascript:alert(1)", "recovery")).toBe("/reset-password");
  });
});
