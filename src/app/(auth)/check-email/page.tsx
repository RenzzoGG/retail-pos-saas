import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Check your email · Stocktill" };

type SearchParams = Promise<{ email?: string }>;

export default function CheckEmailPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Check your email</h1>
      <Suspense fallback={<p className="mt-2 text-sm text-slate-600">We sent you a confirmation link.</p>}>
        <CheckEmailContent searchParams={searchParams} />
      </Suspense>
      <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
        Already confirmed?{" "}
        <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </>
  );
}

async function CheckEmailContent({ searchParams }: { searchParams: SearchParams }) {
  const { email } = await searchParams;
  return (
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
      We sent a confirmation link to <strong className="text-slate-900 dark:text-white">{email ?? "your email"}</strong>.
      Open it to activate your account. In local development, emails arrive in Mailpit
      (http://localhost:54324).
    </p>
  );
}
