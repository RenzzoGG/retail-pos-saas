import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTH_LINK_LIFETIME_SECONDS, BRAND, SUPABASE_AUTH_EMAILS } from "@/lib/email/layout";
import { buildInvitationEmail } from "@/lib/email/templates";

const config = readFileSync("supabase/config.toml", "utf8");

const invitation = buildInvitationEmail({
  storeName: "Corner Market",
  inviterName: "Olivia Park",
  role: "admin",
  acceptUrl: "https://stocktill.example.com/invite/tok_123",
  expiresAt: new Date("2026-11-20T15:04:00Z"),
});

const ALL: [string, string][] = [
  ["confirmation", SUPABASE_AUTH_EMAILS.confirmation.html],
  ["recovery", SUPABASE_AUTH_EMAILS.recovery.html],
  ["invitation", invitation.html],
];

/** The [auth.email.template.<name>] section of config.toml. */
function templateSection(name: string): string {
  const start = config.indexOf(`[auth.email.template.${name}]`);
  expect(start, `config.toml has [auth.email.template.${name}]`).toBeGreaterThanOrEqual(0);
  return config.slice(start, config.indexOf("\n\n", start));
}

describe("Supabase Auth templates", () => {
  it.each(Object.entries(SUPABASE_AUTH_EMAILS))(
    "%s.html matches the source (run `npm run emails:build`)",
    (_name, email) => {
      expect(readFileSync(email.file, "utf8")).toBe(email.html);
    },
  );

  it.each(Object.entries(SUPABASE_AUTH_EMAILS))("%s: config.toml uses the same subject and file", (name, email) => {
    const section = templateSection(name);
    expect(section).toContain(`subject = "${email.subject}"`);
    expect(section).toContain(`content_path = "./${email.file}"`);
  });

  it("say the link lifetime that config.toml configures", () => {
    expect(config).toMatch(new RegExp(`^otp_expiry = ${AUTH_LINK_LIFETIME_SECONDS}$`, "m"));
    expect(AUTH_LINK_LIFETIME_SECONDS).toBe(3600);
    for (const email of Object.values(SUPABASE_AUTH_EMAILS)) expect(email.html).toContain("expires in 1 hour");
  });

  it("link to /auth/confirm the way the route expects", () => {
    expect(SUPABASE_AUTH_EMAILS.confirmation.html).toContain(
      'href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next={{ .RedirectTo }}"',
    );
    expect(SUPABASE_AUTH_EMAILS.recovery.html).toContain(
      'href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password"',
    );
  });

  it("only use Go template variables Supabase provides", () => {
    for (const email of Object.values(SUPABASE_AUTH_EMAILS)) {
      const vars = new Set([...email.html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map((m) => m[1]));
      expect([...vars].sort()).toEqual(["Email", "RedirectTo", "SiteURL", "TokenHash"].filter((v) => vars.has(v)));
      expect(email.html.match(/\{\{/g)?.length).toBe(email.html.match(/\}\}/g)?.length);
    }
  });
});

describe.each(ALL)("%s email is safe for email clients", (_name, html) => {
  it("has no HTML comments (Supabase strips them), <style>, flexbox or grid", () => {
    expect(html).not.toContain("<!--");
    expect(html).not.toMatch(/<style|<link|<script/i);
    expect(html).not.toMatch(/display:\s*(flex|grid)/i);
  });

  it("uses tables for layout, all marked role=presentation", () => {
    const tables = html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(2);
    for (const table of tables) expect(table).toContain('role="presentation"');
  });

  it("is fluid up to 560px, centered (no fixed width that phones would scroll)", () => {
    expect(html).toContain('width="560"');
    expect(html).toContain("width:100%;max-width:560px;");
    expect(html).not.toMatch(/[;"\s]width:\s*560px/); // max-width:560px is fine
    expect(html).toContain('align="center"');
  });

  it("is accessible and self-contained", () => {
    expect(html).toContain('<html lang="en"');
    expect(html).not.toMatch(/<img\b/i); // no remote images: the wordmark is text
    expect(html).toContain(`>${BRAND.name}</td>`);
  });

  it("has a hidden preheader, a bulletproof button and the link as text", () => {
    expect(html).toMatch(/<div style="display:none;[^"]*mso-hide:all;/);
    expect(html).toMatch(new RegExp(`<td align="center" bgcolor="${BRAND.primary}"`));
    expect(html).toContain("If the button doesn't work, copy and paste this link into your browser:");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(2); // button + text link, same URL
    expect(hrefs[0]).toBe(hrefs[1]);
    expect(html).toContain(`>${hrefs[0]}</a>`);
  });

  it("explains why it was sent, what ignoring it does, and has the footer", () => {
    expect(html).toContain("You're receiving this email because");
    expect(html).toMatch(/you can ignore this email/);
    expect(html).toMatch(/expires (in|on)/);
    expect(html).toContain(BRAND.disclaimer);
    expect(html).toContain(BRAND.automated);
  });
});

describe("team invitation", () => {
  it("has a plain-text version with the link, expiry and footer", () => {
    expect(invitation.text).toContain("Olivia Park invited you to join Corner Market as Admin.");
    expect(invitation.text).toContain("https://stocktill.example.com/invite/tok_123");
    expect(invitation.text).toContain("This invitation expires on November 20, 2026 at 3:04 PM UTC.");
    expect(invitation.text).toContain(BRAND.disclaimer);
    expect(invitation.text).not.toMatch(/<[a-z]/i);
  });

  it("states the expiry in UTC in the HTML too", () => {
    expect(invitation.html).toContain("This invitation expires on November 20, 2026 at 3:04 PM UTC.");
  });
});

/** WCAG 2.x contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("brand colors", () => {
  it.each([
    ["button text on the button", BRAND.onPrimary, BRAND.primary],
    ["body text on the card", BRAND.text, BRAND.card],
    ["headings on the card", BRAND.heading, BRAND.card],
    ["links on the card", BRAND.primary, BRAND.card],
    ["secondary text on the card", BRAND.muted, BRAND.card],
    ["footer on the page background", BRAND.muted, BRAND.page],
    ["wordmark on the page background", BRAND.primary, BRAND.page],
  ])("%s meets WCAG AA (4.5:1)", (_what, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
