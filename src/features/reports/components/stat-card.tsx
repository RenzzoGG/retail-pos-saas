import { formatPercent } from "@/lib/money";
import { change } from "../ranges";

type Props = {
  label: string;
  value: string;
  /** Numbers to compare (current vs. previous period). */
  current?: number;
  previous?: number;
  previousLabel?: string;
  previousDisplay?: string;
  /** For refunds and write-offs, going up is bad. */
  goodWhenUp?: boolean;
  hint?: string;
  testId?: string;
};

/** KPI tile. The change carries an arrow and words, never color alone. */
export function StatCard({ label, value, current, previous, previousLabel, previousDisplay, goodWhenUp = true, hint, testId }: Props) {
  const delta = current === undefined || previous === undefined ? undefined : change(current, previous);
  let trend: React.ReactNode = null;
  if (delta !== undefined) {
    if (delta === null) {
      trend = <span className="text-slate-500">New (nothing to compare)</span>;
    } else if (Math.abs(delta) < 0.0005) {
      trend = <span className="text-slate-500">— No change</span>;
    } else {
      const up = delta > 0;
      const good = up === goodWhenUp;
      trend = (
        <span className={good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
          <span aria-hidden="true">{up ? "▲" : "▼"}</span> {up ? "Up" : "Down"} {formatPercent(Math.abs(delta))}
        </span>
      );
    }
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </dd>
      {trend ? (
        <dd className="mt-1 text-xs">
          {trend}
          {previousLabel ? (
            <span className="block text-slate-500 dark:text-slate-400">
              {previousLabel}
              {previousDisplay ? `: ${previousDisplay}` : ""}
            </span>
          ) : null}
        </dd>
      ) : null}
      {hint ? <dd className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</dd> : null}
    </div>
  );
}
