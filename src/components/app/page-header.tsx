import type { ReactNode } from "react";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p> : null}
      </div>
      {children}
    </header>
  );
}

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-lg font-medium text-slate-900 dark:text-white">Coming soon</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">This section arrives in {phase}.</p>
      </div>
    </>
  );
}
