import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata: Metadata = { title: "Reset password · Stocktill" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Forgot your password?</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600 dark:text-slate-400">
        Enter your email and we&apos;ll send you a link to choose a new one.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
