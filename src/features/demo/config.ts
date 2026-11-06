import type { StoreRole } from "@/lib/permissions";

/**
 * Public portfolio demo (phase 11). The demo accounts and their password are
 * published on purpose: anyone can try the POS. The store is rebuilt every
 * night by public.reset_demo_store() (pg_cron in production), and the
 * database locks what could break it for the next visitor (team, invitations,
 * store settings). See docs/DEPLOY.md.
 */

/** Reserved .test domain: the demo addresses can never receive email. */
export const DEMO_EMAIL_DOMAIN = "demo.stocktill.test";

/** When the production cron job rebuilds the demo store (keep in sync with docs/DEPLOY.md). */
export const DEMO_RESET_TIME = "03:00 UTC";

export type DemoAccount = { role: StoreRole; email: string; label: string; summary: string };

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: "owner",
    email: `owner@${DEMO_EMAIL_DOMAIN}`,
    label: "Owner",
    summary: "Dashboard, reports with profit, Excel export, returns, activity log.",
  },
  {
    role: "admin",
    email: `admin@${DEMO_EMAIL_DOMAIN}`,
    label: "Admin",
    summary: "Inventory, Excel import with preview, stock entries, returns.",
  },
  {
    role: "cashier",
    email: `cashier@${DEMO_EMAIL_DOMAIN}`,
    label: "Cashier",
    summary: "Fast checkout with a barcode scanner, split payments, 80 mm tickets.",
  },
];

export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

export function demoAccountFor(role: unknown): DemoAccount | null {
  return DEMO_ACCOUNTS.find((a) => a.role === role) ?? null;
}

export type DemoConfig = { password: string };

/**
 * The demo panel only shows when the deployment opts in. Both values are
 * public (inlined at build time): the password is printed on the login page.
 */
export function getDemoConfig(): DemoConfig | null {
  const enabled = process.env.NEXT_PUBLIC_DEMO_ENABLED === "true";
  const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";
  return enabled && password.length >= 8 ? { password } : null;
}
