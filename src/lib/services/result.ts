import type { SupabaseClient } from "@supabase/supabase-js";
import { type DbErrorLike, dbErrorMessage } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

/** Supabase client acting as the signed-in user (RLS applies). */
export type Db = SupabaseClient<Database>;

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | undefined };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export function fail<T = never>(error: DbErrorLike, fallback?: string): Result<T> {
  return { ok: false, error: dbErrorMessage(error, fallback), code: error?.message ?? undefined };
}

export const FORBIDDEN = "You don't have permission to do that.";
export const forbidden = <T = never>(): Result<T> => ({ ok: false, error: FORBIDDEN, code: "forbidden" });
