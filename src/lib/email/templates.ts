import { ROLE_LABELS, type StoreRole } from "@/lib/permissions";
import { BRAND, escapeHtml, renderEmail } from "./layout";

export type InvitationEmailInput = {
  storeName: string;
  inviterName: string;
  role: StoreRole;
  acceptUrl: string;
  expiresAt: Date;
};

export type EmailContent = { subject: string; text: string; html: string };

/** "November 20, 2026 at 3:04 PM UTC": the recipient's zone is unknown, so UTC and say it. */
function formatExpiry(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

/**
 * Team invitation: branded HTML (shared layout, src/lib/email/layout.ts) plus
 * a plain-text version. Every user-provided value is escaped in the HTML.
 */
export function buildInvitationEmail(input: InvitationEmailInput): EmailContent {
  const role = ROLE_LABELS[input.role];
  const expires = formatExpiry(input.expiresAt);
  const subject = `You're invited to join ${input.storeName} on Stocktill`;

  const text = [
    `Join ${input.storeName} on Stocktill`,
    "",
    `${input.inviterName} invited you to join ${input.storeName} as ${role}.`,
    "Accept the invitation to start working with your team in Stocktill:",
    "",
    input.acceptUrl,
    "",
    `This invitation expires on ${expires}.`,
    "",
    `You're receiving this email because a member of ${input.storeName} invited this address to their store on Stocktill.`,
    "If you weren't expecting it, you can ignore this email: you won't be added to the store.",
    "",
    "--",
    BRAND.disclaimer,
    BRAND.automated,
  ].join("\n");

  const store = escapeHtml(input.storeName);
  const inviter = escapeHtml(input.inviterName);
  const html = renderEmail({
    title: escapeHtml(subject),
    preheader: `${inviter} invited you to join ${store} as ${escapeHtml(role)}.`,
    heading: `Join ${store} on Stocktill`,
    intro: [
      `${inviter} invited you to join <strong>${store}</strong> as <strong>${escapeHtml(role)}</strong>.`,
      "Accept the invitation to start working with your team in Stocktill. If you don't have an account yet, you can create one with this email address.",
    ],
    button: { label: "Accept the invitation", href: escapeHtml(input.acceptUrl) },
    expiry: `This invitation expires on ${escapeHtml(expires)}.`,
    reason: `You're receiving this email because a member of ${store} invited this address to their store on Stocktill.`,
    ignore: "If you weren't expecting it, you can ignore this email: you won't be added to the store.",
  });

  return { subject, text, html };
}
