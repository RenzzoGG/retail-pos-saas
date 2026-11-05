import { z } from "zod";

const role = z.enum(["owner", "admin", "cashier"], { error: "Choose a role." });

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(["admin", "cashier"], { error: "Choose a role." }),
});

export const changeRoleSchema = z.object({ memberId: z.uuid(), role });
export const memberIdSchema = z.object({ memberId: z.uuid() });
export const invitationIdSchema = z.object({ invitationId: z.uuid() });

export type InviteInput = z.output<typeof inviteSchema>;
