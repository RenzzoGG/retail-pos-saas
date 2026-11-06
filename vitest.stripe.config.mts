import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * OPTIONAL tests against the real Stripe API in TEST mode. They are skipped
 * unless STRIPE_SECRET_KEY (sk_test_…) and STRIPE_PRICE_ID are in the
 * environment. CI never runs them. Run them yourself with:
 *   npm run test:stripe        (loads .env.local with node --env-file)
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/integration/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/stripe/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
