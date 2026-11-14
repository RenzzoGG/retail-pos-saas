import Link from "next/link";
import { ChevronDownIcon, ChevronUpDownIcon, ChevronUpIcon } from "@/components/ui/icons";

type Props = {
  label: string;
  column: string;
  currentSort: string;
  currentDir: "asc" | "desc";
  hrefFor: (sort: string, dir: "asc" | "desc") => string;
  align?: "left" | "right";
};

/** Column header that sorts the server-side list; exposes the state with aria-sort. */
export function SortHeader({ label, column, currentSort, currentDir, hrefFor, align = "left" }: Props) {
  const active = currentSort === column;
  const nextDir = active && currentDir === "asc" ? "desc" : "asc";
  return (
    <th
      scope="col"
      aria-sort={active ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Link
        href={hrefFor(column, nextDir)}
        className="inline-flex items-center gap-1 rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        {label}
        {active ? (
          currentDir === "asc" ? (
            <ChevronUpIcon size="sm" />
          ) : (
            <ChevronDownIcon size="sm" />
          )
        ) : (
          <ChevronUpDownIcon size="sm" className="text-slate-400 dark:text-slate-500" />
        )}
        <span className="sr-only">{active ? `, sorted ${currentDir === "asc" ? "ascending" : "descending"}` : ", sortable"}</span>
      </Link>
    </th>
  );
}
