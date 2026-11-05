"use client";

import { useRef } from "react";
import { switchStoreAction } from "@/features/stores/actions";
import type { Membership } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/permissions";

/** Shown only when the user belongs to more than one store. */
export function StoreSwitcher({ memberships, activeStoreId }: { memberships: Membership[]; activeStoreId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={switchStoreAction} className="space-y-1">
      <label htmlFor="store-switcher" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Store
      </label>
      <select
        id="store-switcher"
        name="storeId"
        defaultValue={activeStoreId}
        onChange={() => formRef.current?.requestSubmit()}
        className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
      >
        {memberships.map((m) => (
          <option key={m.storeId} value={m.storeId}>
            {m.storeName} ({ROLE_LABELS[m.role]})
          </option>
        ))}
      </select>
      {/* Works without JavaScript too. */}
      <noscript>
        <button type="submit" className="mt-1 text-sm underline">
          Switch
        </button>
      </noscript>
    </form>
  );
}
