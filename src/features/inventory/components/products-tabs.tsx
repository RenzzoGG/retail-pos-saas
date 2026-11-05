import Link from "next/link";

const TABS = [
  { href: "/app/products", label: "Catalog", key: "catalog" },
  { href: "/app/products/receive", label: "Receive stock", key: "receive" },
  { href: "/app/products/entries", label: "Stock entries", key: "entries" },
] as const;

/** Sub-navigation of the Products section (owner/admin only). */
export function ProductsTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Products section" className="mb-6 border-b border-slate-200 dark:border-slate-800">
      <ul className="-mb-px flex flex-wrap gap-4">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={current === tab.key ? "page" : undefined}
              className={`inline-block border-b-2 px-1 pb-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
                current === tab.key
                  ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
