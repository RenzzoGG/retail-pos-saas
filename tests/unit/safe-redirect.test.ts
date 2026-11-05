import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it("keeps relative paths", () => {
    expect(safeNextPath("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });
  it("blocks open redirects", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe("/app");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
    expect(safeNextPath("javascript:alert(1)")).toBe("/app");
  });
  it("accepts absolute URLs of our own site, reduced to the path", () => {
    expect(safeNextPath("http://localhost:3000/onboarding", "/app", "http://localhost:3000")).toBe("/onboarding");
    expect(safeNextPath("http://localhost:4000/onboarding", "/app", "http://localhost:3000")).toBe("/app");
  });
  it("uses the fallback when empty", () => {
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });
});
