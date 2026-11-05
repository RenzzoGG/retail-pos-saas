/**
 * Maps the stable error codes raised by our SQL functions (and common
 * Postgres errors) to messages shown in the UI. Unknown errors get a generic
 * message; details are never leaked to the browser.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  invalid_store_name: "Store name must be between 2 and 80 characters.",
  invalid_currency: "Currency must be a 3-letter ISO code, like USD.",
  invalid_tax_rate: "Tax rate must be between 0% and 99.99%.",
  invitation_not_found: "This invitation link is not valid.",
  invitation_already_used: "This invitation has already been used.",
  invitation_expired: "This invitation has expired. Ask for a new one.",
  invitation_email_mismatch:
    "This invitation was sent to a different email address. Sign in with that email to accept it.",
  already_member: "You're already a member of this store.",
  store_needs_owner: "A store must always have at least one owner.",
};

export type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

export function dbErrorMessage(error: DbErrorLike, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const key = error.message ?? "";
  if (key in MESSAGES) return MESSAGES[key] as string;
  if (error.code === "42501") return MESSAGES.forbidden as string;
  if (error.code === "23505") return "That already exists.";
  return fallback;
}

export function isDbError(error: DbErrorLike, code: string): boolean {
  return error?.message === code;
}
