// Starts `next dev` with the LOCAL Supabase URL + publishable key injected at
// runtime (useful when .env.local is not set up). Values are never printed.
import { spawn } from "node:child_process";
import { localSupabaseEnv } from "./local-supabase-env.mjs";

const child = spawn("npx", ["next", "dev", "--port", "3000"], {
  env: { ...process.env, ...localSupabaseEnv() },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
