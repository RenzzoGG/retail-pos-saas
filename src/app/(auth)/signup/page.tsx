import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/features/auth/components/signup-form";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create account · Stocktill" };

type SearchParams = Promise<{ next?: string; email?: string }>;

export default function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600 dark:text-slate-400">
        Set up your store in a couple of minutes.
      </p>
      <Suspense fallback={null}>
        <SignupContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SignupContent({ searchParams }: { searchParams: SearchParams }) {
  const { next, email } = await searchParams;
  const nextPath = safeNextPath(next, "/onboarding");
  return (
    <div className="space-y-4">
      <SignupForm next={nextPath} {...(email ? { email } : {})} />
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}
