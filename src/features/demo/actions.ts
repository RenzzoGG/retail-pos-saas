"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { demoAccountFor, getDemoConfig } from "./config";

/** One-click sign-in with a published demo account ("Try as Owner/Admin/Cashier"). */
export async function demoSignIn(formData: FormData): Promise<void> {
  const config = getDemoConfig();
  const account = demoAccountFor(formData.get("role"));
  if (!config || !account) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: config.password });
  if (error) redirect("/login?error=demo_unavailable");
  redirect("/app");
}
