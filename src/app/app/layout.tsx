import { type ReactNode, Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app/app-shell";

/**
 * Private area. With Cache Components, anything that reads the session cookie
 * must render inside <Suspense>. AppShell verifies the session and membership
 * (DAL) on every request; the Proxy has already redirected guests to /login.
 */
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
