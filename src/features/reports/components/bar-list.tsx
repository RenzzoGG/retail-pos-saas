import { barShares } from "../chart-data";

export type BarItem = { key: string; label: string; sublabel?: string | undefined; value: number; display: string; detail?: string | undefined };

/**
 * Horizontal bars as an HTML list: the label and the value are text (read by
 * screen readers and never colored), the bar is decorative. On phones the bar
 * goes under the label instead of beside it.
 */
export function BarList({ items, label, empty = "No data for this period.", testId }: { items: BarItem[]; label: string; empty?: string; testId?: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">{empty}</p>;
  return (
    <ol aria-label={label} className="space-y-3" data-testid={testId}>
      {barShares(items).map((item) => (
        <li key={item.key} className="text-sm" title={item.detail}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-slate-900 dark:text-slate-100">
              {item.label}
              {item.sublabel ? <span className="ml-1 text-xs text-slate-500">{item.sublabel}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-300">{item.display}</span>
          </div>
          <div className="mt-1 h-2 rounded-r bg-transparent" aria-hidden="true">
            <div className="h-2 rounded-r" style={{ width: `${Math.max(item.pct, item.value > 0 ? 1 : 0)}%`, background: "var(--viz-series-1)" }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
