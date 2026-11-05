/**
 * Drizzle schema entry point.
 *
 * Tables are added in phase 2 (see docs/DESIGN.md §2). Drizzle only owns the
 * schema and migration generation; at runtime the app talks to the database
 * through supabase-js with the signed-in user's session, so RLS always applies.
 */
export {};
