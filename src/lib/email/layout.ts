/**
 * Branded email layout: the single source for every Stocktill email.
 *
 * - App emails (team invitation, sent by nodemailer) call renderEmail() at
 *   runtime with escaped values (src/lib/email/templates.ts).
 * - Supabase Auth emails (sign-up confirmation, password reset) are generated
 *   from SUPABASE_AUTH_EMAILS into supabase/templates/*.html by
 *   `npm run emails:build`, then pasted into the Supabase dashboard
 *   (docs/DEPLOY.md). A unit test fails if the files drift from this source.
 *
 * Email-client rules followed here (Gmail web/app, Apple Mail, Outlook):
 * - layout with tables (role="presentation") and inline styles only: no
 *   <style> block, no flexbox or grid;
 * - fluid width capped at 560px: width:100% + max-width:560px in CSS, and
 *   width="560" as an HTML attribute for clients that ignore max-width.
 *   (max-width:100% on a fixed 560px table does NOT shrink it inside a table
 *   cell: the cell grows to fit, so phones would scroll sideways.) No Outlook
 *   conditional comments: Supabase strips HTML comments from templates. At
 *   worst, Outlook for Windows shows the card as wide as the reading pane;
 *   it stays readable;
 * - no remote images: the "Stocktill" wordmark is text;
 * - a hidden preheader (inbox preview), a "bulletproof" button (a table cell
 *   with a background color, so it shows even when images are blocked) and
 *   the full link as text below it.
 *
 * This file has no imports on purpose: scripts/build-emails.mjs loads it
 * directly with Node (type stripping), without the Next.js toolchain.
 */

/** Brand values, taken from the app's Tailwind palette (v4 hex values). */
export const BRAND = {
  name: "Stocktill",
  /** indigo-600: primary buttons and links in the app. */
  primary: "#4f39f6",
  /** indigo-50: subtle tint. */
  tint: "#eef2ff",
  /** slate-100: email background. */
  page: "#f1f5f9",
  /** White card. */
  card: "#ffffff",
  /** slate-200: card border and dividers. */
  border: "#e2e8f0",
  /** slate-900: headings. */
  heading: "#0f172b",
  /** slate-700: body text. */
  text: "#314158",
  /** slate-600: secondary text and footer. */
  muted: "#45556c",
  /** White text on the primary button. */
  onPrimary: "#ffffff",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  /** Max content width in px. */
  width: 560,
  disclaimer: "Stocktill is a fictional brand used in a portfolio project.",
  automated: "This is an automated email. Replies to this address aren't read.",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Content of one email. Every field is HTML, inserted as is: callers escape
 * user-provided values (escapeHtml). Supabase templates pass Go template
 * placeholders such as {{ .Email }} through unchanged.
 */
export type EmailLayoutInput = {
  /** Document <title> (usually the subject). */
  title: string;
  /** Inbox preview text, hidden in the body. */
  preheader: string;
  heading: string;
  /** Paragraphs before the button. */
  intro: string[];
  button: { label: string; href: string };
  /** How long the link works, shown right under the button. */
  expiry: string;
  /** Why the recipient got this email. */
  reason: string;
  /** What happens if they ignore it. */
  ignore: string;
};

const FONT = `font-family:${BRAND.font};`;

function paragraph(html: string, style: string): string {
  return `<p style="margin:0 0 16px 0;${FONT}${style}">${html}</p>`;
}

/**
 * Hidden preheader. The trailing invisible characters stop clients from
 * filling the preview with the start of the body.
 */
function preheader(text: string): string {
  const filler = "&#847;&zwnj;&nbsp;".repeat(40);
  return (
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${BRAND.page};">` +
    `${text}${filler}</div>`
  );
}

/** "Bulletproof" button: the cell carries the color, the link carries padding and border. */
function button({ label, href }: { label: string; href: string }): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;border-collapse:separate;">` +
    `<tr><td align="center" bgcolor="${BRAND.primary}" style="border-radius:6px;background-color:${BRAND.primary};">` +
    `<a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;border:1px solid ${BRAND.primary};border-radius:6px;` +
    `${FONT}font-size:16px;line-height:20px;font-weight:600;color:${BRAND.onPrimary};text-decoration:none;">${label}</a>` +
    `</td></tr></table>`
  );
}

export function renderEmail(input: EmailLayoutInput): string {
  const body = [
    `<h1 style="margin:0 0 16px 0;${FONT}font-size:22px;line-height:30px;font-weight:700;color:${BRAND.heading};">${input.heading}</h1>`,
    ...input.intro.map((p) => paragraph(p, `font-size:16px;line-height:24px;color:${BRAND.text};`)),
    button(input.button),
    paragraph(input.expiry, `font-size:14px;line-height:21px;color:${BRAND.text};`),
    paragraph(
      `If the button doesn't work, copy and paste this link into your browser:<br>` +
        `<a href="${input.button.href}" target="_blank" style="color:${BRAND.primary};text-decoration:underline;word-break:break-all;">${input.button.href}</a>`,
      `font-size:13px;line-height:20px;color:${BRAND.muted};word-break:break-all;`,
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 16px 0;">` +
      `<tr><td style="border-top:1px solid ${BRAND.border};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`,
    paragraph(input.reason, `font-size:13px;line-height:20px;color:${BRAND.muted};`),
    `<p style="margin:0;${FONT}font-size:13px;line-height:20px;color:${BRAND.muted};">${input.ignore}</p>`,
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${input.title}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.page};">
${preheader(input.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.page}" style="width:100%;background-color:${BRAND.page};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="${BRAND.width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${BRAND.width}px;">
<tr><td style="padding:0 4px 16px 4px;${FONT}font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.3px;color:${BRAND.primary};">${BRAND.name}</td></tr>
<tr><td bgcolor="${BRAND.card}" style="padding:28px 28px 24px 28px;background-color:${BRAND.card};border:1px solid ${BRAND.border};border-top:4px solid ${BRAND.primary};border-radius:8px;">
${body}
</td></tr>
<tr><td align="center" style="padding:20px 8px 0 8px;${FONT}font-size:12px;line-height:18px;color:${BRAND.muted};">${BRAND.disclaimer}<br>${BRAND.automated}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/**
 * Lifetime of Supabase email links. Must match `otp_expiry` in
 * supabase/config.toml (3600 s) and "Email OTP Expiration" in the Supabase
 * dashboard. A unit test checks the config.
 */
export const AUTH_LINK_LIFETIME_SECONDS = 3600;
const AUTH_LINK_LIFETIME = "1 hour";

/**
 * Links handled by /auth/confirm (src/app/auth/confirm/route.ts). `&amp;` is
 * the HTML-correct way to write `&` inside an attribute; browsers and email
 * clients decode it. {{ .RedirectTo }} is the sign-up's emailRedirectTo
 * (absolute) or empty: /auth/confirm accepts both.
 */
const CONFIRM_LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next={{ .RedirectTo }}";
const RECOVERY_LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password";

export type SupabaseAuthEmail = { subject: string; file: string; html: string };

/** Supabase Auth email templates (Go template syntax), by config.toml template name. */
export const SUPABASE_AUTH_EMAILS: Record<"confirmation" | "recovery", SupabaseAuthEmail> = {
  confirmation: {
    subject: "Confirm your Stocktill account",
    file: "supabase/templates/confirmation.html",
    html: renderEmail({
      title: "Confirm your Stocktill account",
      preheader: `Confirm your email to finish creating your Stocktill account. The link expires in ${AUTH_LINK_LIFETIME}.`,
      heading: "Confirm your email address",
      intro: [
        "Thanks for signing up for Stocktill, the point of sale and inventory app for small shops.",
        "Confirm that <strong>{{ .Email }}</strong> is your email address to finish creating your account and set up your store.",
      ],
      button: { label: "Confirm my email", href: CONFIRM_LINK },
      expiry: `This link expires in ${AUTH_LINK_LIFETIME} and works once.`,
      reason: "You're receiving this email because someone created a Stocktill account with this address.",
      ignore: "If that wasn't you, you can ignore this email: the account won't be activated.",
    }),
  },
  recovery: {
    subject: "Reset your Stocktill password",
    file: "supabase/templates/recovery.html",
    html: renderEmail({
      title: "Reset your Stocktill password",
      preheader: `Use this link to choose a new Stocktill password. It expires in ${AUTH_LINK_LIFETIME}.`,
      heading: "Reset your password",
      intro: [
        "We received a request to reset the password of the Stocktill account <strong>{{ .Email }}</strong>.",
        "Choose a new password with the button below.",
      ],
      button: { label: "Choose a new password", href: RECOVERY_LINK },
      expiry: `This link expires in ${AUTH_LINK_LIFETIME} and works once.`,
      reason: "You're receiving this email because a password reset was requested for this address on Stocktill.",
      ignore: "If you didn't ask for it, you can ignore this email: your password won't change.",
    }),
  },
};
