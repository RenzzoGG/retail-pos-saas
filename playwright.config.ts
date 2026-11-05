import { defineConfig, devices } from "@playwright/test";
import { localSupabaseEnv } from "./scripts/local-supabase-env.mjs";

/**
 * E2E tests in a real browser against `next dev` + the LOCAL Supabase stack.
 * The dev server gets the local public URL/key at runtime (never printed or
 * saved). Email links point to http://localhost:3000 (supabase/config.toml
 * site_url), so the app must run on that origin.
 */
const supabaseEnv: Record<string, string> = localSupabaseEnv();
const inherited = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev --port 3000",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...inherited, ...supabaseEnv, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
  },
});
