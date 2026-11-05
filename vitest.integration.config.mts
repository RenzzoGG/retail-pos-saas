import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against the LOCAL Supabase stack (`npm run supabase:start`).
 * They sign in as the seed's demo users with the publishable key only.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server modules are imported directly here (no Next.js server).
      "server-only": fileURLToPath(new URL("./tests/integration/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Tests share the demo database; run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
