import { connection } from "next/server";

/**
 * Liveness probe used by Docker/Railway healthchecks and CI smoke tests.
 * `connection()` opts out of build-time prerendering so every request is
 * answered by the running server (a prerendered "ok" would prove nothing).
 */
export async function GET() {
  await connection();
  return Response.json({ status: "ok" });
}
