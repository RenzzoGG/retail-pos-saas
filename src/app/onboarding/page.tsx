import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createStoreAction } from "@/features/stores/actions";
import { StoreSettingsForm } from "@/features/stores/components/store-settings-form";
import { getMemberships, requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Create your store · Stocktill" };

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Create your store</h1>
        <p className="mt-1 mb-6 text-sm text-slate-600 dark:text-slate-400">
          You&apos;ll be its owner. You can change these settings later.
        </p>
        <Suspense fallback={null}>
          <OnboardingContent />
        </Suspense>
      </div>
    </main>
  );
}

async function OnboardingContent() {
  await requireUser();
  const memberships = await getMemberships();
  return (
    <>
      {memberships.length > 0 ? (
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          You already belong to {memberships.length === 1 ? "a store" : `${memberships.length} stores`}.{" "}
          <Link href="/app" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Go to your dashboard
          </Link>
        </p>
      ) : (
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          Were you invited to an existing store? Open the link in your invitation email instead.
        </p>
      )}
      <StoreSettingsForm
        action={createStoreAction}
        defaults={{ name: "", currency: "USD", taxRatePercent: "0", pricesIncludeTax: true, timezone: "UTC" }}
        submitLabel="Create store"
        pendingText="Creating store…"
      />
    </>
  );
}
