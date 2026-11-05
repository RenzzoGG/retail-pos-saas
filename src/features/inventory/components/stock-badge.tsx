export function StockBadge({ stock, isLowStock }: { stock: number; isLowStock: boolean }) {
  if (!isLowStock) return null;
  const out = stock === 0;
  return (
    <span
      className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        out
          ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }`}
    >
      {out ? "Out of stock" : "Low stock"}
    </span>
  );
}
