"use server";

import { redirect } from "next/navigation";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { isDemoEmail } from "@/features/demo/config";
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from "./schemas";

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["fullName", "email"]);
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  }
  const next = safeNextPath(String(formData.get("next") ?? ""), "/onboarding");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      // Where the confirmation link sends the user afterwards (see /auth/confirm).
      emailRedirectTo: `${getSiteUrl()}${next}`,
    },
  });
  if (error) {
    const message = /password/i.test(error.message)
      ? "That password is too weak. Use at least 8 characters."
      : "We couldn't create your account. Please try again.";
    return { status: "error", message, values };
  }
  // Supabase answers the same way for new and existing emails (no account enumeration).
  redirect(`/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email first. Check your inbox for the confirmation link."
        : "Incorrect email or password.";
    return { status: "error", message, values };
  }
  // The session cookies were written by @supabase/ssr through cookies().set().
  redirect(safeNextPath(String(formData.get("next") ?? ""), "/app"));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  }
  // Demo addresses (.test) can't receive email: never send to them.
  if (!isDemoEmail(parsed.data.email)) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${getSiteUrl()}/reset-password`,
    });
  }
  // Same answer whether or not the account exists.
  return {
    status: "success",
    message: "If an account exists for that email, we've sent a link to reset your password.",
    values,
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: zodFieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  // The published demo accounts keep their published password (the nightly
  // reset also restores it if someone changes it through the Auth API).
  const { data: claims } = await supabase.auth.getClaims();
  if (isDemoEmail(typeof claims?.claims?.email === "string" ? claims.claims.email : null)) {
    return { status: "error", message: "Demo accounts can't change their password." };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      status: "error",
      message: "Your reset link has expired or was already used. Request a new one.",
    };
  }
  redirect("/app");
}
