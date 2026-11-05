"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-styles";
import { type ImportState, confirmImportAction, previewImportAction } from "../actions";
import { COLUMN_KEYS, type ColumnKey, HEADER_LABELS } from "../columns";
import { buildErrorReport } from "../csv";
import type { RowStatus, ValidatedRow } from "../validate";

const PAGE_SIZE = 50;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "new", label: "New" },
  { value: "update", label: "Updates" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const STATUS_STYLES: Record<RowStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  update: { label: "Update", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  error: { label: "Error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

const idle: ImportState = { status: "idle" };

function fileKey(file: File | null, updateExisting: boolean): string {
  return file ? `${file.name}:${file.size}:${file.lastModified}:${updateExisting}` : "";
}

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Upload → preview → confirm. The browser keeps the File and sends it again on
 * confirm (the server never stores it). FormData is built by hand instead of
 * using <form action>, because React resets a form after an action runs and
 * that would clear the chosen file.
 */
export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [previewedKey, setPreviewedKey] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [inputKey, setInputKey] = useState(0);
  const [previewState, preview] = useActionState(previewImportAction, idle);
  const [confirmState, confirm] = useActionState(confirmImportAction, idle);
  const [isPending, startTransition] = useTransition();
  const [lastStep, setLastStep] = useState<"preview" | "confirm" | null>(null);

  const currentKey = fileKey(file, updateExisting);
  const data = previewState.status === "preview" && previewedKey === currentKey ? previewState.preview : null;
  const done = lastStep === "confirm" && confirmState.status === "done" ? confirmState : null;
  const error =
    lastStep === "confirm" && confirmState.status === "error"
      ? confirmState.message
      : lastStep === "preview" && previewState.status === "error"
        ? previewState.message
        : null;

  function formData(extra?: Record<string, string>): FormData {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (updateExisting) fd.set("updateExisting", "on");
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    return fd;
  }

  function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setLastStep("preview");
    setPreviewedKey(currentKey);
    setFilter("all");
    setPage(1);
    startTransition(() => preview(formData()));
  }

  function onConfirm() {
    if (!data) return;
    setLastStep("confirm");
    startTransition(() => {
      confirm(formData({ fileHash: data.fileHash }));
    });
  }

  function startOver() {
    setFile(null);
    setPreviewedKey("");
    setLastStep(null);
    setInputKey((k) => k + 1);
  }

  const rows = useMemo(
    () => (data ? data.rows.filter((r) => filter === "all" || r.status === filter) : []),
    [data, filter],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const validCount = data ? data.summary.new + data.summary.update : 0;

  if (done) {
    const r = done.result;
    return (
      <div className="space-y-4">
        <Alert tone="success">
          Imported “{done.fileName}”: {r.created} created, {r.updated} updated, {r.skipped} skipped.
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Link href="/app/products" className={buttonClasses("primary")}>
            View catalog
          </Link>
          {r.stockEntryId ? (
            <Link href={`/app/products/entries/${r.stockEntryId}`} className={buttonClasses("secondary")}>
              View stock entry
            </Link>
          ) : null}
          <Button variant="ghost" onClick={startOver}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onPreview} className="space-y-4" noValidate>
        <div className="space-y-1">
          <label htmlFor="import-file" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            File (.xlsx or .csv)
          </label>
          <input
            key={inputKey}
            id="import-file"
            name="file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            aria-describedby="import-file-hint"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:file:bg-slate-800"
          />
          <p id="import-file-hint" className="text-xs text-slate-500">
            Up to 1 MB and 2,000 products. The file is read on the server and not stored.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <input
            id="update-existing"
            type="checkbox"
            checked={updateExisting}
            onChange={(e) => setUpdateExisting(e.target.checked)}
            aria-describedby="update-existing-hint"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          <div>
            <label htmlFor="update-existing" className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Update existing products
            </label>
            <p id="update-existing-hint" className="text-xs text-slate-500">
              Off: rows whose SKU already exists are rejected. On: they update that product; empty optional cells keep the
              current value, and initial stock is added to the current stock.
            </p>
          </div>
        </div>
        <Button type="submit" variant="secondary" disabled={!file || isPending}>
          {isPending && lastStep === "preview" ? "Reading file…" : "Preview"}
        </Button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {data ? (
        <section aria-labelledby="preview-heading" className="space-y-4">
          <h2 id="preview-heading" className="text-lg font-semibold text-slate-900 dark:text-white">
            Preview of “{data.fileName}”
          </h2>
          <dl className="grid gap-3 sm:grid-cols-4" data-testid="import-summary">
            {[
              { label: "Rows", value: data.summary.total },
              { label: "New products", value: data.summary.new },
              { label: "Updates", value: data.summary.update },
              { label: "With errors", value: data.summary.error },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
                <dd className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
          {data.unknownColumns.length > 0 ? (
            <Alert tone="info">Ignored columns: {data.unknownColumns.join(", ")}.</Alert>
          ) : null}
          {data.summary.error > 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Rows with errors will be skipped. Download the report, fix them and upload them again later.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={onConfirm} disabled={validCount === 0 || isPending}>
              {isPending && lastStep === "confirm"
                ? "Importing…"
                : `Import ${validCount} ${validCount === 1 ? "product" : "products"}`}
            </Button>
            {data.summary.error > 0 ? (
              <Button
                variant="secondary"
                onClick={() => downloadText(`errors-${data.fileName.replace(/\.[^.]+$/, "")}.csv`, buildErrorReport(data.rows))}
              >
                Download error report (CSV)
              </Button>
            ) : null}
          </div>

          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Show rows</legend>
            {FILTERS.map((f) => {
              const count = f.value === "all" ? data.summary.total : data.summary[f.value];
              return (
                <label
                  key={f.value}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-500 ${
                    filter === f.value
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                      : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="row-filter"
                    value={f.value}
                    checked={filter === f.value}
                    onChange={() => {
                      setFilter(f.value);
                      setPage(1);
                    }}
                    className="sr-only"
                  />
                  {f.label} ({count})
                </label>
              );
            })}
          </fieldset>

          <PreviewTable rows={visible} />

          {pageCount > 1 ? (
            <nav aria-label="Preview pages" className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const DISPLAY_COLUMNS: ColumnKey[] = [...COLUMN_KEYS];

function PreviewTable({ rows }: { rows: ValidatedRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No rows in this view.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
        <caption className="sr-only">Rows in the file and their status</caption>
        <thead className="bg-slate-50 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Row</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            {DISPLAY_COLUMNS.map((k) => (
              <th key={k} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {HEADER_LABELS[k]}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 font-medium">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row) => {
            const badColumns = new Set(row.errors.map((e) => e.column));
            const status = STATUS_STYLES[row.status];
            return (
              <tr key={row.rowNumber} data-testid={`import-row-${row.rowNumber}`} data-status={row.status}>
                <td className="px-3 py-2 tabular-nums">{row.rowNumber}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                </td>
                {DISPLAY_COLUMNS.map((k) => (
                  <td
                    key={k}
                    className={`max-w-48 truncate px-3 py-2 ${
                      badColumns.has(k) ? "bg-red-50 font-medium text-red-800 dark:bg-red-950 dark:text-red-200" : ""
                    }`}
                    title={row.display[k]}
                  >
                    {row.display[k] || (badColumns.has(k) ? "(empty)" : "")}
                    {badColumns.has(k) ? <span className="sr-only"> (invalid)</span> : null}
                  </td>
                ))}
                <td className="min-w-64 px-3 py-2">
                  {row.errors.length > 0 ? (
                    <ul className="space-y-0.5 text-red-700 dark:text-red-300">
                      {row.errors.map((e) => (
                        <li key={`${e.column}-${e.message}`}>
                          {e.column ? <strong>{HEADER_LABELS[e.column]}: </strong> : null}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : row.changes.length > 0 ? (
                    <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
                      {row.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-500">No changes</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
