/**
 * Formats a money amount for display using the store's currency and locale.
 * Amounts are stored as numeric(12,2) in the database; this is display-only.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale = "en-US",
): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Invalid money amount: ${amount}`);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}
