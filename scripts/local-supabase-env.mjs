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
