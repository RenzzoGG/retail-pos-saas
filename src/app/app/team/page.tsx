import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { InvitationRow } from "@/features/team/components/invitation-row";
import { InviteForm } from "@/features/team/components/invite-form";
import { MemberRow } from "@/features/team/components/member-row";
import { listInvitations, listMembers } from "@/features/team/service";
import { requireRole } from "@/lib/auth/dal";
import { assignableRoles, canManageRole, invitableRoles } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team · Stocktill" };

export default async function TeamPage() {
  const { user, store } = await requireRole(["owner", "admin"]);
  const actor = { userId: user.id, storeId: store.storeId, role: store.role };
  const db = await createClient();
  const [members, invitations] = await Promise.all([listMembers(db, actor), listInvitations(db, actor)]);

  return (
    <>
      <PageHeader
        title="Team"
        description={
          store.role === "owner"
            ? "Invite admins and cashiers, change roles and remove members."
            : "As an admin you can invite and manage cashiers. Only owners manage admins."
        }
      />
      <div className="space-y-6">
        <Card title="Invite someone" description="They'll get an email with a link that expires in 7 days.">
          <InviteForm roles={invitableRoles(store.role)} />
        </Card>

        <Card title="Members">
          {members.ok ? (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {members.data.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canManageRole(store.role, m.role)}
                  roleOptions={assignableRoles(store.role)}
                />
              ))}
            </ul>
          ) : (
            <Alert tone="error">{members.error}</Alert>
          )}
        </Card>

        <Card title="Pending invitations">
          {!invitations.ok ? (
            <Alert tone="error">{invitations.error}</Alert>
          ) : invitations.data.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {invitations.data.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} canRevoke={canManageRole(store.role, inv.role)} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
