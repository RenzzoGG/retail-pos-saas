/**
 * Suspense boundary for every page under /app: navigations show this instantly
 * while the page reads its session-dependent data on the server.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="text-sm text-slate-500">
      Loading…
    </div>
  );
}
