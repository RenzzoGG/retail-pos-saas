import type { TestProject } from "vitest/node";
import { localSupabaseEnv } from "../../scripts/local-supabase-env.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabasePublishableKey: string;
  }
}

/** Reads the local URL + publishable key once, in memory (never printed). */
export default function setup(project: TestProject) {
  const env: Record<string, string> = localSupabaseEnv();
  project.provide("supabaseUrl", env.NEXT_PUBLIC_SUPABASE_URL as string);
  project.provide("supabasePublishableKey", env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
}
