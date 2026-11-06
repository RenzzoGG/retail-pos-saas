// Reads the LOCAL Supabase API URL and publishable key at runtime from
// `supabase status -o env`, for tests and the E2E dev server.
// Values stay in memory: never printed, written to disk or committed.
// Only public (publishable) values are returned; the secret key is ignored.
import { execFileSync } from "node:child_process";

export function localSupabaseEnv() {
  let output;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local Supabase is not running. Start it with: npm run supabase:start");
  }
  const vars = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  const url = vars.API_URL;
  const publishableKey = vars.PUBLISHABLE_KEY || vars.ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Could not read the local API URL / publishable key from `supabase status`.");
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}

/**
 * ONLY for the Stripe webhook integration tests (see the exception in CLAUDE.md):
 * the LOCAL stack's secret key, which the webhook route needs to write the
 * Stripe tables. It refuses anything that is not the local stack, and the value
 * stays in memory: never printed, written to disk, committed or reported.
 * User-permission tests must never use it.
 */
export function localSupabaseSecretForWebhookTests() {
  let output;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local Supabase is not running. Start it with: npm run supabase:start");
  }
  const vars = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  const url = vars.API_URL;
  const secretKey = vars.SECRET_KEY || vars.SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("Could not read the local API URL / secret key from `supabase status`.");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Refusing to use a Supabase secret key that is not from the LOCAL stack.");
  }
  return { url, secretKey };
}
