"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms/state";
import { ROLE_LABELS, type StoreRole } from "@/lib/permissions";
import { changeRoleAction, removeMemberAction } from "../actions";
import type { Member } from "../service";

type Props = { member: Member; canManage: boolean; roleOptions: StoreRole[] };

export function MemberRow({ member, canManage, roleOptions }: Props) {
  const [roleState, roleAction] = useActionState(changeRoleAction, initialFormState);
  const [removeState, removeAction] = useActionState(removeMemberAction, initialFormState);
  const label = member.name || member.email || "Unknown user";
  const error = [roleState, removeState].find((s) => s.status === "error")?.message;
  const saved = roleState.status === "success" ? roleState.message : undefined;
  const options = roleOptions.includes(member.role) ? roleOptions : [member.role, ...roleOptions];

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`member-${member.email}`}>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {label} {member.isYou ? <span className="text-slate-500">(you)</span> : null}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">{member.email}</p>
        {error ? (
          <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        {saved && !error ? (
          <p role="status" className="mt-1 text-sm text-green-700 dark:text-green-400">
            {saved}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <form action={roleAction} className="flex items-end gap-2">
            <input type="hidden" name="memberId" value={member.id} />
            <div>
              <label htmlFor={`role-${member.id}`} className="sr-only">
                Role for {label}
              </label>
              <select
                // Re-mount with the role the server confirmed (after a save or an error).
                key={`${member.role}:${roleState.status}:${roleState.message ?? ""}`}
                id={`role-${member.id}`}
                name="role"
                defaultValue={member.role}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
              >
                {options.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton variant="secondary" pendingText="Saving…" aria-label={`Save role for ${label}`}>
              Save role
            </SubmitButton>
          </form>
          <form
            action={removeAction}
            onSubmit={(e) => {
              if (!confirm(`Remove ${label} from this store?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="memberId" value={member.id} />
            <SubmitButton variant="danger" pendingText="Removing…" aria-label={`Remove ${label}`}>
              Remove
            </SubmitButton>
          </form>
        </div>
      ) : (
        <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {ROLE_LABELS[member.role]}
        </span>
      )}
    </li>
  );
}
