import { type SeriesPoint, columnGeometry, labelIndexes, seriesSummary } from "../chart-data";

type Props = {
  /** Visible caption and accessible name of the chart. */
  title: string;
  points: (SeriesPoint & { detail?: string; longLabel?: string })[];
  format: (n: number) => string;
  formatTick: (n: number) => string;
  /** Extra columns for the data table. */
  table?: { headers: string[]; rows: string[][] } | undefined;
  testId?: string;
};

const HEIGHT = 200;

/**
 * Column chart drawn as SVG on the server (no client JS). Text is HTML so it
 * keeps its real size on phones; the SVG only draws bars and grid lines. Every
 * bar has a tooltip (native <title>) and the same numbers are in a table.
 */
export function ColumnChart({ title, points, format, formatTick, table, testId }: Props) {
  const width = 640;
  const g = columnGeometry(points, { width, height: HEIGHT, left: 0, right: 0, top: 8, bottom: 0 });
  const desktop = new Set(labelIndexes(points.length, 8));
  const mobile = new Set(labelIndexes(points.length, 4));

  return (
    <figure className="min-w-0" data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* y axis */}
        <div className="relative w-12 text-right text-xs text-slate-500 dark:text-slate-400" style={{ height: HEIGHT }} aria-hidden="true">
          {g.ticks.map((t) => (
            <span key={t.value} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${(t.y / HEIGHT) * 100}%` }}>
              {formatTick(t.value)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: HEIGHT }}
          role="img"
          aria-label={`${title}. ${seriesSummary(points, format)} The data table below has every value.`}
        >
          {g.ticks.map((t) => (
            <line key={t.value} x1={0} x2={width} y1={t.y} y2={t.y} stroke="var(--viz-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {g.bars.map((b) => (
            <g key={b.key} className="group">
              {b.path ? <path d={b.path} fill="var(--viz-series-1)" className="transition-opacity group-hover:opacity-70" /> : null}
              {/* Hit target: the whole column band, larger than the bar. */}
              <rect x={b.x - (b.band - b.w) / 2} y={0} width={b.band} height={HEIGHT} fill="transparent">
                <title>{`${b.longLabel ?? b.label}: ${format(b.value)}${b.detail ? ` · ${b.detail}` : ""}`}</title>
              </rect>
            </g>
          ))}
        </svg>
        {/* x axis */}
        <div />
        <div className="relative mt-1 h-5 text-xs text-slate-500 dark:text-slate-400" aria-hidden="true">
          {g.bars.map((b, i) =>
            desktop.has(i) || mobile.has(i) ? (
              <span
                key={b.key}
                className={`absolute -translate-x-1/2 whitespace-nowrap ${mobile.has(i) ? "" : "hidden sm:inline"} ${desktop.has(i) ? "" : "sm:hidden"}`}
                style={{ left: `${((b.x + b.w / 2) / width) * 100}%` }}
              >
                {b.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-indigo-600 hover:underline dark:text-indigo-400">Show data table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="text-left text-slate-600 dark:text-slate-400">
              <tr>
                {(table?.headers ?? ["Period", "Value"]).map((h, i) => (
                  <th key={h} scope="col" className={`py-1 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(table?.rows ?? points.map((p) => [p.longLabel ?? p.label, format(p.value)])).map((row, r) => (
                <tr key={points[r]?.key ?? r}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={i} scope="row" className="py-1 pr-3 text-left font-normal">
                        {cell}
                      </th>
                    ) : (
                      <td key={i} className="py-1 pr-3 text-right tabular-nums">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
