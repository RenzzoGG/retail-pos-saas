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

/**
 * Money arithmetic in integer cents. Postgres returns numeric(12,2) as a
 * string ("19.99"); converting to cents avoids float errors like 0.1 + 0.2.
 */
export function toCents(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) throw new RangeError(`Invalid money amount: ${value}`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export type MarginInfo = {
  /** Sale price without tax (equals the price when prices exclude tax). */
  netPrice: number;
  cost: number;
  /** Profit per unit: net price - cost. */
  margin: number;
  /** Margin as a fraction of the net price (0.25 = 25 %), null if the net price is 0. */
  marginPct: number | null;
};

/**
 * Unit margin. When shelf prices include tax, the tax is not revenue: the
 * margin is computed on the net price, otherwise it would be overstated.
 * Returns null when the product has no cost yet (no stock entries).
 */
export function marginInfo(
  salePrice: number | string,
  cost: number | string | null | undefined,
  taxRate: number | string,
  pricesIncludeTax: boolean,
): MarginInfo | null {
  if (cost === null || cost === undefined) return null;
  const priceCents = toCents(salePrice);
  const rate = Number(taxRate);
  const netCents = pricesIncludeTax ? Math.round(priceCents / (1 + rate)) : priceCents;
  const costCents = toCents(cost);
  const marginCents = netCents - costCents;
  return {
    netPrice: fromCents(netCents),
    cost: fromCents(costCents),
    margin: fromCents(marginCents),
    marginPct: netCents > 0 ? marginCents / netCents : null,
  };
}

export function formatPercent(fraction: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(fraction);
}
