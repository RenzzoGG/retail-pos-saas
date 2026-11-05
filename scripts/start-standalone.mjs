// Runs the production build the same way the Docker image will (phase 11):
// `output: "standalone"` emits .next/standalone/server.js, which needs the
// static assets and public/ copied next to it.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

const root = ".next/standalone";
if (!existsSync(`${root}/server.js`)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(".next/static", `${root}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${root}/public`, { recursive: true });

const child = spawn(process.execPath, [`${root}/server.js`], {
  env: { ...process.env, PORT: process.env.PORT ?? "3000", HOSTNAME: process.env.HOSTNAME_BIND ?? "localhost" },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
