import type { TestProject } from "vitest/node";
// @ts-expect-error -- plain ESM helper without type declarations
import { localSupabaseEnv } from "../../scripts/local-supabase-env.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabasePublishableKey: string;
  }
}

/** Reads the local URL + publishable key once, in memory (never printed). */
export default function setup(project: TestProject) {
  const env = localSupabaseEnv() as Record<string, string>;
  project.provide("supabaseUrl", env.NEXT_PUBLIC_SUPABASE_URL as string);
  project.provide("supabasePublishableKey", env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
}
