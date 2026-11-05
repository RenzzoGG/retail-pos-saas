import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <Link
        href="/"
        className="mb-8 rounded text-2xl font-bold tracking-tight text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-white"
      >
        Stocktill
      </Link>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
      <p className="mt-6 text-xs text-slate-500">Stocktill is a fictional brand created for a portfolio project.</p>
    </main>
  );
}
