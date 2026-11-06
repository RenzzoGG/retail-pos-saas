// Builds the PRODUCTION image (Dockerfile) with the LOCAL Supabase public
// values and runs it, to try the exact image Railway will run.
//   npm run docker:prod            -> build + run on http://localhost:8080
//   npm run docker:prod -- --build -> build only
// The publishable key is read at runtime from `supabase status` and handed to
// docker through the environment (never printed or saved). The container uses
// the host network so it can reach local Supabase on 127.0.0.1.
import { spawnSync } from "node:child_process";
import { localSupabaseEnv } from "./local-supabase-env.mjs";

const IMAGE = "stocktill:local";
const PORT = process.env.PORT ?? "8080";
const env = {
  ...process.env,
  ...localSupabaseEnv(),
  NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
};

function run(args) {
  const result = spawnSync("docker", args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const buildArgs = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
run(["build", "-t", IMAGE, ...buildArgs.flatMap((name) => ["--build-arg", name]), "."]);
if (process.argv.includes("--build")) process.exit(0);

// Invitations go to local Mailpit, as in development.
run([
  "run", "--rm", "--name", "stocktill-prod", "--network", "host",
  "-e", `PORT=${PORT}`, "-e", "SMTP_HOST=127.0.0.1", "-e", "SMTP_PORT=54325",
  "-e", "NEXT_PUBLIC_SUPABASE_URL", "-e", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "-e", "NEXT_PUBLIC_SITE_URL",
  IMAGE,
]);
