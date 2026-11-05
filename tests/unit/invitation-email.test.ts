import { describe, expect, it } from "vitest";
import { buildInvitationEmail } from "@/lib/email/templates";
import { generateInvitationToken, hashInvitationToken } from "@/features/team/tokens";

describe("invitation email", () => {
  const email = buildInvitationEmail({
    storeName: "Bob's <Gadgets>",
    inviterName: "Olivia",
    role: "cashier",
    acceptUrl: "http://localhost:3000/invite/token123",
    expiresAt: new Date("2026-11-12T00:00:00Z"),
  });

  it("includes the store, role and link", () => {
    expect(email.subject).toContain("Bob's <Gadgets>");
    expect(email.text).toContain("as Cashier");
    expect(email.text).toContain("http://localhost:3000/invite/token123");
  });

  it("escapes user-provided values in HTML", () => {
    expect(email.html).toContain("Bob&#39;s &lt;Gadgets&gt;");
    expect(email.html).not.toContain("<Gadgets>");
  });
});

describe("invitation tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("are stored as SHA-256 hex (same as app.hash_token in SQL)", () => {
    expect(hashInvitationToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
