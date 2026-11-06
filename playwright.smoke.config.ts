import { defineConfig, devices } from "@playwright/test";

/**
 * Read-only smoke test against a DEPLOYED Stocktill (no local server, no data
 * written, no keys):
 *   SMOKE_BASE_URL=https://stocktill.renzzogg.com npm run test:smoke
 * Also works against the local production image: npm run docker:prod, then
 *   SMOKE_BASE_URL=http://localhost:8080 npm run test:smoke
 */
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) {
  throw new Error("Set SMOKE_BASE_URL, e.g. SMOKE_BASE_URL=https://stocktill.renzzogg.com npm run test:smoke");
}

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  // A cold container or a paused Supabase project can be slow on the first hit.
  retries: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
