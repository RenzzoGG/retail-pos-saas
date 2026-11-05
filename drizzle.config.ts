import { defineConfig } from "drizzle-kit";

/**
 * Migrations are written into supabase/migrations with Supabase-style
 * timestamp names, so `supabase db reset` / `supabase migration up` applies
 * them together with the hand-written SQL (RLS policies, functions, triggers).
 *
 * The fallback URL is the public default of the *local* Supabase stack
 * (documented by Supabase, not a secret). Never point this at production
 * without setting DATABASE_URL explicitly.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./supabase/migrations",
  migrations: { prefix: "supabase" },
  schemaFilter: ["public"],
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  strict: true,
  verbose: true,
});
