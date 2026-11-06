import { DEMO_RESET_TIME } from "../config";

/** On every private page of the locked demo store. */
export function DemoBanner() {
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
    >
      <span aria-hidden="true" className="mr-1 font-bold">i</span>
      Public demo store: feel free to sell, return and edit products. Everything resets every night at{" "}
      {DEMO_RESET_TIME}. Team, invitations, store settings and passwords are locked.
    </div>
  );
}
