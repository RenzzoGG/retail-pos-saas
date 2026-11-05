import { describe, expect, it } from "vitest";
import { sendEmail } from "@/lib/email/mailer";
import { buildInvitationEmail } from "@/lib/email/templates";

const MAILPIT_URL = "http://localhost:54324";

describe("invitation email delivery (local Mailpit)", () => {
  it("is delivered over SMTP and readable in Mailpit", async () => {
    const to = `mail-${Date.now()}@example.com`;
    await sendEmail(
      to,
      buildInvitationEmail({
        storeName: "Mail Test Shop",
        inviterName: "Tester",
        role: "cashier",
        acceptUrl: "http://localhost:3000/invite/test-token",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );

    let subject: string | undefined;
    for (let i = 0; i < 20 && !subject; i++) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
      const body = (await res.json()) as { messages?: { Subject: string }[] };
      subject = body.messages?.[0]?.Subject;
      if (!subject) await new Promise((r) => setTimeout(r, 250));
    }
    expect(subject).toBe("You're invited to join Mail Test Shop on Stocktill");
  });
});
