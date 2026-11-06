import { DEMO_ACCOUNTS, DEMO_RESET_TIME, getDemoConfig } from "../config";
import { demoSignIn } from "../actions";

/** "Try the live demo" on the login page: one click per role, credentials in plain sight. */
export function DemoPanel() {
  const config = getDemoConfig();
  if (!config) return null;
  return (
    <section
      id="demo"
      aria-labelledby="demo-heading"
      data-testid="demo-panel"
      className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950"
    >
      <h2 id="demo-heading" className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">
        Try the live demo
      </h2>
      <p className="mt-1 text-xs text-indigo-900 dark:text-indigo-200">
        A sample electronics store with 60 days of sales. Sell, return, import… it all resets every night at{" "}
        {DEMO_RESET_TIME}.
      </p>
      <ul className="mt-3 space-y-2">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.role}>
            <form action={demoSignIn} className="flex items-center justify-between gap-3">
              <input type="hidden" name="role" value={account.role} />
              <p className="min-w-0 text-xs text-indigo-900 dark:text-indigo-200">
                <span className="block font-medium text-indigo-950 dark:text-indigo-50">{account.label}</span>
                {account.summary}
              </p>
              <button
                type="submit"
                className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Try as {account.label}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-indigo-900 dark:text-indigo-200">
        Or sign in by hand: <code className="font-mono">{DEMO_ACCOUNTS[2]?.email}</code> (or owner@ / admin@), password{" "}
        <code className="font-mono" data-testid="demo-password">{config.password}</code>
      </p>
    </section>
  );
}
