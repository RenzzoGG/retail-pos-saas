import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { getSessionUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Choose a new password · Stocktill" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-slate-900 dark:text-white">Choose a new password</h1>
      <Suspense fallback={null}>
        <ResetPasswordContent />
      </Suspense>
    </>
  );
}

/** Reached from the reset email: /auth/confirm already created a session. */
async function ResetPasswordContent() {
  const user = await getSessionUser();
  if (!user) {
    return <Alert tone="error">Your reset link has expired or was already used. Request a new one.</Alert>;
  }
  return <ResetPasswordForm />;
}
