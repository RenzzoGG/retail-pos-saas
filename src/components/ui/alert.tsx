import type { ReactNode } from "react";

const TONES = {
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  success:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

/** Errors are announced immediately (role=alert); other messages politely (role=status). */
export function Alert({ tone = "info", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}

export function FormMessage({ status, message }: { status: string; message?: string | undefined }) {
  if (!message || status === "idle") return null;
  return <Alert tone={status === "error" ? "error" : "success"}>{message}</Alert>;
}
