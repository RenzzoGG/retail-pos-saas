import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { AcceptInvitationForm } from "@/features/team/components/accept-invitation-form";
import { previewInvitation } from "@/features/team/service";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invitation · Stocktill" };

type Params = Promise<{ token: string }>;

export default function InvitePage({ params }: { params: Params }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">Team invitation</h1>
        <Suspense fallback={<p className="text-sm text-slate-600">Loading invitation…</p>}>
          <InviteContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function InviteContent({ params }: { params: Params }) {
  const { token } = await params;
  const user = await requireUser();
  const preview = await previewInvitation(await createClient(), token);

  if (!preview.ok || !preview.data) {
    return <Alert tone="error">This invitation link is not valid. Ask the store owner for a new one.</Alert>;
  }
  const inv = preview.data;
  if (inv.status === "accepted") {
    return (
      <Alert tone="info">
        This invitation has already been used. <Link href="/app" className="underline">Go to your dashboard</Link>.
      </Alert>
    );
  }
  if (inv.status === "expired") {
    return <Alert tone="error">This invitation has expired. Ask the store owner to send a new one.</Alert>;
  }
  if (inv.email !== user.email.toLowerCase()) {
    return (
      <div className="space-y-4">
        <Alert tone="error">
          This invitation was sent to <strong>{inv.email}</strong>, but you&apos;re signed in as{" "}
          <strong>{user.email}</strong>. Sign in with the invited email to accept it.
        </Alert>
        <form action={signOut}>
          <Button type="submit" variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        You&apos;ve been invited to join <strong className="text-slate-900 dark:text-white">{inv.storeName}</strong>{" "}
        as <strong className="text-slate-900 dark:text-white">{ROLE_LABELS[inv.role]}</strong>.
      </p>
      <AcceptInvitationForm token={token} />
    </div>
  );
}
