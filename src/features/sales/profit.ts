/**
 * Profit of a sale after its returns, in cents.
 *
 *   revenue (without tax) kept = (total - tax) x (total - refunded) / total
 *   cost of goods              = cost of units sold - cost of units RESTOCKED
 *
 * Refunds are a proportional share of the total (tax included), so the same
 * share of the tax-free revenue goes away. Written-off units (not restocked)
 * keep counting as cost: the store lost them.
 */
export function saleProfitCents(input: {
  totalCents: number;
  taxCents: number;
  refundedCents: number;
  soldCostCents: number;
  restockedCostCents: number;
}): number {
  const { totalCents, taxCents, refundedCents, soldCostCents, restockedCostCents } = input;
  const revenue = totalCents === 0 ? 0 : Math.round(((totalCents - taxCents) * (totalCents - refundedCents)) / totalCents);
  return revenue - (soldCostCents - restockedCostCents);
}
