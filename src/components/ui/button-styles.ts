/** Shared button styles (usable from Server and Client Components). */
export type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-400",
  secondary:
    "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-400",
  ghost: "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
};

export function buttonClasses(variant: Variant = "primary", extra = ""): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
    "transition-colors disabled:cursor-not-allowed",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500",
    VARIANTS[variant],
    extra,
  ].join(" ");
}
