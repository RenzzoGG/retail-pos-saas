import { type Page, expect, test } from "@playwright/test";
import { DEMO, signInAs } from "./auth";

/**
 * The production build sends the security headers (src/lib/security-headers.ts)
 * and the real pages run under that Content-Security-Policy without violations:
 * a blocked script, style or request would show up as a console error.
 */
function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test("security headers on pages and API routes", async ({ request }) => {
  for (const path of ["/", "/login", "/api/health"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("script-src 'self' 'unsafe-inline'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("landing, POS, dashboard and reports run without CSP violations", async ({ browser, page }) => {
  const anonymous = collectCspViolations(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.goto("/login", { waitUntil: "networkidle" });
  expect(anonymous).toEqual([]);

  const owner = await signInAs(browser, DEMO.owner);
  const signedIn = collectCspViolations(owner);
  for (const path of ["/app", "/app/pos", "/app/products", "/app/reports"]) {
    await owner.goto(path, { waitUntil: "networkidle" });
  }
  expect(signedIn).toEqual([]);
});
