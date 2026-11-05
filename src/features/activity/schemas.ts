import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .catch("");

/** Query string of /app/activity (invalid values fall back to "no filter"). */
export const activityQuerySchema = z.object({
  actor: z.union([z.uuid(), z.literal("system")]).optional().catch(undefined),
  action: z.enum(["insert", "update", "delete"]).optional().catch(undefined),
  from: date,
  to: date,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type ActivityQuery = z.output<typeof activityQuerySchema>;

export function parseActivityQuery(params: Record<string, string | string[] | undefined>): ActivityQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return activityQuerySchema.parse({
    actor: first(params.actor),
    action: first(params.action),
    from: first(params.from) ?? "",
    to: first(params.to) ?? "",
    page: first(params.page),
  });
}
