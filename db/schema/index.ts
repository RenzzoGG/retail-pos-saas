/**
 * Drizzle schema entry point (see docs/DESIGN.md §2).
 *
 * Drizzle owns tables, enums, constraints and indexes. RLS policies, grants,
 * triggers and SQL functions live in hand-written migrations generated with
 * `drizzle-kit generate --custom` (supabase/migrations/*_security.sql, *_functions.sql).
 * At runtime the app uses supabase-js with the user's session, so RLS always applies.
 */
export * from "./enums";
export * from "./stores";
export * from "./inventory";
export * from "./sales";
export * from "./audit";
export * from "./billing";
