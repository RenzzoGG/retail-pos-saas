import Link from "next/link";

type Props = {
  page: number;
  pageCount: number;
  total: number;
  /** Builds the URL of a given page (keeps the current filters). */
  hrefFor: (page: number) => string;
  label?: string;
};

const LINK =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-600 dark:hover:bg-slate-800";

export function Pagination({ page, pageCount, total, hrefFor, label = "results" }: Props) {
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
      <p>
        {total} {label} · page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={LINK} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={`${LINK} pointer-events-none opacity-40`} aria-disabled="true">
            Previous
          </span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={LINK} rel="next">
            Next
          </Link>
        ) : (
          <span className={`${LINK} pointer-events-none opacity-40`} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
