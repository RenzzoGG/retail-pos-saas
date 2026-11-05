import { defineConfig, devices } from "@playwright/test";
import { localSupabaseEnv } from "./scripts/local-supabase-env.mjs";

/**
 * E2E tests in a real browser against a PRODUCTION build (`next build` +
 * `next start`) and the LOCAL Supabase stack. A production server has no
 * on-demand compilation or dev reloads, so tests are stable and exercise what
 * would be deployed. The server gets the local public URL/key at runtime
 * (never printed or saved). Email links point to http://localhost:3000
 * (supabase/config.toml site_url), so the app must run on that origin.
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
    command: "npm run build && npm run start",
    url: "http://localhost:3000/api/health",
    // Locally, an already running server on :3000 is reused (stop `npm run dev`
    // first if you want the production build to be tested).
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      ...inherited,
      ...supabaseEnv,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      // Production has no SMTP defaults: point invitations at local Mailpit.
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "54325",
    },
  },
});
