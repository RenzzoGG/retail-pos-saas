import { ROLE_LABELS, type StoreRole } from "@/lib/permissions";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type InvitationEmailInput = {
  storeName: string;
  inviterName: string;
  role: StoreRole;
  acceptUrl: string;
  expiresAt: Date;
};

export type EmailContent = { subject: string; text: string; html: string };

/** Plain-text + HTML invitation email. All user-provided values are escaped. */
export function buildInvitationEmail(input: InvitationEmailInput): EmailContent {
  const role = ROLE_LABELS[input.role];
  const expires = input.expiresAt.toUTCString();
  const subject = `You're invited to join ${input.storeName} on Stocktill`;
  const text = [
    `${input.inviterName} invited you to join ${input.storeName} on Stocktill as ${role}.`,
    "",
    `Accept the invitation: ${input.acceptUrl}`,
    "",
    `This link expires on ${expires}. If you weren't expecting it, you can ignore this email.`,
    "",
    "Stocktill is a fictional brand used in a portfolio project.",
  ].join("\n");
  const html = `<h2>Join ${escapeHtml(input.storeName)} on Stocktill</h2>
<p>${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.storeName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
<p><a href="${escapeHtml(input.acceptUrl)}">Accept the invitation</a></p>
<p>This link expires on ${escapeHtml(expires)}. If you weren't expecting it, you can ignore this email.</p>
<p style="color:#666;font-size:12px">Stocktill is a fictional brand used in a portfolio project.</p>`;
  return { subject, text, html };
}
