import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { LoginForm } from "@/features/auth/components/login-form";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in · Stocktill" };

type SearchParams = Promise<{ next?: string; error?: string }>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600 dark:text-slate-400">Welcome back to Stocktill.</p>
      <Suspense fallback={null}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next, "/app");
  return (
    <div className="space-y-4">
      {error === "invalid_link" ? (
        <Alert tone="error">That link is invalid or has expired. Sign in, or request a new link.</Alert>
      ) : null}
      <LoginForm next={nextPath} />
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        New to Stocktill?{" "}
        <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
          Create an account
        </Link>
      </p>
    </div>
  );
}
