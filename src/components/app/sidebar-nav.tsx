"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavItem } from "@/lib/permissions";

/** Navigation links; collapses behind a button on small screens. */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <nav aria-label="Main">
      <button
        type="button"
        className="mb-2 inline-flex w-full items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm font-medium md:hidden dark:border-slate-700"
        aria-expanded={open}
        aria-controls="main-nav-list"
        onClick={() => setOpen((v) => !v)}
      >
        Menu
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      <ul id="main-nav-list" className={`${open ? "block" : "hidden"} space-y-1 md:block`}>
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={[
                  "block rounded-md px-3 py-2 text-sm font-medium",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500",
                  active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
